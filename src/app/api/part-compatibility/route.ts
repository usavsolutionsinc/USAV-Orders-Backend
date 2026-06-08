import { NextRequest, NextResponse } from 'next/server';
import { listCompatibility, upsertCompatibility } from '@/lib/neon/part-compatibility-queries';
import { withAuth } from '@/lib/auth/withAuth';
import { parseBody } from '@/lib/schemas/parse';
import { PartCompatibilityCreateBody } from '@/lib/schemas/part-compatibility';
import {
  getApiIdempotencyResponse,
  readIdempotencyKey,
  saveApiIdempotencyResponse,
} from '@/lib/api-idempotency';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import pool from '@/lib/db';

const ROUTE_PART_COMPAT_POST = 'part-compatibility.post';

/**
 * GET /api/part-compatibility?boseModelId=… | ?skuId=…
 * Lists compatibility edges, filtered by model and/or part.
 */
export const GET = withAuth(async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url);
    const boseModelId = searchParams.get('boseModelId');
    const skuId = searchParams.get('skuId');

    const rows = await listCompatibility({
      boseModelId: boseModelId ? Number(boseModelId) : null,
      skuId: skuId ? Number(skuId) : null,
    });
    return NextResponse.json({ success: true, items: rows, total: rows.length });
  } catch (error: any) {
    console.error('Error in GET /api/part-compatibility:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch compatibility' },
      { status: 500 },
    );
  }
}, { permission: 'sourcing.view' });

/**
 * POST /api/part-compatibility — Create (or refresh) a compatibility edge.
 *
 * The (model, sku, role) DB unique key makes this idempotent: re-posting the
 * same edge updates its attributes and returns 200, a new edge returns 201.
 */
export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = parseBody(PartCompatibilityCreateBody, raw);
    if (parsed instanceof NextResponse) return parsed;

    const idemKey = readIdempotencyKey(req, parsed.idempotencyKey ?? null);
    if (idemKey) {
      const hit = await getApiIdempotencyResponse(pool, idemKey, ROUTE_PART_COMPAT_POST);
      if (hit) return NextResponse.json(hit.response_body, { status: hit.status_code });
    }

    const { row, created } = await upsertCompatibility({
      boseModelId: parsed.boseModelId,
      skuId: parsed.skuId,
      partRole: parsed.partRole,
      isOem: parsed.isOem,
      fit: parsed.fit,
      confidence: parsed.confidence,
      source: parsed.source,
      notes: parsed.notes ?? null,
    });

    await recordAudit(pool, ctx, req, {
      source: 'part-compatibility-api',
      action: created ? AUDIT_ACTION.PART_COMPATIBILITY_CREATE : AUDIT_ACTION.PART_COMPATIBILITY_UPDATE,
      entityType: AUDIT_ENTITY.PART_COMPATIBILITY,
      entityId: row.id,
      before: null,
      after: { ...row },
    });

    const responseBody = { success: true, compatibility: row };
    const statusCode = created ? 201 : 200;
    if (idemKey) {
      await saveApiIdempotencyResponse(pool, {
        idempotencyKey: idemKey,
        route: ROUTE_PART_COMPAT_POST,
        staffId: ctx.staffId,
        statusCode,
        responseBody,
      });
    }

    return NextResponse.json(responseBody, { status: statusCode });
  } catch (error: any) {
    // FK violation → one of the referenced rows doesn't exist.
    if (error?.code === '23503') {
      return NextResponse.json(
        { success: false, error: 'Unknown boseModelId or skuId' },
        { status: 400 },
      );
    }
    console.error('Error in POST /api/part-compatibility:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to create compatibility' },
      { status: 500 },
    );
  }
}, { permission: 'sourcing.manage' });
