/**
 * search-context — feeds the hybrid search engine's hits into the AI chat's
 * prompt-enrichment pipeline (AI search Phase 2c: "chat can call the same
 * tools", plan §7.2 / §12 "search tools as the narrow waist").
 *
 * The chat route already enriches the user message with intent-driven
 * context blocks (context-fetchers.ts). This module adds a retrieval block:
 * the SAME hybridSearch the CommandBar uses, formatted as prompt-ready text.
 * The LLM grounds "find/where/which" answers in real org-scoped hits instead
 * of guessing — and every hit line carries the app href so the model can
 * point staff at the record.
 *
 * Separate file from context-fetchers.ts on purpose: that module is the
 * intent-keyed fetcher registry; this one is the search-engine bridge, and
 * it must stay Deps-injectable for DB-free tests.
 */

import { hybridSearch, type HybridSearchResult } from '@/lib/search/hybrid-retrieval';
import type { OrgId } from '@/lib/tenancy/constants';
import type { SearchHit } from '@/lib/search/search-hit';
import { looksLikeRetrievalQuestion } from '@/lib/ai/retrieval-question';

export { looksLikeRetrievalQuestion } from '@/lib/ai/retrieval-question';

export interface SearchContextDeps {
  search: (orgId: OrgId, query: string) => Promise<HybridSearchResult>;
}

const defaultDeps: SearchContextDeps = {
  search: (orgId, query) => hybridSearch(orgId, query, { limit: 8 }),
};

function formatHit(hit: SearchHit): string {
  const facets = [
    hit.facets?.status ? `status=${hit.facets.status}` : null,
    hit.facets?.condition_grade ? `condition=${hit.facets.condition_grade}` : null,
    hit.facets?.source_platform ? `platform=${hit.facets.source_platform}` : null,
  ]
    .filter(Boolean)
    .join(', ');
  return [
    `- [${hit.entityType}] ${hit.title}`,
    hit.subtitle ? ` — ${hit.subtitle}` : '',
    facets ? ` (${facets})` : '',
    ` → ${hit.href}`,
  ].join('');
}

/**
 * Build the "=== ENTITY SEARCH ===" prompt block for a chat message, or null
 * when the message isn't retrieval-shaped / nothing matched. Never throws —
 * chat enrichment is best-effort by contract (a failed sub-fetch must not
 * take down the reply).
 */
export async function buildSearchContextBlock(
  orgId: OrgId,
  message: string,
  deps: SearchContextDeps = defaultDeps,
): Promise<string | null> {
  const q = message.trim().slice(0, 300);
  if (!q || !looksLikeRetrievalQuestion(q)) return null;
  try {
    const { hits, usedSemantic } = await deps.search(orgId, q);
    if (hits.length === 0) return null;
    return [
      `=== ENTITY SEARCH (hybrid${usedSemantic ? ' + semantic' : ''}, top ${hits.length}) ===`,
      ...hits.map(formatHit),
      `(Cite the matching record's link when answering; say so plainly if none of these match.)`,
    ].join('\n');
  } catch {
    return null;
  }
}
