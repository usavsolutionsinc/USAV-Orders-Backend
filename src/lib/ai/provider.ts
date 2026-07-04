/**
 * AI provider config layer — the single place that resolves WHERE an AI
 * capability call goes and WHICH model serves it.
 *
 * Locked decision (docs/ai-search-modernization-plan.md, 2026-07-03):
 * every LLM + embedding call resolves `{ baseURL, apiKey, model }` per
 * capability from env. Hermes local is the dev config; Vercel AI Gateway is
 * the prod default. Never hardcode a provider URL or model name outside this
 * module — callers ask for a capability, not a vendor.
 *
 * Env sets (all OpenAI wire format — the gateway erases provider dialects):
 *   chat  → AI_CHAT_BASE_URL  / AI_CHAT_MODEL  / AI_CHAT_API_KEY
 *   embed → AI_EMBED_BASE_URL / AI_EMBED_MODEL / AI_EMBED_API_KEY
 *
 * Legacy dev fallback: when AI_CHAT_BASE_URL is unset, the chat capability
 * falls back to the existing local Hermes vars (HERMES_API_URL / HERMES_MODEL
 * or AI_MODEL / HERMES_API_KEY) so current dev setups keep working unchanged.
 * The embed capability has no legacy var — it must be configured explicitly.
 *
 * NOTE: deliberately NOT `import 'server-only'` — DB-free unit tests import
 * this module under node:test. Nothing here touches the DOM or leaks secrets
 * client-side as long as it is only imported from server code (same posture
 * as src/lib/feature-flags.ts).
 */

export type AiCapability = 'chat' | 'embed';

export interface AiProviderConfig {
  /** OpenAI-compatible API root (e.g. https://ai-gateway.vercel.sh/v1), no trailing slash. */
  baseURL: string;
  /** '' when the endpoint needs no key (local Hermes / Ollama). */
  apiKey: string;
  /** Gateway model string (e.g. anthropic/claude-haiku-4-5) or local model id. */
  model: string;
}

/** Injectable env record so unit tests never mutate process.env. */
export type ProviderEnv = Record<string, string | undefined>;

/**
 * Pinned embedding dimensionality. 768 keeps `vector(768)` interchangeable
 * between prod (`openai/text-embedding-3-small` with `dimensions: 768`) and
 * dev (`nomic-embed-text`, natively 768) — a provider flip is a re-embed job,
 * never a schema change. Do NOT confuse with the 1536-dim RAG tables.
 */
export const EMBEDDING_DIMS = 768;

/** Prod default via AI Gateway — only on the explicit "Ask AI" path, never inline per keystroke. */
const CHAT_DEFAULT_MODEL = 'anthropic/claude-haiku-4-5';
/** Prod default; dev sets AI_EMBED_MODEL=nomic-embed-text against a local Ollama base URL. */
const EMBED_DEFAULT_MODEL = 'openai/text-embedding-3-small';

function readEnv(env: ProviderEnv, name: string): string {
  return String(env[name] ?? '').trim();
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Resolve the provider config for a capability. Throws a loud, actionable
 * error naming the missing env vars when the capability is requested but
 * unconfigured — never a silent empty-string fetch to nowhere.
 */
export function resolveAiConfig(
  capability: AiCapability,
  env: ProviderEnv = process.env,
): AiProviderConfig {
  if (capability === 'chat') {
    const baseURL = readEnv(env, 'AI_CHAT_BASE_URL') || readEnv(env, 'HERMES_API_URL');
    if (!baseURL) {
      throw new Error(
        'AI "chat" capability requested but not configured. Set AI_CHAT_BASE_URL ' +
          '(+ AI_CHAT_MODEL, AI_CHAT_API_KEY — Vercel AI Gateway in prod), or ' +
          'HERMES_API_URL for the local dev gateway.',
      );
    }
    return {
      baseURL: stripTrailingSlash(baseURL),
      apiKey: readEnv(env, 'AI_CHAT_API_KEY') || readEnv(env, 'HERMES_API_KEY'),
      model:
        readEnv(env, 'AI_CHAT_MODEL') ||
        readEnv(env, 'HERMES_MODEL') ||
        readEnv(env, 'AI_MODEL') ||
        CHAT_DEFAULT_MODEL,
    };
  }

  const baseURL = readEnv(env, 'AI_EMBED_BASE_URL');
  if (!baseURL) {
    throw new Error(
      'AI "embed" capability requested but not configured. Set AI_EMBED_BASE_URL ' +
        '(+ AI_EMBED_MODEL, AI_EMBED_API_KEY). Prod: Vercel AI Gateway with ' +
        `${EMBED_DEFAULT_MODEL} @ ${EMBEDDING_DIMS} dims; dev: a local Ollama ` +
        'endpoint with nomic-embed-text.',
    );
  }
  return {
    baseURL: stripTrailingSlash(baseURL),
    apiKey: readEnv(env, 'AI_EMBED_API_KEY'),
    model: readEnv(env, 'AI_EMBED_MODEL') || EMBED_DEFAULT_MODEL,
  };
}

/**
 * Cheap configured-check so hot paths (keystroke search, outbox worker) can
 * skip the semantic arm gracefully instead of catching the loud error above.
 */
export function isAiConfigured(
  capability: AiCapability,
  env: ProviderEnv = process.env,
): boolean {
  if (capability === 'chat') {
    return Boolean(readEnv(env, 'AI_CHAT_BASE_URL') || readEnv(env, 'HERMES_API_URL'));
  }
  return Boolean(readEnv(env, 'AI_EMBED_BASE_URL'));
}
