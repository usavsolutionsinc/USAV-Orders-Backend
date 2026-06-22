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
  })
  .strict();

export type StaffPreferencesPutBody = z.infer<typeof StaffPreferencesPutBody>;
