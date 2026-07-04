import { z } from 'zod';
import { SEARCH_ENTITY_TYPES } from '@/lib/search/build-search-text';

/**
 * Body for POST /api/ai/retrieve (AI search Phase 1).
 *
 * `mode` selects the engine path:
 *   - 'retrieve' (default): the keystroke hybrid path — exact bypass +
 *     keyword + vector. LLM never runs here (latency contract).
 *   - 'ask': the explicit Ask-AI path — one forced tool call distills the NL
 *     question into structured search args, then the same hybrid engine.
 *
 * `pageContext` is accepted (reserved for per-page context injection,
 * plan §8.1) but not yet consumed — bounded so it can't be a prompt-stuffing
 * vector when it is.
 */
export const AiRetrieveBody = z.object({
  query: z.string().trim().min(1).max(300),
  entityTypes: z.array(z.enum(SEARCH_ENTITY_TYPES as readonly [string, ...string[]])).max(6).optional(),
  limit: z.number().int().min(1).max(50).optional(),
  pageContext: z.string().max(2000).optional(),
  mode: z.enum(['retrieve', 'ask']).default('retrieve'),
});

export type AiRetrieveBodyType = z.infer<typeof AiRetrieveBody>;
