import pool from '../db';
import {
  findByNormalizedSerial,
  findByUnitUid,
  type Queryable,
} from './serial-units-queries';

/**
 * Handling units (LPN) — license-plated boxes/trays that group serial_units
 * across receipts/POs. The single read/write surface for the
 * /api/handling-units CRUD. See docs/handling-unit-lpn-plan.md.
 *
 * Membership is CURRENT, not historical: a unit's handling_unit_id is the box
 * it is physically in now; moving it reassigns the column.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type HandlingUnitStatus = 'OPEN' | 'STAGED' | 'IN_TEST' | 'CLOSED';

export interface HandlingUnitRow {
  id: number;
  code: string;
  status: HandlingUnitStatus;
  location_id: number | null;
  created_by: number | null;
  created_at: string;
  closed_at: string | null;
  notes: string | null;
}

/** A member unit, slimmed for the box-picker / detail view. */
export interface HandlingUnitMember {
  id: number;
  serial_number: string;
  unit_uid: string | null;
  sku: string | null;
  sku_catalog_id: number | null;
  current_status: string;
  current_location: string | null;
  condition_grade: string | null;
  origin_receiving_line_id: number | null;
}

export interface HandlingUnitRollup {
  total: number;
  tested: number;
  untested: number;
  /** Status the membership implies — used to auto-advance the stored status. */
  derived_status: HandlingUnitStatus | null;
}

export interface HandlingUnitDetail extends HandlingUnitRow {
  location_name: string | null;
  created_by_name: string | null;
  units: HandlingUnitMember[];
  /** Distinct, non-null origin_receiving_line_id across the box's units. */
  receiving_line_ids: number[];
  rollup: HandlingUnitRollup;
}

// A unit counts as "tested" once it has moved past intake. RECEIVED/UNKNOWN are
// the only pre-test states; everything else (TESTED, STOCKED, SHIPPED, RETURNED,
// RMA, SCRAPPED, LABELED, PICKED) is a terminal-or-beyond test outcome.
const UNTESTED_STATUSES = new Set(['UNKNOWN', 'RECEIVED']);

const HU_COLS = `id, code, status, location_id, created_by,
                 created_at::text AS created_at, closed_at::text AS closed_at, notes`;

const MEMBER_COLS = `id, serial_number, unit_uid, sku, sku_catalog_id,
                     current_status::text AS current_status, current_location,
                     condition_grade::text AS condition_grade,
                     origin_receiving_line_id`;

// ─── Reads ──────────────────────────────────────────────────────────────────

export async function getHandlingUnitById(
  id: number,
  executor: Queryable = pool,
): Promise<HandlingUnitRow | null> {
  const r = await executor.query<HandlingUnitRow>(
    `SELECT ${HU_COLS} FROM handling_units WHERE id = $1 LIMIT 1`,
    [id],
  );
  return r.rows[0] ?? null;
}

export async function getHandlingUnitByCode(
  code: string,
  executor: Queryable = pool,
): Promise<HandlingUnitRow | null> {
  const trimmed = String(code || '').trim();
  if (!trimmed) return null;
  const r = await executor.query<HandlingUnitRow>(
    `SELECT ${HU_COLS} FROM handling_units WHERE code = $1 LIMIT 1`,
    [trimmed],
  );
  return r.rows[0] ?? null;
}

export async function listMembers(
  handlingUnitId: number,
  executor: Queryable = pool,
): Promise<HandlingUnitMember[]> {
  const r = await executor.query<HandlingUnitMember>(
    `SELECT ${MEMBER_COLS}
       FROM serial_units
      WHERE handling_unit_id = $1
      ORDER BY created_at ASC, id ASC`,
    [handlingUnitId],
  );
  return r.rows;
}

export function rollupMembers(members: HandlingUnitMember[]): HandlingUnitRollup {
  const total = members.length;
  const tested = members.filter(
    (m) => !UNTESTED_STATUSES.has(String(m.current_status || '').toUpperCase()),
  ).length;
  const untested = total - tested;
  // Only OPEN→IN_TEST→CLOSED is auto-derived from membership. STAGED is an
  // operator-set staging state we never overwrite from here (returns null so
  // the caller keeps the stored value).
  let derived_status: HandlingUnitStatus | null = null;
  if (total > 0) {
    if (tested === 0) derived_status = 'OPEN';
    else if (tested < total) derived_status = 'IN_TEST';
    else derived_status = 'CLOSED';
  }
  return { total, tested, untested, derived_status };
}

/** Full detail for the box page + the testing resolver (receiving_line_ids). */
export async function getHandlingUnitDetail(
  id: number,
): Promise<HandlingUnitDetail | null> {
  const head = await pool.query<
    HandlingUnitRow & { location_name: string | null; created_by_name: string | null }
  >(
    `SELECT ${HU_COLS.split(',').map((c) => `hu.${c.trim()}`).join(', ')},
            l.name AS location_name,
            s.name AS created_by_name
       FROM handling_units hu
       LEFT JOIN locations l ON l.id = hu.location_id
       LEFT JOIN staff s ON s.id = hu.created_by
      WHERE hu.id = $1
      LIMIT 1`,
    [id],
  );
  const row = head.rows[0];
  if (!row) return null;

  const units = await listMembers(id);
  const receiving_line_ids = Array.from(
    new Set(
      units
        .map((u) => u.origin_receiving_line_id)
        .filter((v): v is number => v != null),
    ),
  );

  return {
    ...row,
    units,
    receiving_line_ids,
    rollup: rollupMembers(units),
  };
}

