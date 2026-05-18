import { NextResponse } from 'next/server';
import { transaction } from '@/lib/neon-client';
import { withAuth } from '@/lib/auth/withAuth';
import { isInventoryV2TechLifecycle } from '@/lib/feature-flags';

/**
 * POST /api/tech/test-result
 *
 * Phase 3 of the inventory v2 plan. Records an explicit tech-station test
 * outcome for a single serialized unit. Three actions:
 *
 *   action='start'  →  TEST_START event, unit → IN_TEST
 *   action='pass'   →  TEST_PASS event,  unit → GRADED
 *                       (also records serial_unit_condition_history if a
 *                        new condition_grade differs from the current one)
 *   action='fail'   →  TEST_FAIL event,  unit → IN_REPAIR
 *
 * Body shape:
 *   {
 *     serial_unit_id?: number,
 *     serial_number?: string,        // fallback if id not known
 *     action: 'start' | 'pass' | 'fail',
 *     condition_grade?: 'BRAND_NEW' | 'USED_A' | 'USED_B' | 'USED_C' | 'PARTS',
 *     notes?: string,
 *     client_event_id?: string       // UUID, idempotent retries
 *   }
 *
 * Single transaction. Gated by INVENTORY_V2_TECH_LIFECYCLE; off-flag the
 * endpoint returns 503 so callers can fall back to legacy tech-station flows.
 *
 * Requires permission `tech.test_result` (verified by withAuth).
 */
