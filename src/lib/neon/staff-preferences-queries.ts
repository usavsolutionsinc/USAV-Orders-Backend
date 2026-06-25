/**
 * Per-staff UI preference queries — a generic JSONB key/value bag, one row per
 * (org, staff). Backs GET/PUT /api/staff-preferences.
 *
 * Every query is scoped by BOTH the verified session's staff_id and the org
 * (explicit filter + GUC via tenantQuery), so a staffer only ever touches their
 * own prefs and never crosses tenants. First consumer: the configurable
 * focus-scan hotkey shared by every StationScanBar.
 */

import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';

/** Known, typed preference keys. The column is open JSONB; this is the contract. */
export interface StaffPreferences {
  /** Function key (F1–F12) that focuses the active scan bar. Absent = default (F2). */
  focusScanHotkey?: string | null;
  /** Color theme. Absent = light (the default). Drives `data-theme` on <html>. */
  theme?: 'light' | 'dark' | null;
  /**
   * Unshipped shelf-board layout prefs (cross-device). `columns` is the 1-up /
   * 2-up bubble layout; `range` is the picked date filter (ISO day strings);
   * `order` is the staffer's drag-reordered lane order (top → bottom); `lanes`
   * holds per-state sort + expand. Callers send the full object since the JSONB
   * merge is shallow at this key.
   */
  unshippedBoard?: {
    columns?: 1 | 2 | 3;
    range?: { from?: string | null; to?: string | null } | null;
    /** Drag-reordered lane order. Any state missing here falls back to the
     *  canonical SHELF_ORDER (appended in order), so a partial list is safe. */
    order?: Array<'PENDING' | 'TESTED' | 'BLOCKED'>;
    lanes?: Partial<
      Record<
        'PENDING' | 'TESTED' | 'BLOCKED',
        {
          sort?: 'priority' | 'newest' | 'deadline' | 'price' | 'staff';
          expanded?: boolean;
          /** Drag-resized body height (px); `null`/absent → expanded/collapsed preset. */
          height?: number | null;
          /** Per-lane date-range filter (each table header owns its own picker). */
          range?: { from?: string | null; to?: string | null } | null;
        }
      >
    >;
  } | null;
}

/** Read one staffer's prefs bag (empty object when no row yet). */
export async function getStaffPreferences(staffId: number, orgId: OrgId): Promise<StaffPreferences> {
  const { rows } = await tenantQuery<{ prefs: StaffPreferences }>(
    orgId,
    `SELECT prefs
       FROM staff_preferences
      WHERE organization_id = $1 AND staff_id = $2
      LIMIT 1`,
    [orgId, staffId],
  );
  return rows[0]?.prefs ?? {};
}

/**
 * Merge a partial patch into the staffer's prefs bag (upsert). The JSONB `||`
 * merge means callers only send the keys they're changing; everything else is
 * preserved. Returns the full, merged prefs.
 */
export async function updateStaffPreferences(
  staffId: number,
  orgId: OrgId,
  patch: StaffPreferences,
): Promise<StaffPreferences> {
  const { rows } = await tenantQuery<{ prefs: StaffPreferences }>(
    orgId,
    `INSERT INTO staff_preferences (organization_id, staff_id, prefs)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (organization_id, staff_id)
     DO UPDATE SET prefs = staff_preferences.prefs || EXCLUDED.prefs,
                   updated_at = now()
     RETURNING prefs`,
    [orgId, staffId, JSON.stringify(patch)],
  );
  return rows[0]?.prefs ?? {};
}

/**
 * Settings-Registry raw merge — write arbitrary top-level namespaced keys (e.g.
 * 'receiving.defaultScanMode') into the prefs bag. Same shallow `||` upsert as
 * updateStaffPreferences but typed for the framework's flat key space (the
 * static StaffPreferences shape is `.strict()` and intentionally doesn't list
 * these framework keys). Returns the full merged bag. See docs/settings-registry.md.
 */
export async function mergeStaffPreferencesRaw(
  staffId: number,
  orgId: OrgId,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { rows } = await tenantQuery<{ prefs: Record<string, unknown> }>(
    orgId,
    `INSERT INTO staff_preferences (organization_id, staff_id, prefs)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (organization_id, staff_id)
     DO UPDATE SET prefs = staff_preferences.prefs || EXCLUDED.prefs,
                   updated_at = now()
     RETURNING prefs`,
    [orgId, staffId, JSON.stringify(patch)],
  );
  return rows[0]?.prefs ?? {};
}
