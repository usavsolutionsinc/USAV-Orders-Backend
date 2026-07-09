/**
 * org-provider — per-org AI provider resolution (AI search, BYOK + metered
 * platform default; docs/ai-search-modernization-plan.md).
 *
 * Supersedes env-only resolution for TENANT-facing AI search calls. Chain,
 * most-specific wins:
 *
 *   1. The org's connected provider from the integrations vault
 *      (organization_integrations, KMS-encrypted, 5-min cached via
 *      getIntegrationCredentials). Priority when several are connected:
 *      ai_gateway → openai → anthropic (chat only) → ollama/self-hosted.
 *   2. The platform-metered default: the AI_CHAT_* / AI_EMBED_* env sets
 *      (Vercel AI Gateway key owned by the platform). Usage is metered per
 *      org either way; margin billing applies only to platform-carried usage.
 *   3. null — capability unavailable; callers degrade (search = keyword-only,
 *      Ask-AI = classic chat deep-link). NEVER an error on the hot path.
 *
 * All four BYOK providers speak the OpenAI wire format (Anthropic via its
 * OpenAI-compat layer, chat only — no embeddings API).
 */

import {
  getIntegrationCredentials,
  type AiGatewayCredentials,
  type AnthropicCredentials,
  type IntegrationProvider,
  type OllamaCredentials,
  type OpenAiCredentials,
} from '@/lib/integrations/credentials';
import { isAiConfigured, resolveAiConfig, type AiCapability, type AiProviderConfig } from '@/lib/ai/provider';
import type { OrgId } from '@/lib/tenancy/constants';

export interface OrgAiConfig extends AiProviderConfig {
  /** Which vault provider (or 'platform') is serving this capability. */
  source: IntegrationProvider | 'platform';
}

const GATEWAY_BASE = 'https://ai-gateway.vercel.sh/v1';
const OPENAI_BASE = 'https://api.openai.com/v1';
// Anthropic's OpenAI SDK-compatibility endpoint (chat completions only).
const ANTHROPIC_OPENAI_COMPAT_BASE = 'https://api.anthropic.com/v1';

const DEFAULT_CHAT_MODEL_GATEWAY = 'anthropic/claude-haiku-4-5';
const DEFAULT_EMBED_MODEL_GATEWAY = 'openai/text-embedding-3-small';
const DEFAULT_CHAT_MODEL_OPENAI = 'gpt-4o-mini';
const DEFAULT_EMBED_MODEL_OPENAI = 'text-embedding-3-small';
const DEFAULT_CHAT_MODEL_ANTHROPIC = 'claude-haiku-4-5';

/**
 * Resolve the AI config for an org + capability, or null when nothing is
 * connected AND the platform default is unconfigured. Never throws on the
 * lookup path (vault read failures degrade to the platform default).
 */
export async function resolveOrgAiConfig(
  orgId: OrgId,
  capability: AiCapability,
): Promise<OrgAiConfig | null> {
  try {
    const gateway = await getIntegrationCredentials<AiGatewayCredentials>(orgId, 'ai_gateway');
    if (gateway?.apiKey) {
      return {
        source: 'ai_gateway',
        baseURL: GATEWAY_BASE,
        apiKey: gateway.apiKey,
        model:
          capability === 'chat'
            ? gateway.chatModel || DEFAULT_CHAT_MODEL_GATEWAY
            : gateway.embedModel || DEFAULT_EMBED_MODEL_GATEWAY,
      };
    }

    const openai = await getIntegrationCredentials<OpenAiCredentials>(orgId, 'openai');
    if (openai?.apiKey) {
      return {
        source: 'openai',
        baseURL: OPENAI_BASE,
        apiKey: openai.apiKey,
        model:
          capability === 'chat'
            ? openai.chatModel || DEFAULT_CHAT_MODEL_OPENAI
            : openai.embedModel || DEFAULT_EMBED_MODEL_OPENAI,
      };
    }

    if (capability === 'chat') {
      const anthropic = await getIntegrationCredentials<AnthropicCredentials>(orgId, 'anthropic');
      if (anthropic?.apiKey) {
        return {
          source: 'anthropic',
          baseURL: ANTHROPIC_OPENAI_COMPAT_BASE,
          apiKey: anthropic.apiKey,
          model: anthropic.chatModel || DEFAULT_CHAT_MODEL_ANTHROPIC,
        };
      }
    }

    const ollama = await getIntegrationCredentials<OllamaCredentials>(orgId, 'ollama');
    if (ollama?.baseUrl) {
      const model = capability === 'chat' ? ollama.model : ollama.embedModel;
      if (model) {
        return {
          source: 'ollama',
          baseURL: (ollama.tunnelUrl || ollama.baseUrl).replace(/\/+$/, ''),
          apiKey: ollama.apiKey ?? '',
          model,
        };
      }
    }
  } catch {
    // Vault unavailable → fall through to the platform default.
  }

  // Platform-metered default (env). resolveAiConfig throws when unset —
  // gate on the cheap check so this path stays null-safe.
  if (isAiConfigured(capability)) {
    return { source: 'platform', ...resolveAiConfig(capability) };
  }
  return null;
}

/** Cheap capability check for hot paths (skip the semantic arm entirely). */
export async function isOrgAiConfigured(orgId: OrgId, capability: AiCapability): Promise<boolean> {
  return (await resolveOrgAiConfig(orgId, capability)) !== null;
}
