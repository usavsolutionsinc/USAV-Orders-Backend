import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import pool from '@/lib/db';
import { db } from '@/lib/drizzle/db';
import { appendInventoryEvent } from '@/lib/repositories/inventory/inventoryEvents';
import { recordChange } from '@/lib/repositories/inventory/conditionHistory';
import { CONDITION_GRADE_VALUES } from '@/components/inventory/types';
import { sortSerialUnitToParts } from '@/lib/inventory/parts-sort';

/**
 * POST /api/serial-units/[id]/grade
 *
 * Records a condition assessment on a serial_unit:
 *   1. Updates `serial_units.condition_grade` to the new grade.
 *   2. Appends an `inventory_events` row (event_type=GRADED).
 *   3. Appends a `serial_unit_condition_history` row linked to the event
 *      so the timeline cross-references the audit log.
 *
 * Body: {
 *   new_grade: 'BRAND_NEW'|'USED_A'|'USED_B'|'USED_C'|'PARTS',
 *   cosmetic_notes?: string,
 *   functional_notes?: string,
 *   client_event_id?: string,
 * }
 *
 * Returns 409 when prev_grade == new_grade (the DB CHECK constraint on
 * serial_unit_condition_history rejects no-op writes).
 */
export const POST = withAuth(async (request, ctx) => {
    const segments = request.nextUrl.pathname.split('/').filter(Boolean);
    // .../api/serial-units/[id]/grade → id is segments[-2]
    const idStr = segments[segments.length - 2];
    const serialUnitId = Number(idStr);
    if (!Number.isFinite(serialUnitId) || serialUnitId <= 0) {
        return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 });
    }

    let body: Record<string, unknown> = {};
    try {
        body = await request.json();
    } catch {
        /* empty body handled below */
    }

    const newGrade = String(body.new_grade ?? '').trim().toUpperCase();
    if (!(CONDITION_GRADE_VALUES as ReadonlyArray<string>).includes(newGrade)) {
        return NextResponse.json(
            { ok: false, error: 'new_grade must be one of: ' + CONDITION_GRADE_VALUES.join(', ') },
            { status: 400 },
        );
    }
    const cosmeticNotes = typeof body.cosmetic_notes === 'string' && body.cosmetic_notes.trim() ? body.cosmetic_notes.trim() : null;
    const functionalNotes = typeof body.functional_notes === 'string' && body.functional_notes.trim() ? body.functional_notes.trim() : null;
    const clientEventId = typeof body.client_event_id === 'string' && body.client_event_id.trim() ? body.client_event_id.trim() : null;

    const actorStaffId: number | null =
        typeof ctx.staffId === 'number' && ctx.staffId > 0 ? ctx.staffId : null;

    try {
        const existing = await pool.query<{ condition_grade: string | null; sku: string | null }>(
            `SELECT condition_grade::text AS condition_grade, sku FROM serial_units WHERE id = $1`,
            [serialUnitId],
        );
        if (existing.rows.length === 0) {
            return NextResponse.json({ ok: false, error: 'unit not found' }, { status: 404 });
        }
        const prevGrade = existing.rows[0].condition_grade;
        const sku = existing.rows[0].sku;

        if (prevGrade === newGrade) {
            return NextResponse.json(
                { ok: false, error: 'grade unchanged', current_grade: prevGrade },
                { status: 409 },
            );
        }

        // Update the unit row first so the conditionHistory row reflects the
        // new authoritative state.
        const updated = await pool.query(
            `UPDATE serial_units
             SET condition_grade = $2::condition_grade_enum,
                 updated_at = NOW()
             WHERE id = $1
             RETURNING id, condition_grade::text AS condition_grade, current_status::text AS current_status, updated_at`,
            [serialUnitId, newGrade],
        );

        // Audit + history.
        const { event } = await appendInventoryEvent({
            eventType: 'GRADED',
            clientEventId,
            actorStaffId,
            serialUnitId,
            sku,
            notes: cosmeticNotes || functionalNotes
                ? `cosmetic: ${cosmeticNotes ?? '-'} | functional: ${functionalNotes ?? '-'}`
                : null,
            payload: { prev_grade: prevGrade, new_grade: newGrade },
        });

        await recordChange({
            serialUnitId,
            prevGrade: prevGrade as never,
            newGrade: newGrade as never,
            assessedByStaffId: actorStaffId,
            cosmeticNotes,
            functionalNotes,
            inventoryEventId: event.id,
        });

        // Auto-sort: a unit graded "For Parts" needs no testing or claim — it's
        // routed straight into the Technical Room parts bin (STOCKED, pickable).
        // Best-effort: a sort failure never fails the grade write.
        let partsSort: Awaited<ReturnType<typeof sortSerialUnitToParts>> | null = null;
        if (newGrade === 'PARTS') {
            try {
                partsSort = await sortSerialUnitToParts({
                    serialUnitId,
                    staffId: actorStaffId,
                    station: 'TECH',
                    clientEventId,
                });
            } catch (sortErr) {
                console.warn('[grade] parts auto-sort failed (non-fatal)', sortErr);
            }
        }

        return NextResponse.json({
            ok: true,
            unit: updated.rows[0],
            event_id: event.id,
            parts_sorted: partsSort?.sorted === true,
            parts_bin: partsSort?.sorted === true ? partsSort.bin : null,
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : 'grade failed';
        console.error('[POST /api/serial-units/[id]/grade] error:', err);
        return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
}, { permission: 'serial_units.grade' });

// Drizzle db import keeps tree-shaking happy when only the pool is used in
// future revisions; conditionHistory uses `db` internally.
void db;
