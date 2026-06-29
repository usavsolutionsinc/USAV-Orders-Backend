import { NextRequest, NextResponse } from 'next/server';
import { getSourcingCandidates, saveCandidate } from '@/lib/neon/sourcing-queries';
import { withAuth } from '@/lib/auth/withAuth';
import { parseBody } from '@/lib/schemas/parse';
import { SourcingCandidateCreateBody } from '@/lib/schemas/sourcing';
import {
  getApiIdempotencyResponse,
  readIdempotencyKey,
  saveApiIdempotencyResponse,
} from '@/lib/api-idempotency';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import pool from '@/lib/db';

const ROUTE_CANDIDATES_POST = 'sourcing-candidates.post';

/**
 * GET /api/sourcing/candidates?skuId=&boseModelId=&sourcingAlertId=&status=
 * The saved watchlist of secondary-market hits.
 */
export const GET = withAuth(async (req: NextRequest, ctx) => {
  try {
    const { searchParams } = new URL(req.url);
    const num = (k: string) => {
      const v = searchParams.get(k);
      return v ? Number(v) : null;
    };
    const limit = Math.max(1, Math.min(500, Number(searchParams.get('limit') || 100)));
    const offset = Math.max(0, Number(searchParams.get('offset') || 0));

    const { items, total } = await getSourcingCandidates({
      skuId: num('skuId'),
      boseModelId: num('boseModelId'),
      sourcingAlertId: num('sourcingAlertId'),
      status: searchParams.get('status'),
      limit,
      offset,
    }, ctx.organizationId);
    return NextResponse.json({ success: true, items, total });
  } catch (error: any) {
    console.error('Error in GET /api/sourcing/candidates:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch candidates' },
      { status: 500 },
    );
  }
}, { permission: 'sourcing.view', feature: 'sourcing' });

/**
 * POST /api/sourcing/candidates — Save a candidate to the watchlist.
 *
 * eBay hits (with `externalId`) dedupe on the (source, external_id) unique
 * index — a re-save updates in place (200); a new candidate is 201. A retried
 * create replays via `Idempotency-Key`.
 */
export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = parseBody(SourcingCandidateCreateBody, raw);
    if (parsed instanceof NextResponse) return parsed;

    const idemKey = readIdempotencyKey(req, parsed.idempotencyKey ?? null);
    if (idemKey) {
      const hit = await getApiIdempotencyResponse(pool, ctx.organizationId, idemKey, ROUTE_CANDIDATES_POST);
      if (hit) return NextResponse.json(hit.response_body, { status: hit.status_code });
    }

    const { row, created } = await saveCandidate({
      source: parsed.source,
      externalId: parsed.externalId ?? null,
      title: parsed.title,
      url: parsed.url ?? null,
      imageUrl: parsed.imageUrl ?? null,
      condition: parsed.condition ?? null,
      priceCents: parsed.priceCents ?? null,
      shippingCents: parsed.shippingCents ?? null,
      currency: parsed.currency ?? null,
      sellerName: parsed.sellerName ?? null,
      skuId: parsed.skuId ?? null,
      boseModelId: parsed.boseModelId ?? null,
      sourcingAlertId: parsed.sourcingAlertId ?? null,
      supplierId: parsed.supplierId ?? null,
      status: parsed.status,
      raw: parsed.raw ?? null,
    }, ctx.organizationId);

    await recordAudit(pool, ctx, req, {
      source: 'sourcing-candidates-api',
      action: AUDIT_ACTION.SOURCING_CANDIDATE_SAVE,
      entityType: AUDIT_ENTITY.SOURCING_CANDIDATE,
      entityId: row.id,
      before: null,
      after: { ...row },
    });

    const responseBody = { success: true, candidate: row };
    const statusCode = created ? 201 : 200;
    if (idemKey) {
      await saveApiIdempotencyResponse(pool, {
        orgId: ctx.organizationId,
        idempotencyKey: idemKey,
        route: ROUTE_CANDIDATES_POST,
        staffId: ctx.staffId,
        statusCode,
        responseBody,
      });
    }

    return NextResponse.json(responseBody, { status: statusCode });
  } catch (error: any) {
    if (error?.code === '23503') {
      return NextResponse.json(
        { success: false, error: 'Unknown skuId, boseModelId, supplierId or sourcingAlertId' },
        { status: 400 },
      );
    }
    console.error('Error in POST /api/sourcing/candidates:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to save candidate' },
      { status: 500 },
    );
  }
}, { permission: 'sourcing.manage', feature: 'sourcing' });
