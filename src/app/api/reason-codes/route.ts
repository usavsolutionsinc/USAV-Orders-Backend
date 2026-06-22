import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { tenantQuery } from '@/lib/tenancy/db';
import { withAuth } from '@/lib/auth/withAuth';
import { parseBody } from '@/lib/schemas/parse';
import { ReasonCodeCreateBody } from '@/lib/schemas/reason-codes';
import { createReasonCode } from '@/lib/neon/reason-codes-queries';
import {
  getApiIdempotencyResponse,
  readIdempotencyKey,
  saveApiIdempotencyResponse,
} from '@/lib/api-idempotency';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';

const ROUTE_REASON_CODES_POST = 'reason-codes.post';

export interface ReasonCodeRow {
  id: number;
  code: string;
  label: string;
  category: string;
  direction: 'in' | 'out' | 'either';
  requires_note: boolean;
  requires_photo: boolean;
  sort_order: number;
}

/**
 * GET /api/reason-codes?direction=out&category=shrinkage
 * Returns active reason codes, optionally filtered. Used by ReasonCodePicker
 * in the mobile bin editor (and any future write surface).
 */
export const GET = withAuth(async (request: NextRequest, ctx) => {
  try {
    const { searchParams } = new URL(request.url);
    const direction = searchParams.get('direction'); // in | out | either
    const category = searchParams.get('category');

    const clauses: string[] = ['is_active = true'];
    const params: string[] = [];

    // Tenant ownership filter — never return another org's reason codes.
    params.push(ctx.organizationId);
    clauses.push(`organization_id = $${params.length}`);

    // Direction filter — when the caller specifies 'out' we still want
    // 'either'-direction codes available (e.g. CYCLE_COUNT_ADJ).
    if (direction === 'in' || direction === 'out') {
      params.push(direction);
      clauses.push(`(direction = $${params.length} OR direction = 'either')`);
    } else if (direction === 'either') {
      // Pass — no filter.
    }
    if (category) {
      params.push(category);
      clauses.push(`category = $${params.length}`);
    }

    const sql = `
      SELECT id, code, label, category, direction,
             requires_note, requires_photo, sort_order
      FROM reason_codes
      WHERE ${clauses.join(' AND ')}
      ORDER BY sort_order ASC, label ASC
    `;
    const result = await tenantQuery<ReasonCodeRow>(ctx.organizationId, sql, params);
    return NextResponse.json({ success: true, reason_codes: result.rows });
  } catch (err: any) {
    console.error('[GET /api/reason-codes] error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to load reason codes', details: err?.message },
      { status: 500 },
    );
  }
}, { permission: 'sku_stock.view' });

/**
 * POST /api/reason-codes — Create a reason code.
 *
 * Body: { code, label, category, direction?, requiresNote?, requiresPhoto?,
 *         sortOrder?, idempotencyKey? }
 * `code` is the natural unique key; a retried create with the same
 * Idempotency-Key replays the original 201, and a genuine duplicate is a 409.
 */
export const POST = withAuth(async (request: NextRequest, ctx) => {
  try {
    const raw = await request.json().catch(() => ({}));
    const parsed = parseBody(ReasonCodeCreateBody, raw);
    if (parsed instanceof NextResponse) return parsed;

    const idemKey = readIdempotencyKey(request, parsed.idempotencyKey ?? null);
    if (idemKey) {
      const hit = await getApiIdempotencyResponse(pool, ctx.organizationId, idemKey, ROUTE_REASON_CODES_POST);
      if (hit) return NextResponse.json(hit.response_body, { status: hit.status_code });
    }

    const reasonCode = await createReasonCode({
      code: parsed.code,
      label: parsed.label,
      category: parsed.category,
      direction: parsed.direction,
      requiresNote: parsed.requiresNote,
      requiresPhoto: parsed.requiresPhoto,
      sortOrder: parsed.sortOrder,
    }, ctx.organizationId);

    await recordAudit(pool, ctx, request, {
      source: 'reason-codes-api',
      action: AUDIT_ACTION.REASON_CODE_CREATE,
      entityType: AUDIT_ENTITY.REASON_CODE,
      entityId: reasonCode.id,
      after: { ...reasonCode },
    });

    const responseBody = { success: true, reason_code: reasonCode };
    if (idemKey) {
      await saveApiIdempotencyResponse(pool, {
        orgId: ctx.organizationId,
        idempotencyKey: idemKey,
        route: ROUTE_REASON_CODES_POST,
        staffId: ctx.staffId,
        statusCode: 201,
        responseBody,
      });
    }

    return NextResponse.json(responseBody, { status: 201 });
  } catch (err: any) {
    if (err?.code === '23505' || /unique/i.test(err?.message || '')) {
      return NextResponse.json(
        { success: false, error: 'A reason code with that code already exists' },
        { status: 409 },
      );
    }
    console.error('[POST /api/reason-codes] error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to create reason code', details: err?.message },
      { status: 500 },
    );
  }
}, { permission: 'sku_stock.manage' });
