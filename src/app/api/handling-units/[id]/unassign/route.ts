import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { parseBody } from '@/lib/schemas/parse';
import { HandlingUnitUnassignBody } from '@/lib/schemas/handling-unit';
import {
  getHandlingUnitById,
  getHandlingUnitDetail,
  resolveUnitRefs,
  unassignUnits,
} from '@/lib/neon/handling-unit-queries';
import {
  getApiIdempotencyResponse,
  readIdempotencyKey,
  saveApiIdempotencyResponse,
} from '@/lib/api-idempotency';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';

const ROUTE_HANDLING_UNIT_UNASSIGN = 'handling-unit.unassign';

/**
 * POST /api/handling-units/:id/unassign — remove units from a box (their
 * handling_unit_id → NULL). Only units currently in THIS box are removed.
 * Body: { units: (id|U-id|unit_uid|serial)[], idempotencyKey? }
 */
export const POST = withAuth(
  async (req: NextRequest, ctx) => {
    const id = extractIdSegment(req.nextUrl.pathname);
    if (id == null) {
      return NextResponse.json({ success: false, error: 'handling unit id required' }, { status: 400 });
    }

    const raw = await req.json().catch(() => ({}));
    const parsed = parseBody(HandlingUnitUnassignBody, raw);
    if (parsed instanceof NextResponse) return parsed;

    const idemKey = readIdempotencyKey(req, parsed.idempotencyKey ?? null);
    if (idemKey) {
      const hit = await getApiIdempotencyResponse(pool, ctx.organizationId, idemKey, ROUTE_HANDLING_UNIT_UNASSIGN);
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

    // Scope the removal to this box: only clear membership for units that are
    // actually in it, so a stray ref can't pull a unit out of a different box.
    const detailBefore = await getHandlingUnitDetail(id);
    const memberIds = new Set((detailBefore?.units ?? []).map((u) => u.id));
    const toRemove = resolved.ids.filter((uid) => memberIds.has(uid));

    const { removed } = await unassignUnits(toRemove);
    const detail = await getHandlingUnitDetail(id);

    await recordAudit(pool, ctx, req, {
      source: 'handling-units-api',
      action: AUDIT_ACTION.HANDLING_UNIT_UNASSIGN,
      entityType: AUDIT_ENTITY.HANDLING_UNIT,
      entityId: id,
      before: { members: Array.from(memberIds) },
      after: { code: box.code, removed: toRemove, removed_count: removed },
    });

    const responseBody = { success: true, handling_unit: detail, removed };
    if (idemKey) {
      await saveApiIdempotencyResponse(pool, {
        orgId: ctx.organizationId,
        idempotencyKey: idemKey,
        route: ROUTE_HANDLING_UNIT_UNASSIGN,
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
  const m = /\/api\/handling-units\/(\d+)\/unassign/.exec(pathname);
  return m ? Number(m[1]) : null;
}
