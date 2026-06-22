import { after } from 'next/server';
import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import pool from '@/lib/db';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import {
  recordTestVerdict,
  GuardRejectedError,
  TEST_VERDICTS,
  type TestVerdict,
} from '@/lib/tech/recordTestVerdict';
import { syncSerialToZohoPo } from '@/lib/receiving/zoho-serial-sync';

/**
 * POST /api/serial-units/[id]/test
 *
 * Records a per-unit testing verdict. The domain logic (status transition,
 * tech_serial_numbers audit, inventory event, testing_results feed, line
 * rollup, workflow-engine tap) lives in src/lib/tech/recordTestVerdict —
 * this route is the HTTP shell: input validation, the verdict-gated
 * permission split, the formal audit_logs row, and the response shape the
 * workspace expects (`receiving-line-updated` live-refresh).
 */

// Formal audit-log verb per verdict. The verdict's timeline display comes from
// the inventory_events row written by recordTestVerdict; this audit_logs row
// is the compliance record (actor/role/ip/request-id + before→after) and is
// what surfaces the verdict in the per-staff audit feed. Tagged
// entity_type=serial_unit (mirrors receiving.scan-serial) so it does NOT
// double-render in the PO/tech timelines, which already show the verdict via
// inventory_events.
const VERDICT_TO_AUDIT_ACTION: Record<TestVerdict, string> = {
  PASS: AUDIT_ACTION.TECH_QC_PASS,
  TEST_AGAIN: AUDIT_ACTION.TECH_QC_RETEST,
  TESTING_FAILED: AUDIT_ACTION.TECH_QC_FAIL,
};

export const POST = withAuth(async (request, ctx) => {
  const segments = request.nextUrl.pathname.split('/').filter(Boolean);
  // .../api/serial-units/[id]/test → id is segments[-2]
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

  const verdictRaw = String(body.verdict ?? '').trim().toUpperCase();
  if (!(TEST_VERDICTS as readonly string[]).includes(verdictRaw)) {
    return NextResponse.json(
      { ok: false, error: `verdict must be one of: ${TEST_VERDICTS.join(', ')}` },
      { status: 400 },
    );
  }
  const verdict = verdictRaw as TestVerdict;

  // Verdict-gated permission split. The floor permission on withAuth
  // (`tech.qc_pass`) confirms the caller is at least a tester; here we
  // additionally enforce the `tech.qc_fail` grant for the failure verdict
  // so a "pass-only" tech can't push units to ON_HOLD. TEST_AGAIN is
  // non-destructive (re-queue) so the floor is sufficient.
  if (verdict === 'TESTING_FAILED' && !ctx.permissions.has('tech.qc_fail')) {
    return NextResponse.json(
      { ok: false, error: 'You do not have the tech.qc_fail permission' },
      { status: 403 },
    );
  }

  // Notes cap matches the SQL TEXT column's practical limit. Anything
  // longer is almost certainly an accidental paste, not legitimate input.
  const notesRaw = typeof body.notes === 'string' ? body.notes.trim() : '';
  const notes = notesRaw ? notesRaw.slice(0, 2000) : null;
  const clientEventId =
    typeof body.client_event_id === 'string' && body.client_event_id.trim()
      ? body.client_event_id.trim()
      : null;
  const actorStaffId: number | null =
    typeof ctx.staffId === 'number' && ctx.staffId > 0 ? ctx.staffId : null;

  try {
    const result = await recordTestVerdict({
      serialUnitId,
      verdict,
      notes,
      clientEventId,
      actorStaffId,
      organizationId: ctx.organizationId,
    });
    if (!result) {
      return NextResponse.json({ ok: false, error: 'unit not found' }, { status: 404 });
    }

    // Post the tester's name to the Zoho PO notes so the line item's history
    // shows who tested it. Fire-and-forget: Zoho sync is best-effort and must
    // never block or break the verdict. Only runs when the unit has a receiving
    // line (orphan units have no PO to annotate).
    const receivingLineId = result.unit.origin_receiving_line_id;
    if (receivingLineId != null) {
      const capturedStaffId = actorStaffId;
      const capturedSerial = result.unit.serial_number;
      const verdictNote = `Verdict: ${verdict}`;
      after(async () => {
        void syncSerialToZohoPo({
          receivingLineId,
          serial: capturedSerial,
          staffId: capturedStaffId,
          notes: verdictNote,
        }).catch((err) => {
          console.warn('[serial-units/test] syncSerialToZohoPo threw', err);
        });
      });
    }

    // Formal audit-log row. recordAudit pulls actor/role/ip/request-id from
    // the auth context + headers and never throws (failures are logged and
    // dropped), so it can't break the verdict.
    await recordAudit(pool, ctx, request, {
      source: 'tech.qc-verdict',
      action: VERDICT_TO_AUDIT_ACTION[verdict],
      entityType: AUDIT_ENTITY.SERIAL_UNIT,
      entityId: result.unit.id,
      method: 'manual',
      before: { status: result.prevStatus },
      after: { status: result.nextStatus },
      note: notes,
      extra: {
        verdict,
        receiving_line_id: result.unit.origin_receiving_line_id,
        serial_number: result.unit.serial_number,
        sku: result.unit.sku,
        inventory_event_id: result.eventId,
      },
    });

    return NextResponse.json({
      ok: true,
      unit: result.unit,
      line: result.line,
      event_id: result.eventId,
    });
  } catch (err) {
    // The unified-engine chokepoint refused this transition (held/shipped/illegal
    // source state) — a client/state error, not a server fault → 409.
    if (err instanceof GuardRejectedError) {
      return NextResponse.json({ ok: false, error: err.message, from: err.from }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : 'test verdict failed';
    console.error('[POST /api/serial-units/[id]/test] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'tech.qc_pass' });
