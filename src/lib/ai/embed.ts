/**
 * embedText — the single embedding client behind the provider layer.
 *
 * OpenAI wire format (`POST {baseURL}/embeddings`) against whatever
 * `resolveAiConfig('embed')` points at: Vercel AI Gateway
 * (`openai/text-embedding-3-small`, `dimensions: 768`) in prod, local Ollama
 * (`nomic-embed-text`, natively 768) in dev. Every returned vector is
 * asserted to be exactly EMBEDDING_DIMS long — a silently mismatched
 * dimensionality would poison `entity_search_docs.embedding` for every doc
 * written after a provider flip.
 *
 * Callers own the failure policy: the outbox worker treats a throw as
 * "upsert the doc with search_text and leave embedding NULL for retry";
 * the keystroke hybrid path treats a throw/timeout as "keyword-only results".
 * This module never swallows errors itself.
 */

import {
  EMBEDDING_DIMS,
  resolveAiConfig,
  type AiProviderConfig,
  type ProviderEnv,
} from '@/lib/ai/provider';

export interface EmbedDeps {
  /** Injectable so unit tests run without env or network. */
  resolveConfig: (env?: ProviderEnv) => AiProviderConfig;
  /** Pre-resolved config (per-org BYOK) — when set, resolveConfig is skipped. */
  config?: AiProviderConfig;
  fetchImpl: typeof fetch;
  /** Per-request abort budget. Worker default; keystroke callers pass ~300ms. */
  timeoutMs: number;
  /** Inputs per /embeddings request. */
  batchSize: number;
  /** Metering hook — called once per batch with the provider-reported usage. */
  onUsage?: (usage: { promptTokens: number; model: string }) => void;
}

const defaultDeps: EmbedDeps = {
  resolveConfig: (env) => resolveAiConfig('embed', env),
  fetchImpl: fetch,
  timeoutMs: 8_000,
  batchSize: 64,
};

interface OpenAiEmbeddingResponse {
  data?: Array<{ embedding?: number[]; index?: number }>;
  usage?: { prompt_tokens?: number; total_tokens?: number };
  error?: { message?: string } | string;
}

/**
 * Embed a list of texts, preserving input order. Returns one
 * EMBEDDING_DIMS-length vector per input. Throws on any transport, shape, or
 * dimension failure — degradation policy belongs to the caller.
 */
export async function embedText(
  texts: string[],
  deps: Partial<EmbedDeps> = {},
): Promise<number[][]> {
  const { resolveConfig, fetchImpl, timeoutMs, batchSize, onUsage } = { ...defaultDeps, ...deps };
  if (texts.length === 0) return [];

  const config = deps.config ?? resolveConfig();
  const out: number[][] = [];

  for (let start = 0; start < texts.length; start += batchSize) {
    const batch = texts.slice(start, start + batchSize);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetchImpl(`${config.baseURL}/embeddings`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: config.model,
          input: batch,
          // text-embedding-3-* honors this; Ollama's nomic-embed-text ignores
          // it and is natively 768 — the dim assertion below catches drift
          // from any provider that returns something else.
          dimensions: EMBEDDING_DIMS,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      throw new Error(
        `Embedding request failed (${config.model}): ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const text = (await res.text().catch(() => '')).slice(0, 300);
      throw new Error(`Embedding endpoint ${res.status} (${config.model}): ${text}`);
    }

    const data = (await res.json()) as OpenAiEmbeddingResponse;
    if (onUsage && typeof data.usage?.prompt_tokens === 'number') {
      try {
        onUsage({ promptTokens: data.usage.prompt_tokens, model: config.model });
      } catch {
        // metering must never fail the embed
      }
    }
    const rows = data.data;
    if (!Array.isArray(rows) || rows.length !== batch.length) {
      throw new Error(
        `Embedding response shape mismatch (${config.model}): expected ${batch.length} vectors, got ${
          Array.isArray(rows) ? rows.length : 'none'
        }`,
      );
    }

    // The API may return out of order; `index` is relative to this batch.
    const ordered = [...rows].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    for (const row of ordered) {
      const vec = row.embedding;
      if (!Array.isArray(vec) || vec.length !== EMBEDDING_DIMS) {
        throw new Error(
          `Embedding dim mismatch (${config.model}): got ${
            Array.isArray(vec) ? vec.length : 'none'
          }, expected ${EMBEDDING_DIMS}`,
        );
      }
      out.push(vec);
    }
  }

  return out;
}
