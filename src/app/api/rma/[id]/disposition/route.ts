import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { isInventoryV2Rma } from '@/lib/feature-flags';
import { recordDisposition, type DispositionCode } from '@/lib/rma/authorizations';

const VALID_CODES: ReadonlySet<DispositionCode> = new Set([
  'ACCEPT',
  'HOLD',
  'RTV',
  'REWORK',
  'SCRAP',
]);

/**
 * POST /api/rma/[id]/disposition
 *
 * Records a per-unit disposition tied to this RMA. Inserts a row in
 * `return_dispositions` and emits an `inventory_events` NOTE for the unit.
 *
 * Body: {
 *   serial_unit_id?: number,
 *   disposition_code: 'ACCEPT' | 'HOLD' | 'RTV' | 'REWORK' | 'SCRAP',
 *   notes?: string,
 * }
 * Gated by INVENTORY_V2_RMA.
 */
export const POST = withAuth(async (request, ctx) => {
  if (!isInventoryV2Rma()) {
    return NextResponse.json(
      { ok: false, error: 'INVENTORY_V2_RMA flag is OFF', flag: 'INVENTORY_V2_RMA' },
      { status: 503 },
    );
  }
  const actorStaffId: number | null =
    typeof ctx.staffId === 'number' && ctx.staffId > 0 ? ctx.staffId : null;
  if (actorStaffId == null) {
    return NextResponse.json({ ok: false, error: 'authenticated staff required' }, { status: 401 });
  }

  const segments = request.nextUrl.pathname.split('/').filter(Boolean);
  const idStr = segments[segments.length - 2];
  const rmaId = Number(idStr);
  if (!Number.isFinite(rmaId) || rmaId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid rma id' }, { status: 400 });
  }

  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const serialUnitIdRaw = body?.serial_unit_id;
  const serialUnitId =
    typeof serialUnitIdRaw === 'number' && Number.isFinite(serialUnitIdRaw) && serialUnitIdRaw > 0
      ? serialUnitIdRaw
      : null;
  const dispositionCode = String(body?.disposition_code || '') as DispositionCode;
  if (!VALID_CODES.has(dispositionCode)) {
    return NextResponse.json(
      { ok: false, error: `invalid disposition_code: ${dispositionCode}` },
      { status: 400 },
    );
  }
  const notes = typeof body?.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;

  try {
    const result = await recordDisposition({
      rmaId,
      serialUnitId,
      dispositionCode,
      decidedByStaffId: actorStaffId,
      notes,
      organizationId: ctx.organizationId ?? null,
    });
    if (!result.ok) return NextResponse.json(result, { status: result.status });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'disposition failed';
    console.error('[POST /api/rma/[id]/disposition] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'orders.view' });
