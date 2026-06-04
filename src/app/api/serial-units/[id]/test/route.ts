import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import pool from '@/lib/db';
import { appendInventoryEvent } from '@/lib/repositories/inventory/inventoryEvents';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';

/**
 * POST /api/serial-units/[id]/test
 *
 * Records a per-unit testing verdict. Unlike receiving's line-level
 * `qa_status`, this endpoint transitions a single `serial_units` row through
 * the existing `serial_status_enum` (no new column required):
 *
 *   PASS         → current_status = 'TESTED'   + inventory_event TEST_PASS
 *   TEST_AGAIN   → current_status = 'IN_TEST'  + inventory_event TEST_START
 *   TESTING_FAIL → current_status = 'ON_HOLD'  + inventory_event TEST_FAIL
 *
 * It also writes a `tech_serial_numbers` audit row (station_source='TECH',
 * tester_id, receiving_line_id, serial_unit_id) so the testing history is
 * cross-referenceable from the unit timeline.
 *
 * After the unit transition, the line's `workflow_status` + `qa_status` are
 * rolled up across all serial_units linked to the same receiving_line:
 *
 *   - all units TESTED (count ≥ quantity_expected) → line DONE / PASSED / ACCEPT
 *   - any unit ON_HOLD                            → line FAILED / FAILED_FUNCTIONAL
 *   - otherwise (still-testing)                   → line IN_TEST / PENDING
 *
 * The updated unit + rolled-up line are returned so the workspace can
 * dispatch `receiving-line-updated` to live-refresh siblings/the rail.
 */

const VERDICTS = ['PASS', 'TEST_AGAIN', 'TESTING_FAILED'] as const;
type Verdict = (typeof VERDICTS)[number];

interface VerdictMapping {
  nextStatus: 'TESTED' | 'IN_TEST' | 'ON_HOLD';
  eventType: 'TEST_PASS' | 'TEST_FAIL' | 'TEST_START';
}

const VERDICT_TO_STATUS: Record<Verdict, VerdictMapping> = {
  PASS: { nextStatus: 'TESTED', eventType: 'TEST_PASS' },
  TEST_AGAIN: { nextStatus: 'IN_TEST', eventType: 'TEST_START' },
  TESTING_FAILED: { nextStatus: 'ON_HOLD', eventType: 'TEST_FAIL' },
};

