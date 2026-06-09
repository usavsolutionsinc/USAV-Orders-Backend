import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { parseBody } from '@/lib/schemas/parse';
import { HandlingUnitCreateBody } from '@/lib/schemas/handling-unit';
import {
  createHandlingUnit,
  listHandlingUnits,
  resolveUnitRefs,
  assignUnitsToHandlingUnit,
  getHandlingUnitDetail,
  type HandlingUnitStatus,
} from '@/lib/neon/handling-unit-queries';
import {
  getApiIdempotencyResponse,
  readIdempotencyKey,
  saveApiIdempotencyResponse,
} from '@/lib/api-idempotency';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';

const ROUTE_HANDLING_UNIT_POST = 'handling-unit.post';
const VALID_STATUSES: ReadonlySet<string> = new Set(['OPEN', 'STAGED', 'IN_TEST', 'CLOSED']);

/**
 * GET /api/handling-units?status=&location=&limit=&offset=
 * Staging-board list of boxes/trays with member counts.
 */
export const GET = withAuth(
  async (request: NextRequest) => {
    const { searchParams } = new URL(request.url);
    const statusRaw = String(searchParams.get('status') || '').trim().toUpperCase();
    const status = VALID_STATUSES.has(statusRaw) ? (statusRaw as HandlingUnitStatus) : null;
    const locationRaw = Number(searchParams.get('location'));
    const locationId = Number.isFinite(locationRaw) && locationRaw > 0 ? Math.floor(locationRaw) : null;
    const limit = Math.min(Number(searchParams.get('limit') || 100), 500);
    const offset = Math.max(Number(searchParams.get('offset') || 0), 0);

    const { items, total } = await listHandlingUnits({ status, locationId, limit, offset });
    return NextResponse.json({ success: true, handling_units: items, total, limit, offset });
  },
  { permission: 'handling_unit.view' },
);

/**
 * POST /api/handling-units — mint a box (code auto-mints `H-{id}` unless an
 * external tote `code` is supplied) and optionally seed it with units.
 *
 * Body: { code?, locationId?, notes?, units?: (id|U-id|unit_uid|serial)[], idempotencyKey? }
 */
export const POST = withAuth(
  async (req: NextRequest, ctx) => {
    const raw = await req.json().catch(() => ({}));
    const parsed = parseBody(HandlingUnitCreateBody, raw);
    if (parsed instanceof NextResponse) return parsed;

    const idemKey = readIdempotencyKey(req, parsed.idempotencyKey ?? null);
    if (idemKey) {
      const hit = await getApiIdempotencyResponse(pool, idemKey, ROUTE_HANDLING_UNIT_POST);
      if (hit) return NextResponse.json(hit.response_body, { status: hit.status_code });
    }

    // Resolve any seed units up front so a bad ref fails before we mint an
    // empty orphan box.
    let unitIds: number[] = [];
    if (parsed.units && parsed.units.length > 0) {
      const resolved = await resolveUnitRefs(parsed.units);
      if (resolved.unresolved.length > 0) {
        return NextResponse.json(
          { success: false, error: 'Some units could not be resolved', unresolved: resolved.unresolved },
          { status: 422 },
        );
      }
      unitIds = resolved.ids;
    }

    let box;
    try {
      box = await createHandlingUnit({
        createdBy: ctx.staffId,
        locationId: parsed.locationId ?? null,
        notes: parsed.notes ?? null,
        code: parsed.code ?? null,
      });
    } catch (error: unknown) {
      const e = error as { code?: string; message?: string };
      if (e?.code === '23505') {
        return NextResponse.json(
          { success: false, error: 'A handling unit with that code already exists' },
          { status: 409 },
        );
      }
      throw error;
    }

    if (unitIds.length > 0) {
      await assignUnitsToHandlingUnit(box.id, unitIds);
    }

    const detail = await getHandlingUnitDetail(box.id);

    await recordAudit(pool, ctx, req, {
      source: 'handling-units-api',
      action: AUDIT_ACTION.HANDLING_UNIT_CREATE,
      entityType: AUDIT_ENTITY.HANDLING_UNIT,
      entityId: box.id,
      before: null,
      after: { code: box.code, location_id: box.location_id, seeded_units: unitIds.length },
    });

    const responseBody = { success: true, handling_unit: detail ?? box };
    if (idemKey) {
      await saveApiIdempotencyResponse(pool, {
        idempotencyKey: idemKey,
        route: ROUTE_HANDLING_UNIT_POST,
        staffId: ctx.staffId,
        statusCode: 201,
        responseBody,
      });
    }
    return NextResponse.json(responseBody, { status: 201 });
  },
  { permission: 'handling_unit.manage' },
);
