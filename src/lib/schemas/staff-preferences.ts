import { z } from 'zod';
import { THEME_NAMES, type ThemeName } from '@/design-system/themes/registry';

/**
 * Bindable focus-scan hotkey: a single function key F1–F12. Restricted to
 * function keys on purpose — the listener is GLOBAL, so binding a printable
 * key (a letter/digit) would hijack normal typing everywhere. Function keys
 * have no browser default and can't collide with text entry.
 */
export const FOCUS_SCAN_HOTKEY_RE = /^F([1-9]|1[0-2])$/;

/** Default binding when a staffer has never customized it. */
export const DEFAULT_FOCUS_SCAN_HOTKEY = 'F2';

/**
 * Color themes — derived from the theme registry
 * (src/design-system/themes/registry.ts, the SoT), so registering a new
 * palette makes it valid here with zero schema changes. `light` is the
 * default when a staffer has never customized it.
 */
export const STAFF_THEMES = THEME_NAMES;
export type StaffTheme = ThemeName;
export const DEFAULT_THEME: StaffTheme = 'light';

/** ISO day-range filter — `null` clears it. Shared by board + per-lane prefs. */
const BOARD_RANGE = z
  .object({
    from: z.string().nullable().optional(),
    to: z.string().nullable().optional(),
  })
  .strict();

/**
 * Generic swimlane-board prefs — one shape reused by every board surface
 * (Unshipped, Shipped, …) via {@link SwimlaneBoard}. Lane ids and sort ids are
 * open strings here: the SoT for which lanes/sorts are valid lives in each
 * consuming board (which validates + falls back on hydrate), so this schema
 * stays surface-agnostic and a new board needs no schema change.
 */
const BOARD_LANE_PREF = z
  .object({
    sort: z.string().max(40).optional(),
    expanded: z.boolean().optional(),
    /** Drag-resized body height (px). `null` clears it; absent leaves it unchanged
     *  — both snap back to the expanded/collapsed preset. */
    height: z.number().int().positive().max(4000).nullable().optional(),
    /** Per-lane date-range filter (each table header owns its own picker). */
    range: BOARD_RANGE.nullable().optional(),
  })
  .strict();

const BOARD_PREFS = z
  .object({
    columns: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    /** Drag-reordered lane order (lane ids). Unknown/missing ids fall back to the
     *  board's canonical order on hydrate, so a partial list is safe. */
    order: z.array(z.string().max(40)).optional(),
    range: BOARD_RANGE.nullable().optional(),
    lanes: z.record(z.string().max(40), BOARD_LANE_PREF).optional(),
  })
  .strict();

/**
 * PUT body for /api/staff-preferences — a partial patch. Only the keys present
 * are changed (server merges into the JSONB bag). `focusScanHotkey: null`
 * clears the binding back to the default; `theme: null` resets to light.
 */
export const StaffPreferencesPutBody = z
  .object({
    focusScanHotkey: z
      .string()
      .regex(FOCUS_SCAN_HOTKEY_RE, 'Hotkey must be a function key F1–F12')
      .nullable()
      .optional(),
    theme: z.enum(STAFF_THEMES as [ThemeName, ...ThemeName[]]).nullable().optional(),
    /** Per-board swimlane prefs. One generic shape ({@link BOARD_PREFS}) per
     *  surface; add a key here when a new board surface ships. */
    unshippedBoard: BOARD_PREFS.nullable().optional(),
    shippedBoard: BOARD_PREFS.nullable().optional(),
    /**
     * Per-staff list-table column visibility, keyed by TableId. Each table maps
     * to `{ hidden: string[] }`. Sent as the whole map (shallow JSONB merge).
     */
    tableColumns: z
      .record(
        z.string(),
        z
          .object({ hidden: z.array(z.string()).optional() })
          .strict(),
      )
      .nullable()
      .optional(),
  })
  .strict();

export type StaffPreferencesPutBody = z.infer<typeof StaffPreferencesPutBody>;
