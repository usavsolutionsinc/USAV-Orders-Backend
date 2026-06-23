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
  'box-border h-10 w-full rounded-xl bg-gray-50 text-xs font-bold leading-normal text-gray-900 outline-none transition-all shadow-inner py-2 placeholder:text-gray-400';

export const STATION_SCAN_BAR_RIGHT_SLOT_CLASS =
  'absolute right-3 top-1/2 z-dropdown isolate flex -translate-y-1/2 items-center gap-1.5';

/** Narrower right inset when mode rails / spinners sit inside the bar. */
export const STATION_SCAN_BAR_RIGHT_CONTENT_CLASS = 'right-1.5 gap-0.5';

export const STATION_SCAN_BAR_MODE_BTN =
  'flex h-7 w-7 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400/60';

export const STATION_SCAN_BAR_MODE_BTN_COMPACT =
  'flex h-6 w-6 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400/60';

export const STATION_SCAN_BAR_MODE_BTN_INACTIVE =
  'relative z-base text-gray-400 hover:text-gray-600 hover:bg-gray-100';

/** Armed mode — outer ring + z-dropdown so the tint reads above the input stroke. */
export const STATION_SCAN_BAR_MODE_BTN_ARMED =
  'relative z-dropdown ring-2 ring-current/40';

export function stationScanBarFocusInputClass(theme: StationTheme): string {
  // Inset ring + box-border keep the entire focus affordance INSIDE the input's
  // own box, so it is never clipped or over-painted by the surrounding sidebar
  // bands (which are sized to the same height as the input). See the receiving
  // scan-band geometry note in ReceivingScanBands.tsx.
  return `focus:ring-2 focus:ring-inset focus:ring-${theme}-500/30 focus:border-${theme}-500`;
}
