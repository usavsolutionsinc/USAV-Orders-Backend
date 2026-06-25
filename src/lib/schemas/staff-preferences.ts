import { z } from 'zod';

/**
 * Bindable focus-scan hotkey: a single function key F1–F12. Restricted to
 * function keys on purpose — the listener is GLOBAL, so binding a printable
 * key (a letter/digit) would hijack normal typing everywhere. Function keys
 * have no browser default and can't collide with text entry.
 */
export const FOCUS_SCAN_HOTKEY_RE = /^F([1-9]|1[0-2])$/;

/** Default binding when a staffer has never customized it. */
export const DEFAULT_FOCUS_SCAN_HOTKEY = 'F2';

/** Color themes. `light` is the default when a staffer has never customized it. */
export const STAFF_THEMES = ['light', 'dark'] as const;
export type StaffTheme = (typeof STAFF_THEMES)[number];
export const DEFAULT_THEME: StaffTheme = 'light';

/** Selectable sort orders for the unshipped queue (board lanes + dense table). */
const UNSHIPPED_SORTS = ['priority', 'newest', 'deadline', 'price', 'staff'] as const;

/** The three fulfillment lanes, used for the drag-reordered lane order. */
const UNSHIPPED_LANE_STATES = ['PENDING', 'TESTED', 'BLOCKED'] as const;

/** Per-lane prefs for the unshipped shelf board (sort order + expand state). */
/** ISO day-range filter — `null` clears it. Shared by board + per-lane prefs. */
const UNSHIPPED_RANGE = z
  .object({
    from: z.string().nullable().optional(),
    to: z.string().nullable().optional(),
  })
  .strict();

const UNSHIPPED_LANE_PREF = z
  .object({
    sort: z.enum(UNSHIPPED_SORTS).optional(),
    expanded: z.boolean().optional(),
    /** Drag-resized body height (px). `null` clears it; absent leaves it unchanged
     *  — both snap back to the expanded/collapsed preset. */
    height: z.number().int().positive().max(4000).nullable().optional(),
    /** Per-lane date-range filter (each table header owns its own picker). */
    range: UNSHIPPED_RANGE.nullable().optional(),
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
    theme: z.enum(STAFF_THEMES).nullable().optional(),
    unshippedBoard: z
      .object({
        columns: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
        order: z.array(z.enum(UNSHIPPED_LANE_STATES)).optional(),
        range: UNSHIPPED_RANGE.nullable().optional(),
        lanes: z
          .object({
            PENDING: UNSHIPPED_LANE_PREF.optional(),
            TESTED: UNSHIPPED_LANE_PREF.optional(),
            BLOCKED: UNSHIPPED_LANE_PREF.optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();

export type StaffPreferencesPutBody = z.infer<typeof StaffPreferencesPutBody>;
