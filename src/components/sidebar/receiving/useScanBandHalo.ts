'use client';

/**
 * Maps the active operator's station theme color to the soft centered-halo
 * gradient behind the scan input. The tint fades in toward the middle of the
 * band and back to white on the edges (not a flat fill) so the bar stays
 * light/airy. Extracted verbatim from ReceivingSidebarPanel.
 */

import type { StationTheme } from '@/hooks/useStationTheme';

const BAND_HALO_CLASS: Record<StationTheme, string> = {
  green: 'bg-gradient-to-r from-white via-emerald-50 to-white',
  blue: 'bg-gradient-to-r from-white via-blue-50 to-white',
  purple: 'bg-gradient-to-r from-white via-purple-50 to-white',
  yellow: 'bg-gradient-to-r from-white via-amber-50 to-white',
  black: 'bg-gradient-to-r from-white via-slate-50 to-white',
  red: 'bg-gradient-to-r from-white via-red-50 to-white',
  lightblue: 'bg-gradient-to-r from-white via-sky-50 to-white',
  pink: 'bg-gradient-to-r from-white via-pink-50 to-white',
};

/** Returns the halo gradient class for a station theme color. */
export function scanBandHaloClass(themeColor: StationTheme): string {
  return BAND_HALO_CLASS[themeColor];
}