export interface ListHandlingUnitsParams {
  status?: HandlingUnitStatus | null;
  locationId?: number | null;
  limit?: number;
  offset?: number;
}

export interface HandlingUnitListItem extends HandlingUnitRow {
  location_name: string | null;
  unit_count: number;
}

/** Staging-board list with member counts. */
export async function listHandlingUnits(
  params: ListHandlingUnitsParams = {},
): Promise<{ items: HandlingUnitListItem[]; total: number }> {
  const conds: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  if (params.status) {
    conds.push(`hu.status = $${i++}`);
    vals.push(params.status);
  }
  if (params.locationId != null && Number.isFinite(params.locationId)) {
    conds.push(`hu.location_id = $${i++}`);
    vals.push(params.locationId);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const limit = Math.min(Math.max(Number(params.limit ?? 100), 1), 500);
  const offset = Math.max(Number(params.offset ?? 0), 0);

  const [rowsRes, countRes] = await Promise.all([
    pool.query<HandlingUnitListItem>(
      `SELECT hu.id, hu.code, hu.status, hu.location_id, hu.created_by,
              hu.created_at::text AS created_at, hu.closed_at::text AS closed_at, hu.notes,
              l.name AS location_name,
              (SELECT COUNT(*)::int FROM serial_units su WHERE su.handling_unit_id = hu.id) AS unit_count
         FROM handling_units hu
         LEFT JOIN locations l ON l.id = hu.location_id
         ${where}
         ORDER BY hu.created_at DESC, hu.id DESC
         LIMIT $${i} OFFSET $${i + 1}`,
      [...vals, limit, offset],
    ),
    pool.query<{ total: string }>(
      `SELECT COUNT(*) AS total FROM handling_units hu ${where}`,
      vals,
    ),
  ]);

  return {
    items: rowsRes.rows,
    total: Number(countRes.rows[0]?.total ?? 0),
  };
}

// ─── Writes ───────────────────────────────────────────────────────────────────

export interface CreateHandlingUnitInput {
  /** Owning org (ctx.organizationId) — handling_units is org-scoped (Phase B). */
  organizationId: string;
  createdBy: number | null;
  locationId?: number | null;
  notes?: string | null;
  /** External tote barcode (Option C). Omit to auto-mint H-{id} via trigger. */
  code?: string | null;
}

export async function createHandlingUnit(
  input: CreateHandlingUnitInput,
  executor: Queryable = pool,
): Promise<HandlingUnitRow> {
  const r = await executor.query<HandlingUnitRow>(
    `INSERT INTO handling_units (code, location_id, created_by, notes, organization_id)
     VALUES (NULLIF(btrim($1), ''), $2, $3, $4, $5)
     RETURNING ${HU_COLS}`,
    [input.code ?? null, input.locationId ?? null, input.createdBy ?? null, input.notes ?? null, input.organizationId],
  );
  return r.rows[0];
}

/**
 * Resolve operator-supplied unit references — numeric serial_units.id, a `U-{id}`
 * handle, a minted unit_uid, or a bare serial number — to serial_units ids.
 * Returns `{ ids, unresolved }` so the route can 422 on any miss.
 */
export async function resolveUnitRefs(
  refs: string[],
): Promise<{ ids: number[]; unresolved: string[] }> {
  const ids: number[] = [];
  const unresolved: string[] = [];
  for (const raw of refs) {
    const ref = String(raw || '').trim();
    if (!ref) continue;
    const uHandle = /^U-(\d+)$/i.exec(ref);
    const numeric = uHandle ? uHandle[1] : /^\d+$/.test(ref) ? ref : null;
    if (numeric) {
      const r = await pool.query<{ id: number }>(
        `SELECT id FROM serial_units WHERE id = $1 LIMIT 1`,
        [Number(numeric)],
      );
      if (r.rows[0]) { ids.push(Number(r.rows[0].id)); continue; }
    }
    const byUid = await findByUnitUid(ref);
    if (byUid) { ids.push(byUid.id); continue; }
    const bySerial = await findByNormalizedSerial(ref);
    if (bySerial) { ids.push(bySerial.id); continue; }
    unresolved.push(ref);
  }
  // De-dup while preserving order.
  return { ids: Array.from(new Set(ids)), unresolved };
}

/**
 * Assign units to a box (reassign handling_unit_id). Idempotent per unit. Runs
 * in one statement; returns the rows that actually changed box (for the audit
 * before/after). Re-derives + persists the box's rollup status afterward.
 */
export async function assignUnitsToHandlingUnit(
  handlingUnitId: number,
  unitIds: number[],
): Promise<{ moved: number; previous: { id: number; from: number | null }[] }> {
  if (unitIds.length === 0) return { moved: 0, previous: [] };
  const before = await pool.query<{ id: number; handling_unit_id: number | null }>(
    `SELECT id, handling_unit_id FROM serial_units WHERE id = ANY($1::bigint[])`,
    [unitIds],
  );
  const previous = before.rows
    .filter((r) => r.handling_unit_id !== handlingUnitId)
    .map((r) => ({ id: Number(r.id), from: r.handling_unit_id }));

  const upd = await pool.query(
    `UPDATE serial_units
        SET handling_unit_id = $1, updated_at = NOW()
      WHERE id = ANY($2::bigint[])
        AND (handling_unit_id IS DISTINCT FROM $1)`,
    [handlingUnitId, unitIds],
  );

  await refreshHandlingUnitStatus(handlingUnitId);
  // Boxes the units left may now be empty/under-tested — recompute theirs too.
  const sources = Array.from(
    new Set(previous.map((p) => p.from).filter((v): v is number => v != null)),
  );
  await Promise.all(sources.map((src) => refreshHandlingUnitStatus(src)));

  return { moved: upd.rowCount ?? 0, previous };
}

/** Remove units from their box (handling_unit_id → NULL). */
export async function unassignUnits(
  unitIds: number[],
): Promise<{ removed: number; affectedBoxes: number[] }> {
  if (unitIds.length === 0) return { removed: 0, affectedBoxes: [] };
  const before = await pool.query<{ id: number; handling_unit_id: number | null }>(
    `SELECT id, handling_unit_id FROM serial_units
      WHERE id = ANY($1::bigint[]) AND handling_unit_id IS NOT NULL`,
    [unitIds],
  );
  const affectedBoxes = Array.from(
    new Set(before.rows.map((r) => r.handling_unit_id).filter((v): v is number => v != null)),
  );
  const upd = await pool.query(
    `UPDATE serial_units
        SET handling_unit_id = NULL, updated_at = NOW()
      WHERE id = ANY($1::bigint[]) AND handling_unit_id IS NOT NULL`,
    [unitIds],
  );
  await Promise.all(affectedBoxes.map((id) => refreshHandlingUnitStatus(id)));
  return { removed: upd.rowCount ?? 0, affectedBoxes };
}

/**
 * Recompute + persist a box's rollup status from member test state. Never
 * downgrades an operator-set STAGED box, and never reopens a manually CLOSED
 * empty box. Stamps/clears closed_at as the status crosses CLOSED. Safe to call
 * after any membership or verdict change. Best-effort: a rollup failure must not
 * break the triggering mutation.
 */
export async function refreshHandlingUnitStatus(
  handlingUnitId: number,
): Promise<HandlingUnitStatus | null> {
  try {
    const hu = await getHandlingUnitById(handlingUnitId);
    if (!hu) return null;
    const members = await listMembers(handlingUnitId);
    const { derived_status } = rollupMembers(members);
    // Empty box: leave the stored status alone (an empty OPEN box is normal;
    // an empty CLOSED box was closed deliberately).
    if (derived_status == null) return hu.status;
    // Don't stomp an operator's STAGED marker with an auto IN_TEST/OPEN; only
    // the CLOSED terminal overrides STAGED.
    if (hu.status === 'STAGED' && derived_status !== 'CLOSED') return hu.status;
    if (derived_status === hu.status) return hu.status;
    await pool.query(
      `UPDATE handling_units
          SET status = $2,
              closed_at = CASE WHEN $2 = 'CLOSED' THEN COALESCE(closed_at, NOW()) ELSE NULL END
        WHERE id = $1`,
      [handlingUnitId, derived_status],
    );
    return derived_status;
  } catch (err) {
    console.warn('[handling-units] refreshHandlingUnitStatus failed:', err);
    return null;
  }
}

/**
 * Dissolve a handling-unit box (the reverse of {@link createHandlingUnit}) — for
 * an empty/abandoned/mis-scanned H-box. Unassigns every member unit FIRST
 * (handling_unit_id → NULL) so no unit is left pointing at a deleted box, then
 * deletes the box row. Owns the unassign→delete cascade so there are no orphans.
 * `serial_units.handling_unit_id` is ON DELETE SET NULL, so the order is belt-
 * and-braces; doing it explicitly also keeps the units' updated_at fresh.
 * Returns null when the box doesn't exist (already gone).
 */
export async function dissolveHandlingUnit(
  id: number,
): Promise<{ dissolved: HandlingUnitRow; unassigned: number } | null> {
  const hu = await getHandlingUnitById(id);
  if (!hu) return null;
  const upd = await pool.query(
    `UPDATE serial_units SET handling_unit_id = NULL, updated_at = NOW()
      WHERE handling_unit_id = $1`,
    [id],
  );
  await pool.query(`DELETE FROM handling_units WHERE id = $1`, [id]);
  return { dissolved: hu, unassigned: upd.rowCount ?? 0 };
}
