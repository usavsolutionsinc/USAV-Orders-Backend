import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { parseBody } from '@/lib/schemas/parse';
import { SourcingSearchBody } from '@/lib/schemas/sourcing';
import { searchSecondaryMarket } from '@/lib/sourcing/search';
import { researchSourcingCandidates } from '@/lib/ai/sourcing-research';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import pool from '@/lib/db';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/sourcing/research
 *
 * Runs the normal secondary-market search, then asks Hermes to rank the
 * returned listings for an operations buyer. This is a draft/research aid only:
 * it does not save candidates unless the caller explicitly uses the existing
 * candidate save/import endpoints.
 */
export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = parseBody(SourcingSearchBody, { ...raw, save: false });
    if (parsed instanceof NextResponse) return parsed;

    const search = await searchSecondaryMarket({
      query: parsed.query ?? null,
      modelNumber: parsed.modelNumber ?? null,
      partRole: parsed.partRole ?? null,
      conditions: parsed.conditions,
      maxPriceCents: parsed.maxPriceCents ?? null,
      limit: parsed.limit ?? 12,
      save: false,
      skuId: parsed.skuId ?? null,
      boseModelId: parsed.boseModelId ?? null,
      sourcingAlertId: parsed.sourcingAlertId ?? null,
      orgId: ctx.organizationId,
    });

    const research = await researchSourcingCandidates({
      query: search.query,
      modelNumber: parsed.modelNumber ?? null,
      partRole: parsed.partRole ?? null,
      maxPriceCents: parsed.maxPriceCents ?? null,
      candidates: search.results,
    });

    await recordAudit(pool, ctx, req, {
      source: 'sourcing-research-api',
      action: AUDIT_ACTION.SOURCING_SEARCH,
      entityType: AUDIT_ENTITY.SOURCING_CANDIDATE,
      entityId: parsed.skuId ?? parsed.boseModelId ?? 0,
      after: { query: search.query, total: search.total, ranked: research.rankedCandidates.length },
      extra: { query: search.query, returned: search.results.length, ranked: research.rankedCandidates.length },
    });

    return NextResponse.json({
      success: true,
      query: search.query,
      total: search.total,
      bySource: search.bySource,
      results: search.results,
      research,
    });
  } catch (error: any) {
    const msg = error?.message || 'Sourcing research failed';
    const status = /credential|token|Browse|channel|configured|AI gateway|Hermes/i.test(msg) ? 502 : 500;
    console.error('Error in POST /api/sourcing/research:', error);
    return NextResponse.json({ success: false, error: msg }, { status });
  }
}, { permission: 'sourcing.search', feature: 'sourcing' });

