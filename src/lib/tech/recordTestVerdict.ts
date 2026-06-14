/**
 * recordTestVerdict — the per-unit testing verdict, extracted from
 * POST /api/serial-units/[id]/test so it has a reusable lib entry point
 * (the route keeps HTTP validation, the verdict-gated permission split and
 * the formal audit_logs row; everything domain-side lives here).
 *
 * Transitions a single `serial_units` row through the existing
 * `serial_status_enum` (no new column required):
 *
 *   PASS         → current_status = 'TESTED'   + inventory_event TEST_PASS
 *   TEST_AGAIN   → current_status = 'IN_TEST'  + inventory_event TEST_START
 *   TESTING_FAIL → current_status = 'ON_HOLD'  + inventory_event TEST_FAIL
 *
 * It also writes a `tech_serial_numbers` audit row (station_source='TECH',
 * tester_id, receiving_line_id, serial_unit_id), a `testing_results` feed
 * row, and rolls the parent line's `workflow_status` + `qa_status` up across
 * all serial_units linked to the same receiving_line:
 *
 *   - all units TESTED (count ≥ quantity_expected) → line DONE / PASSED / ACCEPT
 *   - any unit ON_HOLD                            → line FAILED / FAILED_FUNCTIONAL
 *   - otherwise (still-testing)                   → line IN_TEST / PENDING
 *
 * Finally it taps the workflow engine (`test_verdict`) so the unit's run
 * advances pass/fail — fire-and-forget, an engine error never fails the
 * verdict (see src/lib/workflow/tap.ts).
 */

import pool from '@/lib/db';
import { appendInventoryEvent } from '@/lib/repositories/inventory/inventoryEvents';
import { attachTechSerial } from '@/lib/inventory/tech-serial';
import { tapWorkflow } from '@/lib/workflow/tap';

export const TEST_VERDICTS = ['PASS', 'TEST_AGAIN', 'TESTING_FAILED'] as const;
export type TestVerdict = (typeof TEST_VERDICTS)[number];

interface VerdictMapping {
  nextStatus: 'TESTED' | 'IN_TEST' | 'ON_HOLD';
  eventType: 'TEST_PASS' | 'TEST_FAIL' | 'TEST_START';
}

export const VERDICT_TO_STATUS: Record<TestVerdict, VerdictMapping> = {
  PASS: { nextStatus: 'TESTED', eventType: 'TEST_PASS' },
  TEST_AGAIN: { nextStatus: 'IN_TEST', eventType: 'TEST_START' },
  TESTING_FAILED: { nextStatus: 'ON_HOLD', eventType: 'TEST_FAIL' },
};

export interface TestedUnit {
  id: number;
  serial_number: string;
  current_status: string;
  sku: string | null;
  origin_receiving_line_id: number | null;
}

export interface TestLineRollup {
  id: number;
  workflow_status: string | null;
  qa_status: string;
  disposition_code: string;
}

export interface RecordTestVerdictArgs {
  serialUnitId: number;
  verdict: TestVerdict;
  /** Already trimmed/capped by the caller. */
  notes?: string | null;
  clientEventId?: string | null;
  actorStaffId?: number | null;
  /** Tenant id (ctx.organizationId) — threads through to the workflow tap. */
  organizationId?: string | null;
}

export interface RecordTestVerdictResult {
  unit: TestedUnit;
  prevStatus: string;
  nextStatus: VerdictMapping['nextStatus'];
  line: TestLineRollup | null;
  eventId: number;
}

/** Returns null when the serial unit doesn't exist. */
export async function recordTestVerdict(
  args: RecordTestVerdictArgs,
): Promise<RecordTestVerdictResult | null> {
  const { serialUnitId, verdict } = args;
  const mapping = VERDICT_TO_STATUS[verdict];
  const notes = args.notes ?? null;
  const actorStaffId = args.actorStaffId ?? null;

  // 1. Fetch existing unit + its parent receiving_line.
  const existing = await pool.query<TestedUnit>(
    `SELECT id, serial_number, current_status::text AS current_status, sku, origin_receiving_line_id
       FROM serial_units
      WHERE id = $1`,
    [serialUnitId],
  );
  if (existing.rows.length === 0) return null;
  const prev = existing.rows[0];
  const lineId = prev.origin_receiving_line_id;

  // 2. Apply the unit's new status. Skip the UPDATE if it's already there
  //    (idempotent retry) but still emit the audit + tsn rows below so the
  //    operator's verdict click leaves a trail.
  let unit = prev;
  if (prev.current_status !== mapping.nextStatus) {
    const updated = await pool.query<TestedUnit>(
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
      await attachTechSerial({
        serialNumber: unit.serial_number || '',
        serialUnitId: unit.id,
        stationSource: 'TECH',
        testedBy: actorStaffId,
        receivingLineId: lineId,
        scanRef: verdict,
        notes,
      });
    } catch (err) {
      console.warn('[recordTestVerdict] tsn audit insert failed (non-fatal):', err);
    }
  }

  // 4. inventory_events row for the unit timeline. The event id is surfaced
  //    in the result so callers can cross-reference the verdict transition
  //    back to the timeline entry (mirrors /grade).
  const { event } = await appendInventoryEvent({
    eventType: mapping.eventType,
    clientEventId: args.clientEventId ?? null,
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
          tested_by, notes, inventory_event_id, organization_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, (SELECT organization_id FROM serial_units WHERE id = $1))`,
      [unit.id, lineId, verdict, mapping.nextStatus, actorStaffId, notes, event.id],
    );
  } catch (err) {
    console.warn('[recordTestVerdict] testing_results insert failed (non-fatal):', err);
  }

  // 5. Line rollup. Only runs when the unit has a parent line.
  let lineRollup: TestLineRollup | null = null;

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

      const rolled = await pool.query<TestLineRollup>(
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

  // 6. Workflow-engine tap (fire-and-forget — never throws). The inspection
  //    node maps PASS → pass, TESTING_FAILED → fail; TEST_AGAIN re-parks.
  await tapWorkflow({
    serialUnitId: unit.id,
    event: 'test_verdict',
    input: { verdict },
    staffId: actorStaffId,
    source: 'manual',
    orgId: args.organizationId ?? null,
  });

  return {
    unit,
    prevStatus: prev.current_status,
    nextStatus: mapping.nextStatus,
    line: lineRollup,
    eventId: event.id,
  };
}
