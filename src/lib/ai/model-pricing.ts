/**
 * model-pricing — published per-token PROVIDER rates for cost estimation
 * (AI search per-org metering; docs/ai-search-modernization-plan.md).
 *
 * Pure data + math, DB-free. Rates are USD per 1M tokens, matched by model
 * substring (gateway model strings look like "openai/text-embedding-3-small";
 * direct strings like "text-embedding-3-small" — substring match covers
 * both). Unknown models return null cost — the usage row still records
 * tokens, and the settings page labels those rows "rate unknown".
 *
 * cost unit: MICROCENTS (1e-8 USD; 1_000_000 microcents = 1¢) — integer math
 * end to end, no float drift in the ledger. The BILLED price applies
 * AI_USAGE_MARGIN_PERCENT at read time (never persisted), so changing the
 * margin never rewrites history.
 */

interface ModelRate {
  /** Substring matched against the model id (lowercase). */
  match: string;
  /** USD per 1M input tokens. */
  inputPerM: number;
  /** USD per 1M output tokens (0 for embeddings). */
  outputPerM: number;
}

// Ordered — first match wins (put more specific substrings first).
const RATES: ModelRate[] = [
  // Embeddings
  { match: 'text-embedding-3-small', inputPerM: 0.02, outputPerM: 0 },
  { match: 'text-embedding-3-large', inputPerM: 0.13, outputPerM: 0 },
  { match: 'nomic-embed', inputPerM: 0, outputPerM: 0 }, // self-hosted
  // Chat
  { match: 'claude-haiku-4-5', inputPerM: 1.0, outputPerM: 5.0 },
  { match: 'claude-sonnet', inputPerM: 3.0, outputPerM: 15.0 },
  { match: 'gpt-4o-mini', inputPerM: 0.15, outputPerM: 0.6 },
  { match: 'gpt-4o', inputPerM: 2.5, outputPerM: 10.0 },
  { match: 'gpt-4.1-mini', inputPerM: 0.4, outputPerM: 1.6 },
  { match: 'gpt-4.1', inputPerM: 2.0, outputPerM: 8.0 },
];

const MICROCENTS_PER_USD = 100_000_000;

/**
 * Estimated provider cost in microcents, or null when the model rate is
 * unknown. Self-hosted models rate at 0 (a real cost of $0 to the provider).
 */
export function estimateCostMicrocents(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | null {
  const m = model.toLowerCase();
  const rate = RATES.find((r) => m.includes(r.match));
  if (!rate) return null;
  const usd =
    (inputTokens / 1_000_000) * rate.inputPerM + (outputTokens / 1_000_000) * rate.outputPerM;
  return Math.round(usd * MICROCENTS_PER_USD);
}

/** microcents → display USD string (e.g. 1234567890 → "$12.35"). */
export function microcentsToUsd(microcents: number): string {
  return `$${(microcents / MICROCENTS_PER_USD).toFixed(microcents >= MICROCENTS_PER_USD ? 2 : 4)}`;
}

/** Apply the platform margin (percent, e.g. 30 → ×1.3). Integer microcents. */
export function applyMarginMicrocents(costMicrocents: number, marginPercent: number): number {
  return Math.round(costMicrocents * (1 + marginPercent / 100));
}