// Formal audit-log verb per verdict. The verdict's timeline display comes from
// the inventory_events row above; this audit_logs row is the compliance record
// (actor/role/ip/request-id + before→after) and is what surfaces the verdict in
// the per-staff audit feed. Tagged entity_type=serial_unit (mirrors
// receiving.scan-serial) so it does NOT double-render in the PO/tech timelines,
// which already show the verdict via inventory_events.
const VERDICT_TO_AUDIT_ACTION: Record<Verdict, string> = {
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
  if (!(VERDICTS as readonly string[]).includes(verdictRaw)) {
    return NextResponse.json(
      { ok: false, error: `verdict must be one of: ${VERDICTS.join(', ')}` },
      { status: 400 },
    );
  }
  const verdict = verdictRaw as Verdict;
  const mapping = VERDICT_TO_STATUS[verdict];

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
    // 1. Fetch existing unit + its parent receiving_line.
    const existing = await pool.query<{
      id: number;
      serial_number: string;
      current_status: string;
      sku: string | null;
      origin_receiving_line_id: number | null;
    }>(
      `SELECT id, serial_number, current_status::text AS current_status, sku, origin_receiving_line_id
         FROM serial_units
        WHERE id = $1`,
      [serialUnitId],
    );
    if (existing.rows.length === 0) {
      return NextResponse.json({ ok: false, error: 'unit not found' }, { status: 404 });
    }
    const prev = existing.rows[0];
    const lineId = prev.origin_receiving_line_id;

    // 2. Apply the unit's new status. Skip the UPDATE if it's already there
    //    (idempotent retry) but still emit the audit + tsn rows below so the
    //    operator's verdict click leaves a trail.
    let unit = prev;
    if (prev.current_status !== mapping.nextStatus) {
      const updated = await pool.query<{
        id: number;
        serial_number: string;
        current_status: string;
        sku: string | null;
        origin_receiving_line_id: number | null;
      }>(
        `UPDATE serial_units
            SET current_status = $2::serial_status_enum,
                updated_at = NOW()
          WHERE id = $1
          RETURNING id, serial_number, current_status::text AS current_status,
                    sku, origin_receiving_line_id`,
        [serialUnitId, mapping.nextStatus],
      );
      unit = updated.rows[0];
    }

    // 3. Audit row in tech_serial_numbers. Mirrors receive-line.ts' pattern
    //    (station_source defaults to TECH for testing). Only written when
    //    the unit has a parent receiving_line — the table's idempotency
    //    unique index `ux_tsn_receiving_line_serial` is partial
    //    `WHERE receiving_line_id IS NOT NULL`, so a line-less insert would
    //    sidestep the conflict guard and create a duplicate on retry.
    //    Line-less testing is rare (orphan serials); the inventory_events
    //    timeline still captures the verdict for those cases.
    if (lineId != null) {
      try {
        await pool.query(
          `INSERT INTO tech_serial_numbers
             (serial_number, serial_type, tested_by, station_source,
              receiving_line_id, scan_ref, notes, serial_unit_id)
           VALUES ($1, 'SERIAL', $2, 'TECH', $3, $4, $5, $6)
           ON CONFLICT DO NOTHING`,
          [
            (unit.serial_number || '').toUpperCase(),
            actorStaffId,
            lineId,
            verdict,
            notes,
            unit.id,
          ],
        );
      } catch (err) {
        console.warn('[test] tsn audit insert failed (non-fatal):', err);
      }
    }

    // 4. inventory_events row for the unit timeline. The event id is
    //    surfaced in the response so callers can cross-reference the
    //    verdict transition back to the timeline entry (mirrors /grade).
    const { event } = await appendInventoryEvent({
      eventType: mapping.eventType,
      clientEventId,
      actorStaffId,
      station: 'TECH',
      serialUnitId: unit.id,
      receivingLineId: lineId,
      sku: unit.sku,
      prevStatus: prev.current_status,
      nextStatus: mapping.nextStatus,
      notes,
      payload: { verdict },
    });

    // 4b. Recently-Tested feed row. References the unit by id only — serial
    //     number / SKU / condition are JOINed from serial_units at read time
    //     (single source of truth), never copied here. Authoritative state
    //     stays on serial_units, so a write failure here is logged, not fatal.
    try {
      await pool.query(
        `INSERT INTO testing_results
           (serial_unit_id, receiving_line_id, verdict, unit_status,
            tested_by, notes, inventory_event_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [unit.id, lineId, verdict, mapping.nextStatus, actorStaffId, notes, event.id],
      );
    } catch (err) {
      console.warn('[test] testing_results insert failed (non-fatal):', err);
    }

    // 4c. Formal audit-log row. recordAudit pulls actor/role/ip/request-id from
    //     the auth context + headers and never throws (failures are logged and
    //     dropped), so it can't break the verdict. entity=serial_unit keeps it
    //     out of the PO/tech timelines (which render the verdict from
    //     inventory_events) while surfacing it in the per-staff audit feed.
    await recordAudit(pool, ctx, request, {
      source: 'tech.qc-verdict',
      action: VERDICT_TO_AUDIT_ACTION[verdict],
      entityType: AUDIT_ENTITY.SERIAL_UNIT,
      entityId: unit.id,
      method: 'manual',
      before: { status: prev.current_status },
      after: { status: mapping.nextStatus },
      note: notes,
      extra: {
        verdict,
        receiving_line_id: lineId,
        serial_number: unit.serial_number,
        sku: unit.sku,
        inventory_event_id: event.id,
      },
    });

    // 5. Line rollup. Only runs when the unit has a parent line.
    let lineRollup: {
      id: number;
      workflow_status: string | null;
      qa_status: string;
      disposition_code: string;
    } | null = null;

    if (lineId != null) {
      const tally = await pool.query<{
        quantity_expected: number | null;
        total_units: string;
        tested_units: string;
        failed_units: string;
        in_test_units: string;
      }>(
        `SELECT rl.quantity_expected,
                COUNT(su.id) FILTER (WHERE su.id IS NOT NULL)            AS total_units,
                COUNT(su.id) FILTER (WHERE su.current_status = 'TESTED')  AS tested_units,
                COUNT(su.id) FILTER (WHERE su.current_status = 'ON_HOLD') AS failed_units,
                COUNT(su.id) FILTER (WHERE su.current_status = 'IN_TEST') AS in_test_units
           FROM receiving_lines rl
      LEFT JOIN serial_units su ON su.origin_receiving_line_id = rl.id
          WHERE rl.id = $1
          GROUP BY rl.id, rl.quantity_expected`,
        [lineId],
      );

      const t = tally.rows[0];
      if (t) {
        const expected = Number(t.quantity_expected || 0);
        const tested = Number(t.tested_units || 0);
        const failed = Number(t.failed_units || 0);
        const inTest = Number(t.in_test_units || 0);

        // Rollup rules:
        //   - All expected units have been TESTED and no failures
        //     → DONE / PASSED / ACCEPT (line falls off the testing queue).
        //   - Any unit ON_HOLD → FAILED / FAILED_FUNCTIONAL (claim flow).
        //   - Otherwise → IN_TEST / PENDING.
        let nextWorkflow: string;
        let nextQa: string;
        let nextDisposition: string | null = null;
        if (failed > 0) {
          nextWorkflow = 'FAILED';
          nextQa = 'FAILED_FUNCTIONAL';
        } else if (expected > 0 && tested >= expected) {
          nextWorkflow = 'DONE';
          nextQa = 'PASSED';
          nextDisposition = 'ACCEPT';
        } else if (tested + inTest > 0) {
          nextWorkflow = 'IN_TEST';
          nextQa = 'PENDING';
        } else {
          // No verdict landed yet (rare — should at least be the unit we
          // just touched, but defensive).
          nextWorkflow = 'IN_TEST';
          nextQa = 'PENDING';
        }

        const params: unknown[] = [lineId, nextWorkflow, nextQa];
        const sets = [
          `workflow_status = $2::inbound_workflow_status_enum`,
          `qa_status = $3::qa_status_enum`,
        ];
        if (nextDisposition) {
          params.push(nextDisposition);
          sets.push(`disposition_code = $${params.length}::disposition_enum`);
        }

        const rolled = await pool.query<{
          id: number;
          workflow_status: string | null;
          qa_status: string;
          disposition_code: string;
        }>(
          `UPDATE receiving_lines
              SET ${sets.join(', ')},
                  updated_at = NOW()
            WHERE id = $1
            RETURNING id, workflow_status::text AS workflow_status,
                      qa_status::text AS qa_status,
                      disposition_code::text AS disposition_code`,
          params,
        );
        lineRollup = rolled.rows[0] ?? null;
      }
    }

    return NextResponse.json({
      ok: true,
      unit,
      line: lineRollup,
      event_id: event.id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'test verdict failed';
    console.error('[POST /api/serial-units/[id]/test] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'tech.qc_pass' });
