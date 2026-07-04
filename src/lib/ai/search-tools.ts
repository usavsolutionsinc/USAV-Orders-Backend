/**
 * search-tools — the typed tool registry the LLM is allowed to call for
 * search (AI search Phase 1, docs/ai-search-modernization-plan.md §12
 * "search tools as the narrow waist").
 *
 * Fires ONLY on the explicit Ask-AI path (locked decision 4: the LLM is
 * never inline on the keystroke path). The model routes through
 * `hermesToolCall` (forced single tool, temperature 0, OpenAI wire) with the
 * provider resolved by `resolveAiConfig('chat')` — Hermes in dev, Vercel AI
 * Gateway `anthropic/claude-haiku-4-5` in prod. Tools return only
 * `SearchHit[]`, never raw DB rows.
 */

import { hermesToolCall, type HermesTool } from '@/lib/ai/hermes-tool-call';
import { resolveOrgAiConfig } from '@/lib/ai/org-provider';
import { recordAiUsage } from '@/lib/ai/usage';
import { hybridSearch, type HybridSearchResult } from '@/lib/search/hybrid-retrieval';
import { searchAllEntities } from '@/lib/search/global-entity-search';
import { SEARCH_ENTITY_TYPES, type SearchEntityType } from '@/lib/search/build-search-text';
import type { OrgId } from '@/lib/tenancy/constants';
import type { SearchHit } from '@/lib/search/search-hit';

// ── Tool schemas (OpenAI function.parameters shape) ─────────────────────────

/** Deterministic fast path: exact id / serial / tracking lookup. */
export const exactIdSerialSearchTool: HermesTool = {
  name: 'exact_id_serial_search',
  description:
    'Look up entities by an exact identifier: order id, serial number, tracking number, ' +
    'SKU code, repair ticket, or numeric record id. Use when the query IS an identifier.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The identifier to look up, verbatim.' },
    },
    required: ['query'],
    additionalProperties: false,
  },
};

/** The primary NL tool: hybrid keyword+semantic retrieval with facet scoping. */
export const hybridEntitySearchTool: HermesTool = {
  name: 'hybrid_entity_search',
  description:
    'Search warehouse entities (orders, serialized units, receiving cartons, SKU catalog, ' +
    'repairs, FBA shipments) by natural language. Extract the core search phrase and any ' +
    'entity-type scope from the user question.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Distilled search phrase (product names, identifiers, descriptive terms).',
      },
      entityTypes: {
        type: 'array',
        description: 'Restrict to these entity types when the question implies a scope.',
        items: { type: 'string', enum: [...SEARCH_ENTITY_TYPES] },
      },
      limit: { type: 'integer', minimum: 1, maximum: 50 },
    },
    required: ['query'],
    additionalProperties: false,
  },
};

/** Typed wrapper: serialized-unit search (the densest operator ask). */
export const searchUnitsTool: HermesTool = {
  name: 'search_units',
  description:
    'Search serialized inventory units by serial, SKU, product name, condition, status, ' +
    'or location. Returns unit hits only.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search phrase for the unit.' },
      limit: { type: 'integer', minimum: 1, maximum: 50 },
    },
    required: ['query'],
    additionalProperties: false,
  },
};

export const SEARCH_TOOLS: readonly HermesTool[] = [
  exactIdSerialSearchTool,
  hybridEntitySearchTool,
  searchUnitsTool,
];

// ── Executors — every tool returns SearchHit[] only ─────────────────────────

export async function runExactIdSerialSearch(
  orgId: OrgId,
  args: { query: string; limit?: number },
): Promise<SearchHit[]> {
  const results = await searchAllEntities(orgId, args.query, args.limit ?? 20);
  return results.map((r, rank) => ({ ...r, score: 1000 - rank, chips: [] }));
}

export async function runHybridEntitySearch(
  orgId: OrgId,
  args: { query: string; entityTypes?: string[]; limit?: number },
): Promise<HybridSearchResult> {
  // LLM-produced args are parsed JSON, NOT schema-validated (hermesToolCall's
  // contract) — coerce defensively before use.
  const rawTypes = Array.isArray(args.entityTypes) ? args.entityTypes : [];
  const entityTypes = rawTypes.filter((t): t is SearchEntityType =>
    (SEARCH_ENTITY_TYPES as readonly string[]).includes(t),
  );
  const limit =
    typeof args.limit === 'number' && Number.isInteger(args.limit) && args.limit > 0
      ? args.limit
      : undefined;
  return hybridSearch(orgId, String(args.query ?? ''), {
    entityTypes: entityTypes.length > 0 ? entityTypes : undefined,
    limit,
  });
}

export async function runSearchUnits(
  orgId: OrgId,
  args: { query: string; limit?: number },
): Promise<HybridSearchResult> {
  return hybridSearch(orgId, args.query, { entityTypes: ['SERIAL_UNIT'], limit: args.limit });
}

// ── Ask-AI orchestration ────────────────────────────────────────────────────

const ASK_AI_SYSTEM_PROMPT =
  'You translate a warehouse operator question into ONE hybrid_entity_search tool call. ' +
  'Distill the search phrase (drop filler words, keep product names, identifiers, ' +
  'conditions, platforms). Scope entityTypes only when the question clearly names a ' +
  'domain: orders/shipments → ORDER, serials/units/inventory → SERIAL_UNIT, ' +
  'receiving/cartons/POs → RECEIVING, catalog/SKUs → SKU, repairs/tickets → REPAIR, ' +
  'FBA/Amazon shipments → FBA_SHIPMENT.';

export interface AskAiSearchResult extends HybridSearchResult {
  /** What the model distilled the question into (surfaced in the UI + audit). */
  toolArgs: { query: string; entityTypes?: string[]; limit?: number };
  model: string;
}

/**
 * The explicit "Ask AI" search: one forced `hybrid_entity_search` call to
 * extract structured args from the NL question, then the same hybridSearch
 * engine the keystroke path uses. LLM cost is exactly one small completion.
 */
export async function runAskAiSearch(
  orgId: OrgId,
  question: string,
  deps: {
    toolCall?: typeof hermesToolCall;
    runHybrid?: typeof runHybridEntitySearch;
    resolveChatConfig?: typeof resolveOrgAiConfig;
    recordUsage?: typeof recordAiUsage;
  } = {},
): Promise<AskAiSearchResult> {
  const toolCall = deps.toolCall ?? hermesToolCall;
  const runHybrid = deps.runHybrid ?? runHybridEntitySearch;
  const resolveChatConfig = deps.resolveChatConfig ?? resolveOrgAiConfig;
  const recordUsage = deps.recordUsage ?? recordAiUsage;

  // Per-org provider (BYOK vault → platform default). No chat capability at
  // all → throw; the route maps this to a fallback (classic chat deep-link).
  const config = await resolveChatConfig(orgId, 'chat');
  if (!config) {
    throw new Error('No AI chat provider connected for this organization');
  }

  const { args, model, usage } = await toolCall<{
    query: string;
    entityTypes?: string[];
    limit?: number;
  }>({
    systemPrompt: ASK_AI_SYSTEM_PROMPT,
    userText: question,
    tool: hybridEntitySearchTool,
    provider: config,
  });

  recordUsage({
    orgId,
    capability: 'chat',
    source: config.source,
    model,
    context: 'ask_ai',
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
  });

  const query = String(args?.query ?? '').trim() || question;
  const toolArgs = { query, entityTypes: args?.entityTypes, limit: args?.limit };
  const result = await runHybrid(orgId, toolArgs);
  return { ...result, toolArgs, model };
}
