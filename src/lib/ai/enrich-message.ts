/**
 * Shared Hermes chat enrichment — intent context blocks + hybrid search block.
 * Extracted so /api/ai/chat and /api/ai/chat/stream stay in parity (LE-004).
 * Never throws: each sub-fetch is independently non-fatal.
 */

import { buildContextBlock } from '@/lib/ai/context-fetchers';
import { buildSearchContextBlock } from '@/lib/ai/search-context';
import type { IntentDomain, IntentParams } from '@/lib/ai/intent-router';
import type { OrgId } from '@/lib/tenancy/constants';

export interface EnrichAssistantMessageArgs {
  orgId: OrgId;
  message: string;
  intents: IntentDomain[];
  params: IntentParams;
  /** Optional prefix already applied (e.g. local_ops structured analysis). */
  baseMessage?: string;
}

/**
 * Build the enriched user message for Hermes. Returns the original message
 * when no enrichment blocks are available.
 */
export async function enrichAssistantMessage(
  args: EnrichAssistantMessageArgs,
): Promise<string> {
  const trimmed = args.message.trim();
  const base = args.baseMessage ?? trimmed;
  const [contextBlock, searchBlock] = await Promise.all([
    args.intents.length > 0
      ? buildContextBlock(args.intents, args.params, args.orgId).catch((err) => {
          console.error('[ai-chat] context fetch error (non-fatal):', err);
          return null;
        })
      : Promise.resolve(null),
    buildSearchContextBlock(args.orgId, trimmed),
  ]);
  if (!contextBlock && !searchBlock) return base;
  const blocks = [contextBlock, searchBlock].filter(Boolean).join('\n\n');
  return (
    `[Live USAV data - ${new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} PST]\n` +
    blocks +
    `\n\nUser question: ${trimmed}`
  );
}
