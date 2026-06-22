import { NextRequest, NextResponse } from 'next/server';
import {
  createSourcingSearch,
  listSourcingSearches,
} from '@/lib/neon/sourcing-searches-queries';
import { withAuth } from '@/lib/auth/withAuth';
import { parseBody } from '@/lib/schemas/parse';
import { SavedSearchCreateBody } from '@/lib/schemas/sourcing';
import {
  getApiIdempotencyResponse,
  readIdempotencyKey,
  saveApiIdempotencyResponse,
} from '@/lib/api-idempotency';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import pool from '@/lib/db';

const ROUTE_SAVED_SEARCH_CREATE = 'sourcing-saved-search.create';

/**
 * GET /api/sourcing/saved-searches?active=&skuId= — standing searches.
 * Defaults to active only; pass active=false to include paused/archived rows.
 */
export const GET = withAuth(async (req: NextRequest, ctx) => {
  try {
    const { searchParams } = new URL(req.url);
    const active = searchParams.get('active');
    const skuId = searchParams.get('skuId');
    const items = await listSourcingSearches({
      activeOnly: active !== 'false',
      skuId: skuId ? Number(skuId) : null,
    }, ctx.organizationId);
    return NextResponse.json({ success: true, items, total: items.length });
  } catch (error: any) {
    console.error('Error in GET /api/sourcing/saved-searches:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch saved searches' },
      { status: 500 },
    );
  }
}, { permission: 'sourcing.view' });

/**
 * POST /api/sourcing/saved-searches — create a standing search.
 * Body: { query, label?, skuId?, sourcingAlertId?, sources?, conditions?,
 *         maxPriceCents?, cadence? }. Idempotent on Idempotency-Key.
 */
export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = parseBody(SavedSearchCreateBody, raw);
    if (parsed instanceof NextResponse) return parsed;

    const idemKey = readIdempotencyKey(req, parsed.idempotencyKey ?? null);
    if (idemKey) {
      const hit = await getApiIdempotencyResponse(pool, ctx.organizationId, idemKey, ROUTE_SAVED_SEARCH_CREATE);
      if (hit) return NextResponse.json(hit.response_body, { status: hit.status_code });
    }

    const row = await createSourcingSearch({
      query: parsed.query,
      label: parsed.label ?? null,
      skuId: parsed.skuId ?? null,
      sourcingAlertId: parsed.sourcingAlertId ?? null,
      sources: parsed.sources ?? null,
      conditions: parsed.conditions ?? null,
      maxPriceCents: parsed.maxPriceCents ?? null,
      cadence: parsed.cadence ?? 'off',
      createdBy: ctx.staffId,
    }, ctx.organizationId);

    await recordAudit(pool, ctx, req, {
      source: 'sourcing-saved-searches-api',
      action: AUDIT_ACTION.SOURCING_SAVED_SEARCH_CREATE,
      entityType: AUDIT_ENTITY.SOURCING_SAVED_SEARCH,
      entityId: row.id,
      after: { ...row },
    });

    const responseBody = { success: true, search: row };
    if (idemKey) {
      await saveApiIdempotencyResponse(pool, {
        orgId: ctx.organizationId,
        idempotencyKey: idemKey,
        route: ROUTE_SAVED_SEARCH_CREATE,
        staffId: ctx.staffId,
        statusCode: 201,
        responseBody,
      });
    }
    return NextResponse.json(responseBody, { status: 201 });
  } catch (error: any) {
    if (error?.code === '23503') {
      return NextResponse.json({ success: false, error: 'Unknown skuId or alertId' }, { status: 400 });
    }
    console.error('Error in POST /api/sourcing/saved-searches:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to create saved search' },
      { status: 500 },
    );
  }
}, { permission: 'sourcing.manage' });
