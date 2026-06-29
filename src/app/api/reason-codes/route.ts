import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { parseBody } from '@/lib/schemas/parse';
import { ReasonCodeCreateBody } from '@/lib/schemas/reason-codes';
import { createReasonCode, getActiveReasonCodes } from '@/lib/neon/reason-codes-queries';
import {
  getApiIdempotencyResponse,
  readIdempotencyKey,
  saveApiIdempotencyResponse,
} from '@/lib/api-idempotency';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';

const ROUTE_REASON_CODES_POST = 'reason-codes.post';

/**
 * GET /api/reason-codes?direction=out&category=shrinkage&flowContext=substitution
 * Returns active reason codes, optionally filtered by direction / ledger category
 * / Class-D flow_context. Delegates to getActiveReasonCodes (the single read SoT —
 * org scoping + filters live there, never inline). Used by ReasonCodePicker +
 * useSubstitutionReasons.
 */
export const GET = withAuth(async (request: NextRequest, ctx) => {
  try {
    const { searchParams } = new URL(request.url);
    const direction = searchParams.get('direction'); // in | out | either
    const category = searchParams.get('category');
    const flowContext = searchParams.get('flowContext'); // Class-D vocabulary (e.g. 'substitution')
    const workflowNodeId = searchParams.get('workflowNodeId'); // D3: per-node palette scoping

    const reason_codes = await getActiveReasonCodes(ctx.organizationId, {
      direction: direction === 'in' || direction === 'out' || direction === 'either' ? direction : undefined,
      category: category ?? undefined,
      flowContext: flowContext ?? undefined,
      workflowNodeId: workflowNodeId ?? undefined,
    });
    return NextResponse.json({ success: true, reason_codes });
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
