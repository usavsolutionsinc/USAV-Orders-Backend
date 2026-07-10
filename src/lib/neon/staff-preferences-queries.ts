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

/**
 * Per-lane prefs inside a swimlane board. Lane ids and `sort` are open strings:
 * the valid set is owned by each board surface (which validates + falls back on
 * hydrate), so one shape serves every board. See {@link SwimlaneBoard}.
 */
export interface BoardLanePref {
  sort?: string;
  expanded?: boolean;
  /** Drag-resized body height (px); `null`/absent → expanded/collapsed preset. */
  height?: number | null;
  /** Per-lane date-range filter (each lane header owns its own picker). */
  range?: { from?: string | null; to?: string | null } | null;
}

/**
 * Generic swimlane-board layout prefs (cross-device), reused per surface.
 * `columns` is the 1/2/3-up bubble layout; `order` is the staffer's
 * drag-reordered lane order (lane ids; unknown/missing ids fall back to the
 * board's canonical order); `lanes` holds per-lane sort/expand/height/range.
 * Callers send the full object since the JSONB merge is shallow at this key.
 */
export interface BoardPrefs {
  columns?: 1 | 2 | 3;
  order?: string[];
  range?: { from?: string | null; to?: string | null } | null;
  lanes?: Record<string, BoardLanePref>;
}

/** Top-level prefs keys that hold a {@link BoardPrefs} bag (one per board surface). */
export type BoardPrefsKey =
  | 'unshippedBoard'
  | 'shippedBoard'
  | 'techHistoryBoard'
  | 'packerHistoryBoard'
  | 'receivingHistoryBoard'
  | 'receivingIncomingBoard'
  | 'testingHistoryBoard';

/** Known, typed preference keys. The column is open JSONB; this is the contract. */
export interface StaffPreferences {
  /** Function key (F1–F12) that focuses the active scan bar. Absent = default (F2). */
  focusScanHotkey?: string | null;
  /**
   * Color theme name from the theme registry (light | dark | mono | slate —
   * see src/design-system/themes/registry.ts). Absent = light (the default).
   * Drives `data-theme` / `data-color-scheme` on <html>; unknown values fall
   * back to light at apply time, so stale prefs are harmless.
   */
  theme?: string | null;
  /**
   * "Skip for now" on the dashboard Getting-Started checklist. `true` hides the
   * card; absent/`null` shows it while activation steps remain incomplete.
   */
  onboardingDismissed?: boolean | null;
  /**
   * Unshipped · Shelf-board layout prefs (cross-device). Lanes are PENDING /
   * TESTED / BLOCKED; see {@link BoardPrefs} for the shape. One board surface =
   * one key; the generic {@link SwimlaneBoard} reads/writes `prefs[prefsKey]`.
   */
  unshippedBoard?: BoardPrefs | null;
  /**
   * Dashboard · Shipped board layout prefs (cross-device). Lanes are the
   * outbound states (`OUTBOUND_STATE_META`); same shape as {@link BoardPrefs}.
   */
  shippedBoard?: BoardPrefs | null;
  /**
   * Station history Pipeline-board layout prefs (cross-device), one bag per
   * station surface — same {@link BoardPrefs} shape as the dashboard boards.
   * Lanes come from the station lane SoT modules (`tech-board-lanes.ts`, …).
   */
  techHistoryBoard?: BoardPrefs | null;
  packerHistoryBoard?: BoardPrefs | null;
  receivingHistoryBoard?: BoardPrefs | null;
  receivingIncomingBoard?: BoardPrefs | null;
  testingHistoryBoard?: BoardPrefs | null;
  /**
   * Per-staff column visibility for the shared list tables, keyed by TableId
   * ('receiving' | 'orders' | 'shipped' | 'tech' | 'packer'). `hidden` lists the
   * column keys this staffer turned off (chip keys platform/orderid/tracking/
   * serial, or meta keys qty/condition/rest). Absent = every column shown. The
   * JSONB merge is shallow at this key, so writers send the whole map. See
   * src/lib/tables/table-columns.ts + TableColumnConfigProvider.
   */
  tableColumns?: Record<string, { hidden?: string[] }> | null;
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
