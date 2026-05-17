/**
 * serial_unit_condition_history repository
 * ────────────────────────────────────────────────────────────────────
 * Append-only timeline of per-unit grade changes. The check constraint
 * chk_grade_changed (prev_grade IS DISTINCT FROM new_grade) ensures
 * recordChange() rejects no-op writes at the DB level — callers don't
 * need to pre-check.
 *
 * Pair with appendInventoryEvent() so the timeline and the audit log
 * stay linked via inventory_event_id.
 */
import { db } from '@/lib/drizzle/db';
import { serialUnitConditionHistory } from '@/lib/drizzle/schema';
import type { SerialUnit, SerialUnitConditionHistoryRow } from '@/lib/drizzle/schema';
import { asc, desc, eq } from 'drizzle-orm';

export interface RecordChangeInput {
  serialUnitId: number;
  prevGrade?: SerialUnit['conditionGrade'];
  newGrade: NonNullable<SerialUnit['conditionGrade']>;
  assessedByStaffId?: number | null;
  cosmeticNotes?: string | null;
  functionalNotes?: string | null;
  /** Link to the inventory_events row that produced this assessment. */
  inventoryEventId?: number | null;
}

/**
 * Record a condition change. Throws if prev_grade == new_grade (DB CHECK).
 */
export async function recordChange(input: RecordChangeInput): Promise<SerialUnitConditionHistoryRow> {
  const result = await db
    .insert(serialUnitConditionHistory)
    .values({
      serialUnitId: input.serialUnitId,
      prevGrade: input.prevGrade ?? null,
      newGrade: input.newGrade,
      assessedByStaffId: input.assessedByStaffId ?? null,
      cosmeticNotes: input.cosmeticNotes ?? null,
      functionalNotes: input.functionalNotes ?? null,
      inventoryEventId: input.inventoryEventId ?? null,
    })
    .returning();
  return result[0];
}

export async function listHistoryForUnit(
  serialUnitId: number,
  direction: 'asc' | 'desc' = 'asc',
): Promise<SerialUnitConditionHistoryRow[]> {
  const order = direction === 'asc' ? asc : desc;
  return db
    .select()
    .from(serialUnitConditionHistory)
    .where(eq(serialUnitConditionHistory.serialUnitId, serialUnitId))
    .orderBy(order(serialUnitConditionHistory.assessedAt), order(serialUnitConditionHistory.id));
}
