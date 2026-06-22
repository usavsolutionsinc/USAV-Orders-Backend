import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { parseBody } from '@/lib/schemas/parse';
import { HandlingUnitAssignBody } from '@/lib/schemas/handling-unit';
import {
  getHandlingUnitById,
  getHandlingUnitDetail,
  resolveUnitRefs,
  assignUnitsToHandlingUnit,
} from '@/lib/neon/handling-unit-queries';
import {
  getApiIdempotencyResponse,
  readIdempotencyKey,
  saveApiIdempotencyResponse,
} from '@/lib/api-idempotency';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';

const ROUTE_HANDLING_UNIT_ASSIGN = 'handling-unit.assign';

/**
 * POST /api/handling-units/:id/assign — add units to a box (by id / `U-{id}` /
 * unit_uid / serial). Idempotent per unit; re-assigning a unit already in the
 * box is a no-op. Body: { units: (id|U-id|unit_uid|serial)[], idempotencyKey? }
 */
export const POST = withAuth(
  async (req: NextRequest, ctx) => {
    const id = extractIdSegment(req.nextUrl.pathname);
    if (id == null) {
      return NextResponse.json({ success: false, error: 'handling unit id required' }, { status: 400 });
    }

    const raw = await req.json().catch(() => ({}));
    const parsed = parseBody(HandlingUnitAssignBody, raw);
    if (parsed instanceof NextResponse) return parsed;

    const idemKey = readIdempotencyKey(req, parsed.idempotencyKey ?? null);
    if (idemKey) {
      const hit = await getApiIdempotencyResponse(pool, ctx.organizationId, idemKey, ROUTE_HANDLING_UNIT_ASSIGN);
      if (hit) return NextResponse.json(hit.response_body, { status: hit.status_code });
    }

    const box = await getHandlingUnitById(id);
    if (!box) {
      return NextResponse.json({ success: false, error: 'Handling unit not found' }, { status: 404 });
    }

    const resolved = await resolveUnitRefs(parsed.units);
    if (resolved.unresolved.length > 0) {
      return NextResponse.json(
        { success: false, error: 'Some units could not be resolved', unresolved: resolved.unresolved },
        { status: 422 },
      );
    }

    const { moved, previous } = await assignUnitsToHandlingUnit(id, resolved.ids);
    const detail = await getHandlingUnitDetail(id);

    await recordAudit(pool, ctx, req, {
      source: 'handling-units-api',
      action: AUDIT_ACTION.HANDLING_UNIT_ASSIGN,
      entityType: AUDIT_ENTITY.HANDLING_UNIT,
      entityId: id,
      before: { previous_membership: previous },
      after: { code: box.code, assigned: resolved.ids, moved },
    });

    const responseBody = { success: true, handling_unit: detail, assigned: resolved.ids.length, moved };
    if (idemKey) {
      await saveApiIdempotencyResponse(pool, {
        orgId: ctx.organizationId,
        idempotencyKey: idemKey,
        route: ROUTE_HANDLING_UNIT_ASSIGN,
        staffId: ctx.staffId,
        statusCode: 200,
        responseBody,
      });
    }
    return NextResponse.json(responseBody);
  },
  { permission: 'handling_unit.manage' },
);

function extractIdSegment(pathname: string): number | null {
  const m = /\/api\/handling-units\/(\d+)\/assign/.exec(pathname);
  return m ? Number(m[1]) : null;
}
