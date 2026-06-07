import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { parseBody } from '@/lib/schemas/parse';
import { FailureModeCreateBody } from '@/lib/schemas/failure-modes';
import { listFailureModes, createFailureMode } from '@/lib/neon/failure-modes-queries';
import {
  getApiIdempotencyResponse,
  readIdempotencyKey,
  saveApiIdempotencyResponse,
} from '@/lib/api-idempotency';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import pool from '@/lib/db';

const ROUTE_FAILURE_MODES_POST = 'failure-modes.post';

/** GET /api/failure-modes — taxonomy list. `?activeOnly=1` hides deactivated. */
export const GET = withAuth(async (req: NextRequest) => {
  try {
    const activeOnly = req.nextUrl.searchParams.get('activeOnly') === '1';
    const modes = await listFailureModes({ activeOnly });
    return NextResponse.json({ success: true, modes });
  } catch (error: any) {
    console.error('Error in GET /api/failure-modes:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to load failure modes' },
      { status: 500 },
    );
  }
}, { permission: 'sku_stock.view' });

/** POST /api/failure-modes — create a taxonomy entry (idempotent). */
export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = parseBody(FailureModeCreateBody, raw);
    if (parsed instanceof NextResponse) return parsed;

    const idemKey = readIdempotencyKey(req, parsed.idempotencyKey ?? null);
    if (idemKey) {
      const hit = await getApiIdempotencyResponse(pool, idemKey, ROUTE_FAILURE_MODES_POST);
      if (hit) return NextResponse.json(hit.response_body, { status: hit.status_code });
    }

    const mode = await createFailureMode({
      code: parsed.code,
      label: parsed.label,
      category: parsed.category,
      severity: parsed.severity,
      isRepairable: parsed.isRepairable,
      typicalCostCents: parsed.typicalCostCents ?? null,
      capsGradeAt: parsed.capsGradeAt ?? null,
      sortOrder: parsed.sortOrder,
    });

    await recordAudit(pool, ctx, req, {
      source: 'failure-modes-api',
      action: AUDIT_ACTION.FAILURE_MODE_CREATE,
      entityType: AUDIT_ENTITY.FAILURE_MODE,
      entityId: mode.id,
      before: null,
      after: { ...mode },
    });

    const responseBody = { success: true, mode };
    if (idemKey) {
      await saveApiIdempotencyResponse(pool, {
        idempotencyKey: idemKey,
        route: ROUTE_FAILURE_MODES_POST,
        staffId: ctx.staffId,
        statusCode: 201,
        responseBody,
      });
    }
    return NextResponse.json(responseBody, { status: 201 });
  } catch (error: any) {
    if (error?.code === '23505' || /unique/i.test(error?.message || '')) {
      return NextResponse.json(
        { success: false, error: 'A failure mode with that code already exists' },
        { status: 409 },
      );
    }
    console.error('Error in POST /api/failure-modes:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to create failure mode' },
      { status: 500 },
    );
  }
}, { permission: 'sku_stock.manage' });
