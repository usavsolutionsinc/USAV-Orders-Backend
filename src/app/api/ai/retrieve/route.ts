/**
 * /api/ai/retrieve — the canonical NL → SearchHit[] endpoint (AI search
 * Phase 1, docs/ai-search-modernization-plan.md §7.2).
 *
 * POST { query, entityTypes?, limit?, pageContext?, mode? }
 *   mode 'retrieve' (default): hybrid keystroke path — exact bypass →
 *     keyword → vector → RRF. Sub-500ms budget; the only cloud call is one
 *     query embedding, and it degrades to keyword-only on failure/timeout.
 *     Deliberately NOT audited: this fires per debounced keystroke and would
 *     be pure audit spam (the read permission is the gate).
 *   mode 'ask': the explicit Ask-AI path — one forced LLM tool call
 *     (provider layer: Hermes dev / AI Gateway claude-haiku prod) distills
 *     the question into structured args for the same hybrid engine. Audited
 *     (AI_SEARCH_ASK) and rate-limited.
 *
 * GET → { enabled } — the CommandBar's flag probe (per-org
 * ai_search_commandbar / AI_SEARCH_COMMANDBAR env). Lets the client skip the
 * new path entirely when the rollout flag is off.
 *
 * Output: { hits: SearchHit[], usedSemantic: boolean } (+ toolArgs/model on
 * mode 'ask').
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { parseBody } from '@/lib/schemas/parse';
import { AiRetrieveBody } from '@/lib/schemas/ai-search';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import { checkRateLimitAsync } from '@/lib/api-guard';
import { hybridSearch } from '@/lib/search/hybrid-retrieval';
import { pageContextToEntityTypes } from '@/lib/search/page-context';
import { runAskAiSearch } from '@/lib/ai/search-tools';
import { isAiSearchCommandbar } from '@/lib/feature-flags';
import type { SearchEntityType } from '@/lib/search/build-search-text';
import type { OrgId } from '@/lib/tenancy/constants';
import pool from '@/lib/db';

export const GET = withAuth(async (_req: NextRequest, ctx) => {
  const enabled = await isAiSearchCommandbar(ctx.organizationId as OrgId);
  return NextResponse.json({ enabled });
}, { permission: 'ai.search' });

// Short per-instance TTL cache for the keystroke path (backspace-retype,
// palette reopen, common queries). Org-keyed; 15s — typeahead freshness beats
// global-search's 60s. In-memory is deliberate: an Upstash round trip per
// keystroke would cost more than it saves at this hit rate.
const RETRIEVE_CACHE_TTL_MS = 15_000;
const RETRIEVE_CACHE_MAX = 500;
const retrieveCache = new Map<string, { expiresAt: number; body: unknown }>();

function retrieveCacheGet(key: string): unknown | null {
  const hit = retrieveCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    retrieveCache.delete(key);
    return null;
  }
  return hit.body;
}

function retrieveCacheSet(key: string, body: unknown): void {
  if (retrieveCache.size >= RETRIEVE_CACHE_MAX) {
    const oldest = retrieveCache.keys().next().value;
    if (oldest !== undefined) retrieveCache.delete(oldest);
  }
  retrieveCache.set(key, { expiresAt: Date.now() + RETRIEVE_CACHE_TTL_MS, body });
}

export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = parseBody(AiRetrieveBody, raw);
    if (parsed instanceof NextResponse) return parsed;

    const orgId = ctx.organizationId as OrgId;
    const entityTypes = parsed.entityTypes as SearchEntityType[] | undefined;

    if (parsed.mode === 'ask') {
      // LLM path only — the keystroke path must never hit a rate limiter.
      // Async (Redis-backed) variant: the sync in-memory limiter multiplies
      // by instance count under serverless autoscale, and this path bears
      // real LLM cost.
      const rate = await checkRateLimitAsync({
        headers: req.headers,
        routeKey: 'ai-retrieve-ask',
        limit: Number(process.env.AI_SEARCH_RATE_LIMIT || 30),
        windowMs: 60_000,
        scope: ctx.staffId,
      });
      if (!rate.ok) {
        return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
      }

      const result = await runAskAiSearch(orgId, parsed.query);

      await recordAudit(pool, ctx, req, {
        source: 'ai-retrieve-api',
        action: AUDIT_ACTION.AI_SEARCH_ASK,
        entityType: AUDIT_ENTITY.AI_SEARCH,
        entityId: ctx.staffId,
        note: parsed.query.slice(0, 200),
        extra: {
          toolArgs: result.toolArgs,
          model: result.model,
          hitCount: result.hits.length,
          usedSemantic: result.usedSemantic,
        },
      });

      return NextResponse.json({
        hits: result.hits,
        usedSemantic: result.usedSemantic,
        toolArgs: result.toolArgs,
        model: result.model,
      });
    }

    // Plain retrieval — per-keystroke, read-gated, NOT audited (by design).
    // pageContext soft-boosts the current surface's entity types (Phase 2a);
    // it participates in the cache key since it changes ranking.
    const boostEntityTypes = pageContextToEntityTypes(parsed.pageContext);
    const cacheKey = `${orgId}:${parsed.query}:${(entityTypes ?? []).join(',')}:${(boostEntityTypes ?? []).join(',')}:${parsed.limit ?? ''}`;
    const cached = retrieveCacheGet(cacheKey);
    if (cached) {
      return NextResponse.json(cached, { headers: { 'x-cache': 'HIT' } });
    }
    const { hits, usedSemantic } = await hybridSearch(orgId, parsed.query, {
      entityTypes,
      boostEntityTypes,
      limit: parsed.limit,
    });
    const body = { hits, usedSemantic };
    retrieveCacheSet(cacheKey, body);
    return NextResponse.json(body, { headers: { 'x-cache': 'MISS' } });
  } catch (error: any) {
    // Detail stays server-side — upstream gateway bodies (hermesToolCall's
    // "AI gateway <status>: <text>") must not leak to the client.
    console.error('Error in POST /api/ai/retrieve:', error);
    return NextResponse.json({ error: 'Retrieve failed' }, { status: 500 });
  }
}, { permission: 'ai.search' });
