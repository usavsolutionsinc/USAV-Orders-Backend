/**
 * Pickability predicate — central rule for "can this unit be picked from this bin?"
 *
 * Phase A3 of the WMS modernization. Centralizing exclusion reasons in one
 * predicate means every new exclusion (expiry, hold reasons, regulatory) is
 * one diff here — never scattered across SELECT clauses in every route.
 *
 * The predicate is used in two modes:
 *   1. Reads (allocation queue, search) — embed the SQL fragment via
 *      `pickableSerialUnitsWhereClause()` so the database does the filtering.
 *   2. Writes (state-machine transitions) — call `isAllocatable()` with a
 *      pre-fetched row to verify before mutating.
 *
 * Pair with the bin-roles migration (2026-05-21_inventory_v2_bin_roles.sql).
 */


// ─── Types ───────────────────────────────────────────────────────────────────

export type BinRole =
  | 'PICK_FACE'
  | 'RESERVE'
  | 'STAGING'
  | 'DOCK'
  | 'QUARANTINE'
  | 'DAMAGED'
  | 'RETURNS'
  | 'RECEIVING';

export interface PickabilityCandidate {
  serialStatus: string;
  binRole: BinRole | null;
  lockedForCount: boolean;
  expiresAt: Date | string | null;
}

export type PickabilityReason =
  | 'WRONG_STATUS'
  | 'BIN_ROLE_BLOCKED'
  | 'BIN_LOCKED_FOR_COUNT'
  | 'EXPIRED';

export type PickabilityResult =
  | { ok: true }
  | { ok: false; reason: PickabilityReason; detail: string };

// Bin roles where units are NOT allocatable. Flipping these is a config call;
// keep the list in code so the WMS can run without enum-membership lookups.
const NON_PICKABLE_ROLES: ReadonlySet<BinRole> = new Set([
  'STAGING',
  'DOCK',
  'QUARANTINE',
  'DAMAGED',
  'RETURNS',
  'RECEIVING',
]);

// ─── In-memory predicate (post-fetch validation) ─────────────────────────────

/**
 * Validate a candidate unit + bin pair. Used in write paths after the row is
 * locked via `FOR UPDATE` so we don't race on stale read.
 */
export function isAllocatable(candidate: PickabilityCandidate): PickabilityResult {
  if (candidate.serialStatus !== 'STOCKED') {
    return { ok: false, reason: 'WRONG_STATUS', detail: `current_status=${candidate.serialStatus}` };
  }
  if (candidate.binRole && NON_PICKABLE_ROLES.has(candidate.binRole)) {
    return { ok: false, reason: 'BIN_ROLE_BLOCKED', detail: `bin_role=${candidate.binRole}` };
  }
  if (candidate.lockedForCount) {
    return { ok: false, reason: 'BIN_LOCKED_FOR_COUNT', detail: 'bin locked for cycle count' };
  }
  if (candidate.expiresAt) {
    const expiresAt =
      candidate.expiresAt instanceof Date ? candidate.expiresAt : new Date(candidate.expiresAt);
    if (Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() < Date.now()) {
      return { ok: false, reason: 'EXPIRED', detail: `expired ${expiresAt.toISOString()}` };
    }
  }
  return { ok: true };
}

// ─── SQL builder (read path) ─────────────────────────────────────────────────

/**
 * Returns a SQL WHERE-fragment string that filters a serial_units join to only
 * pickable rows. The fragment references the aliases:
 *   - `su` for serial_units
 *   - `loc` for locations (joined via su.current_location)
 *
 * Callers compose the fragment into their query and pass it through to pg
 * with no parameters — the fragment is parameter-free and safe to interpolate.
 */
export function pickableSerialUnitsWhereClause(): string {
  // ANY(ARRAY[...]) avoids ENUM:: arrays in the SQL since the new role list
  // lives in app code; the cast keeps null-safe via COALESCE.
  return [
    `su.current_status = 'STOCKED'::serial_status_enum`,
    `(loc.id IS NULL OR loc.locked_for_count = false)`,
    `(loc.id IS NULL OR COALESCE(loc.bin_role, 'RESERVE') NOT IN ('STAGING','DOCK','QUARANTINE','DAMAGED','RETURNS','RECEIVING'))`,
    `(su.expires_at IS NULL OR su.expires_at > NOW())`,
  ].join(' AND ');
}

/**
 * Optional `LEFT JOIN` clause that the WHERE fragment expects. Use this when
 * the caller's base FROM clause doesn't already join locations.
 *
 * Example:
 *   SELECT su.id
 *     FROM serial_units su
 *     ${pickableSerialUnitsLeftJoin()}
 *    WHERE ${pickableSerialUnitsWhereClause()}
 */
export function pickableSerialUnitsLeftJoin(): string {
  return 'LEFT JOIN locations loc ON loc.name = su.current_location';
}
