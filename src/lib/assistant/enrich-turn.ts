/**
 * Pre-loop enrichment for the Sparkles assistant — parity with Hermes
 * `/api/ai/chat` preprocessing (local_ops fast path + intent/search blocks).
 *
 * Extracted so assistant and (optionally) ai/chat share one orchestration
 * without duplicating detectIntents / enrichAssistantMessage calls.
 */

import { enrichAssistantMessage } from '@/lib/ai/enrich-message';
import { detectIntents, extractParams } from '@/lib/ai/intent-router';
import {
  formatAnalysisForPrompt,
  resolveLocalAiAnswer,
  type LocalAiResolution,
} from '@/lib/ai/ops-assistant';
import type { OrgId } from '@/lib/tenancy/constants';

export type EnrichTurnResult =
  | { kind: 'local_ops'; resolution: LocalAiResolution }
  | { kind: 'enriched'; userMessage: string; intents: string[] };

export interface EnrichTurnDeps {
  resolveLocal: typeof resolveLocalAiAnswer;
  enrich: typeof enrichAssistantMessage;
  detect: typeof detectIntents;
  extract: typeof extractParams;
}

const defaultDeps: EnrichTurnDeps = {
  resolveLocal: resolveLocalAiAnswer,
  enrich: enrichAssistantMessage,
  detect: detectIntents,
  extract: extractParams,
};

/**
 * Prepare a user turn for the assistant agent loop.
 * - local_ops → caller should short-circuit (no Claude).
 * - else → return enriched userMessage with live DB blocks when available.
 */
export async function enrichAssistantTurn(
  orgId: OrgId,
  message: string,
  deps: EnrichTurnDeps = defaultDeps,
): Promise<EnrichTurnResult> {
  const trimmed = message.trim();
  const local = await deps.resolveLocal(trimmed, orgId).catch(() => null);
  if (local) {
    return { kind: 'local_ops', resolution: local };
  }

  const intents = deps.detect(trimmed);
  const params = deps.extract(trimmed, intents);
  const enriched = await deps.enrich({
    orgId,
    message: trimmed,
    intents,
    params,
  });

  return { kind: 'enriched', userMessage: enriched, intents };
}

/** Format a local_ops resolution as the assistant reply text. */
export function formatLocalOpsReply(resolution: LocalAiResolution): string {
  return resolution.reply;
}

/** Optional structured block for persistence / debugging. */
export function formatLocalOpsContext(resolution: LocalAiResolution): string {
  return formatAnalysisForPrompt(resolution.analysis);
}
