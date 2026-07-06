import type { StationTheme } from '@/hooks/useStationTheme';

/**
 * Canonical geometry + chrome for every station scan bar. Change padding,
 * height, icon slot, or placeholder styling HERE — not per surface.
 *
 * Stacking (low → high): input @ z-base → sweep/icon @ z-raised → right rail @
 * z-dropdown → armed mode chip @ z-dropdown (outline must clear input border-2).
 */

export const STATION_SCAN_BAR_ICON_SLOT_CLASS =
  'absolute left-3.5 top-1/2 z-raised flex -translate-y-1/2 items-center justify-center -ml-1';

export const STATION_SCAN_BAR_DEFAULT_ICON_CLASS = 'h-[17px] w-[17px]';

export const STATION_SCAN_BAR_PAD_LEFT_CLASS = 'pl-7';

export const STATION_SCAN_BAR_PAD_LEFT_NONE_ICON_CLASS = 'pl-3.5';

export const STATION_SCAN_BAR_INPUT_CLASS =
  'box-border h-10 w-full rounded-xl bg-surface-canvas text-xs font-bold leading-normal text-text-default outline-none transition-all shadow-inner py-2 placeholder:text-text-faint';

export const STATION_SCAN_BAR_RIGHT_SLOT_CLASS =
  'absolute right-3 top-1/2 z-dropdown isolate flex -translate-y-1/2 items-center gap-1.5';

/** Frosted-glass chip rail — floats over the input with no solid fill. */
export const STATION_SCAN_BAR_FLOAT_RAIL_CLASS =
  'rounded-lg border border-white/60 bg-surface-card/40 px-1 py-0.5 shadow-[0_2px_8px_rgba(15,23,42,0.06)] backdrop-blur-md backdrop-saturate-150';

/** Narrower right inset when mode rails / spinners sit inside the bar. */
export const STATION_SCAN_BAR_RIGHT_CONTENT_CLASS = 'right-1.5 gap-0.5';

export const STATION_SCAN_BAR_MODE_BTN =
  'flex h-7 w-7 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-emphasis/60';

export const STATION_SCAN_BAR_MODE_BTN_COMPACT =
  'flex h-6 w-6 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-emphasis/60';

/** Idle mode icon — no solid chip; the glass rail carries the surface. */
export const STATION_SCAN_BAR_MODE_BTN_INACTIVE =
  'relative z-base text-text-soft hover:text-text-muted';

/** Armed mode — translucent tint + ring; stays glassy rather than a flat fill. */
export const STATION_SCAN_BAR_MODE_BTN_ARMED =
  'relative z-dropdown backdrop-blur-sm ring-2 ring-current/35';

export function stationScanBarFocusInputClass(theme: StationTheme): string {
  // Inset ring + box-border keep the entire focus affordance INSIDE the input's
  // own box, so it is never clipped or over-painted by the surrounding sidebar
  // bands (which are sized to the same height as the input). See the receiving
  // scan-band geometry note in ReceivingScanBands.tsx.
  return `focus:ring-2 focus:ring-inset focus:ring-${theme}-500/30 focus:border-${theme}-500`;
}
