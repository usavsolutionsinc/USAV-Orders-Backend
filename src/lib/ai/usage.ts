/**
 * usage — per-org AI usage metering (ai_usage_events; migration 2026-07-04b).
 *
 * One row per billable AI call: query embeds, worker doc-embed batches,
 * Ask-AI tool calls. Feeds the Settings → AI price breakdown and the
 * env-gated Stripe meter reporter. Fire-and-forget by contract: metering
 * must NEVER fail or slow the search path — errors are logged and dropped
 * (same posture as recordAudit).
 */

import pool from '@/lib/db';
import { estimateCostMicrocents } from '@/lib/ai/model-pricing';
import { getOrganization } from '@/lib/tenancy/organizations';
import type { OrgId } from '@/lib/tenancy/constants';

export interface AiUsageInput {
  orgId: OrgId;
  capability: 'chat' | 'embed';
  /** Vault provider serving the call, or 'platform' for the metered default. */
  source: string;
  model: string;
  context: 'query_embed' | 'doc_embed' | 'ask_ai';
  inputTokens: number;
  outputTokens?: number;
}

export type RecordAiUsage = (input: AiUsageInput) => void;

/**
 * Insert a usage row. Synchronous fire-and-forget: returns immediately, the
 * insert races in the background, failures are logged only.
 */
export function recordAiUsage(input: AiUsageInput): void {
  const outputTokens = input.outputTokens ?? 0;
  const cost = estimateCostMicrocents(input.model, input.inputTokens, outputTokens);
  void pool
    .query(
      `INSERT INTO ai_usage_events
         (organization_id, capability, provider, model, context,
          input_tokens, output_tokens, cost_microcents)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        input.orgId,
        input.capability,
        input.source,
        input.model,
        input.context,
        input.inputTokens,
        outputTokens,
        cost,
      ],
    )
    .catch((err) => {
      console.warn('[ai-usage] insert failed (non-fatal):', err instanceof Error ? err.message : err);
    });
}

/**
 * Per-tenant billing margin (percent) applied to platform-carried AI usage.
 * Resolution is DB-first — the org's row in `organizations.settings`
 * (key `aiUsageMarginPercent`, platform-set) — with the AI_USAGE_MARGIN_PERCENT
 * env as the global default and 0 as the floor. Never a code constant per org.
 */
export async function getAiUsageMarginPercent(orgId: OrgId): Promise<number> {
  try {
    const org = await getOrganization(orgId);
    const raw = (org?.settings as Record<string, unknown> | undefined)?.aiUsageMarginPercent;
    if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) return raw;
  } catch {
    // fall through to env default
  }
  const env = Number(process.env.AI_USAGE_MARGIN_PERCENT);
  return Number.isFinite(env) && env >= 0 ? env : 0;
}

export interface AiUsageSummaryRow {
  capability: string;
  provider: string;
  model: string;
  context: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** Sum of estimated provider cost; null-cost rows excluded (counted in unknownRateCalls). */
  costMicrocents: number;
  unknownRateCalls: number;
}

/** Month-to-date (or windowed) per-model rollup for the settings breakdown. */
export async function summarizeAiUsage(
  orgId: OrgId,
  sinceDays = 30,
): Promise<AiUsageSummaryRow[]> {
  const res = await pool.query(
    `SELECT capability, provider, model, context,
            COUNT(*)::int                            AS calls,
            COALESCE(SUM(input_tokens), 0)::bigint   AS input_tokens,
            COALESCE(SUM(output_tokens), 0)::bigint  AS output_tokens,
            COALESCE(SUM(cost_microcents), 0)::bigint AS cost_microcents,
            COUNT(*) FILTER (WHERE cost_microcents IS NULL)::int AS unknown_rate_calls
     FROM ai_usage_events
     WHERE organization_id = $1
       AND created_at >= now() - ($2::int * INTERVAL '1 day')
     GROUP BY capability, provider, model, context
     ORDER BY cost_microcents DESC NULLS LAST, calls DESC`,
    [orgId, sinceDays],
  );
  return res.rows.map((r: any) => ({
    capability: String(r.capability),
    provider: String(r.provider),
    model: String(r.model),
    context: String(r.context),
    calls: Number(r.calls),
    inputTokens: Number(r.input_tokens),
    outputTokens: Number(r.output_tokens),
    costMicrocents: Number(r.cost_microcents),
    unknownRateCalls: Number(r.unknown_rate_calls),
  }));
}
