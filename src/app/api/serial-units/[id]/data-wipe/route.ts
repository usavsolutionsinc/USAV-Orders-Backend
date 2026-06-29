import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import pool from '@/lib/db';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import { recordDataWipe, WIPE_METHODS, type WipeMethod } from '@/lib/tech/recordDataWipe';

/**
 * POST /api/serial-units/[id]/data-wipe
 *
 * Records a secure data-erasure / factory-reset for one unit — the electronics
 * refurb compliance gate. Domain logic (DATA_WIPED inventory_event + `data_wiped`
 * workflow tap that routes wiped→grade / failed→repair) lives in
 * src/lib/tech/recordDataWipe; this route is the HTTP shell: validation, the
 * formal audit_logs row, and the response the station UI expects. The wipe does
 * NOT change serial_units.current_status (gate, not a transition), so there is no
 * guard/409 path — only 400 / 404 / 200.
 *
 * Body: { wipe_success: boolean, wipe_method?: 'factory_reset'|'secure_erase'|
 *         'crypto_erase', wipe_cert_ref?: string, notes?: string,
 *         client_event_id?: string }
 */
export const POST = withAuth(async (request, ctx) => {
  const segments = request.nextUrl.pathname.split('/').filter(Boolean);
  // .../api/serial-units/[id]/data-wipe → id is segments[-2]
  const idStr = segments[segments.length - 2];
  const serialUnitId = Number(idStr);
  if (!Number.isFinite(serialUnitId) || serialUnitId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid serial_unit id' }, { status: 400 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    /* empty body handled below */
  }

  if (typeof body.wipe_success !== 'boolean') {
    return NextResponse.json({ ok: false, error: 'wipe_success (boolean) is required' }, { status: 400 });
  }
  const wipeSuccess = body.wipe_success;

  const methodRaw = typeof body.wipe_method === 'string' ? body.wipe_method.trim() : '';
  if (methodRaw && !(WIPE_METHODS as readonly string[]).includes(methodRaw)) {
    return NextResponse.json(
      { ok: false, error: `wipe_method must be one of: ${WIPE_METHODS.join(', ')}` },
      { status: 400 },
    );
  }
  const wipeMethod = methodRaw ? (methodRaw as WipeMethod) : null;
  const wipeCertRef =
    typeof body.wipe_cert_ref === 'string' && body.wipe_cert_ref.trim()
      ? body.wipe_cert_ref.trim().slice(0, 200)
      : null;
  const notesRaw = typeof body.notes === 'string' ? body.notes.trim() : '';
  const notes = notesRaw ? notesRaw.slice(0, 2000) : null;
  const clientEventId =
    typeof body.client_event_id === 'string' && body.client_event_id.trim()
      ? body.client_event_id.trim()
      : null;
  const actorStaffId: number | null =
    typeof ctx.staffId === 'number' && ctx.staffId > 0 ? ctx.staffId : null;

  try {
    const result = await recordDataWipe({
      serialUnitId,
      wipeSuccess,
      wipeMethod,
      wipeCertRef,
      notes,
      clientEventId,
      actorStaffId,
      organizationId: ctx.organizationId,
    });
    if (!result) {
      return NextResponse.json({ ok: false, error: 'unit not found' }, { status: 404 });
    }

    await recordAudit(pool, ctx, request, {
      source: 'tech.data-wipe',
      action: AUDIT_ACTION.TECH_DATA_WIPE,
      entityType: AUDIT_ENTITY.SERIAL_UNIT,
      entityId: result.unit.id,
      method: 'manual',
      before: { status: result.unit.current_status },
      after: { status: result.unit.current_status, wiped: wipeSuccess },
      note: notes,
      extra: {
        wipe_success: wipeSuccess,
        wipe_method: wipeMethod,
        wipe_cert_ref: wipeCertRef,
        serial_number: result.unit.serial_number,
        sku: result.unit.sku,
        inventory_event_id: result.eventId,
      },
    });

    return NextResponse.json({
      ok: true,
      unit: result.unit,
      event_id: result.eventId,
      idempotent: result.idempotent,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'data wipe failed';
    console.error('[POST /api/serial-units/[id]/data-wipe] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'tech.data_wipe' });
