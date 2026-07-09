import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { parseBody } from '@/lib/schemas/parse';
import { SourcingSearchBody } from '@/lib/schemas/sourcing';
import { searchSecondaryMarket } from '@/lib/sourcing/search';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import pool from '@/lib/db';

export const maxDuration = 60;

/**
 * POST /api/sourcing/search — eBay Browse secondary-market proxy.
 *
 * Body: { query?, modelNumber?, partRole?, conditions?, maxPriceCents?, limit?,
 *         save?, skuId?, boseModelId?, sourcingAlertId? }
 *
 * Normalizes hits and returns them. Persists as watchlist candidates only when
 * `save: true`. User-initiated only; one Browse round-trip per call, logged to
 * ebay_api_calls (Browse quota ~5k/day).
 */
export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = parseBody(SourcingSearchBody, raw);
    if (parsed instanceof NextResponse) return parsed;

    const result = await searchSecondaryMarket({
      query: parsed.query ?? null,
      modelNumber: parsed.modelNumber ?? null,
      partRole: parsed.partRole ?? null,
      conditions: parsed.conditions,
      maxPriceCents: parsed.maxPriceCents ?? null,
      limit: parsed.limit,
      save: parsed.save ?? false,
      skuId: parsed.skuId ?? null,
      boseModelId: parsed.boseModelId ?? null,
      sourcingAlertId: parsed.sourcingAlertId ?? null,
      orgId: ctx.organizationId,
    });

    // Audit the search itself (action carries the query + result count).
    await recordAudit(pool, ctx, req, {
      source: 'sourcing-search-api',
      action: AUDIT_ACTION.SOURCING_SEARCH,
      entityType: AUDIT_ENTITY.SOURCING_CANDIDATE,
      entityId: parsed.skuId ?? parsed.boseModelId ?? 0,
      after: { query: result.query, total: result.total, saved: result.saved },
      extra: { query: result.query, returned: result.results.length, saved: result.saved },
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    // Missing/invalid creds, no enabled channel, or upstream failure → 502 (not our bug).
    const msg = error?.message || 'Sourcing search failed';
    const status = /credential|token|Browse|channel|configured/i.test(msg) ? 502 : 500;
    console.error('Error in POST /api/sourcing/search:', error);
    return NextResponse.json({ success: false, error: msg }, { status });
  }
}, { permission: 'sourcing.search', feature: 'sourcing' });