export const POST = withAuth(async (request, ctx) => {
  if (!isInventoryV2TechLifecycle()) {
    return NextResponse.json(
      {
        ok: false,
        error: 'INVENTORY_V2_TECH_LIFECYCLE flag is OFF',
        flag: 'INVENTORY_V2_TECH_LIFECYCLE',
      },
      { status: 503 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const serialUnitIdRaw = Number(body?.serial_unit_id);
  const serialUnitIdInput =
    Number.isFinite(serialUnitIdRaw) && serialUnitIdRaw > 0 ? Math.floor(serialUnitIdRaw) : null;
  const serialNumberInput = String(body?.serial_number || '').trim() || null;
  const action = String(body?.action || '').trim().toLowerCase() as 'start' | 'pass' | 'fail';
  const conditionGradeInput = String(body?.condition_grade || '').trim().toUpperCase() || null;
  const notes = String(body?.notes || '').trim() || null;
  const clientEventId = String(body?.client_event_id || '').trim() || null;

  if (!serialUnitIdInput && !serialNumberInput) {
    return NextResponse.json(
      { ok: false, error: 'serial_unit_id or serial_number is required' },
      { status: 400 },
    );
  }
  if (action !== 'start' && action !== 'pass' && action !== 'fail') {
    return NextResponse.json(
      { ok: false, error: "action must be 'start' | 'pass' | 'fail'" },
      { status: 400 },
    );
  }
  const validGrades = ['BRAND_NEW', 'USED_A', 'USED_B', 'USED_C', 'PARTS'];
  if (conditionGradeInput && !validGrades.includes(conditionGradeInput)) {
    return NextResponse.json(
      { ok: false, error: `condition_grade must be one of ${validGrades.join(', ')}` },
      { status: 400 },
    );
  }

  const nextStatus = action === 'start' ? 'IN_TEST' : action === 'pass' ? 'GRADED' : 'IN_REPAIR';
  const eventType = action === 'start' ? 'TEST_START' : action === 'pass' ? 'TEST_PASS' : 'TEST_FAIL';

  try {
    const result = await transaction(async (client) => {
      // 1. Resolve the unit. Prefer id; fall back to normalized serial.
      const unitQ = serialUnitIdInput
        ? await client.query<{ id: number; sku: string | null; current_status: string; condition_grade: string | null }>(
            `SELECT id, sku, current_status::text AS current_status, condition_grade::text AS condition_grade
              FROM serial_units WHERE id = $1 LIMIT 1`,
            [serialUnitIdInput],
          )
        : await client.query<{ id: number; sku: string | null; current_status: string; condition_grade: string | null }>(
            `SELECT id, sku, current_status::text AS current_status, condition_grade::text AS condition_grade
              FROM serial_units WHERE normalized_serial = UPPER(TRIM($1)) LIMIT 1`,
            [serialNumberInput],
          );
      const unit = unitQ.rows[0];
      if (!unit) {
        return {
          ok: false as const,
          error: 'serial_units row not found',
          status: 404,
        };
      }

      const prevStatus = unit.current_status;
      const prevGrade = unit.condition_grade;

      // 2. Transition the unit. Optionally update condition_grade on PASS.
      const setGrade =
        action === 'pass' && conditionGradeInput && conditionGradeInput !== prevGrade;
      const update = await client.query<{ id: number }>(
        `UPDATE serial_units
            SET current_status = $1::serial_status_enum,
                condition_grade = COALESCE(NULLIF($2, '')::condition_grade_enum, condition_grade),
                updated_at = NOW()
          WHERE id = $3
          RETURNING id`,
        [nextStatus, setGrade ? conditionGradeInput : '', unit.id],
      );
      if (update.rows.length === 0) {
        throw new Error(`serial_units id ${unit.id} update returned no rows`);
      }

      // 3. Emit the inventory_events row.
      const actorStaffId: number | null =
        typeof ctx.staffId === 'number' && ctx.staffId > 0 ? ctx.staffId : null;
      const eventInsert = await client.query<{ id: number }>(
        `INSERT INTO inventory_events (
          event_type, actor_staff_id, station,
          serial_unit_id, sku,
          prev_status, next_status,
          client_event_id, notes, payload
        )
        VALUES ($1, $2, 'TECH',
                $3, $4,
                $5, $6,
                $7, $8, $9::jsonb)
        ON CONFLICT (client_event_id) DO NOTHING
        RETURNING id`,
        [
          eventType,
          actorStaffId,
          unit.id,
          unit.sku,
          prevStatus,
          nextStatus,
          clientEventId,
          notes,
          JSON.stringify({
            source: 'tech.test-result',
            action,
            condition_grade: setGrade ? conditionGradeInput : prevGrade,
          }),
        ],
      );
      let eventId: number | null = eventInsert.rows[0]?.id ?? null;
      if (eventId == null && clientEventId) {
        const existing = await client.query<{ id: number }>(
          `SELECT id FROM inventory_events WHERE client_event_id = $1 LIMIT 1`,
          [clientEventId],
        );
        eventId = existing.rows[0]?.id ?? null;
      }

      // 4. Condition history — append if grade actually changed.
      let conditionHistoryId: number | null = null;
      if (setGrade) {
        const hist = await client.query<{ id: number }>(
          `INSERT INTO serial_unit_condition_history (
            serial_unit_id, assessed_by_staff_id,
            prev_grade, new_grade,
            inventory_event_id, cosmetic_notes
          )
          VALUES ($1, $2, $3::condition_grade_enum, $4::condition_grade_enum, $5, $6)
          RETURNING id`,
          [
            unit.id,
            actorStaffId,
            prevGrade,
            conditionGradeInput,
            eventId,
            notes,
          ],
        );
        conditionHistoryId = hist.rows[0]?.id ?? null;
      }

      return {
        ok: true as const,
        serialUnitId: unit.id,
        prevStatus,
        nextStatus,
        prevGrade,
        newGrade: setGrade ? conditionGradeInput : prevGrade,
        inventoryEventId: eventId,
        conditionHistoryId,
      };
    });

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json({
      ok: true,
      serial_unit_id: result.serialUnitId,
      prev_status: result.prevStatus,
      next_status: result.nextStatus,
      prev_grade: result.prevGrade,
      new_grade: result.newGrade,
      inventory_event_id: result.inventoryEventId,
      condition_history_id: result.conditionHistoryId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'tech test-result failed';
    console.error('[POST /api/tech/test-result] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'tech.scan_serial' });
