import type { StationTheme } from '@/utils/staff-colors';

/**
 * Themed focus ring on the FBA scan input — copied verbatim from the receiving /
 * testing sidebars (`focusRingClass`) so the FBA scan bar reads as the same
 * station component, just wired to FBA's API. Keyed by {@link StationTheme}.
 */
export const FBA_SCAN_FOCUS_RING: Record<StationTheme, string> = {
  green: 'focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500',
  blue: 'focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500',
  purple: 'focus:ring-4 focus:ring-purple-500/10 focus:border-purple-500',
  yellow: 'focus:ring-4 focus:ring-amber-500/10 focus:border-amber-500',
  black: 'focus:ring-4 focus:ring-slate-700/10 focus:border-slate-700', // ds-allow-raw-neutral: identity/tone hue — black staff-theme ring among colored themes
  red: 'focus:ring-4 focus:ring-red-500/10 focus:border-red-500',
  lightblue: 'focus:ring-4 focus:ring-sky-500/10 focus:border-sky-500',
  pink: 'focus:ring-4 focus:ring-pink-500/10 focus:border-pink-500',
};

/**
 * Soft centered staff-tint halo behind the scan input — same gradient family
 * as the receiving sidebar's `bandHaloClass`, so the band feels light/airy
 * instead of a flat-fill block. Keyed by {@link StationTheme}.
 */
export const FBA_SCAN_BAND_HALO: Record<StationTheme, string> = {
  green: 'bg-gradient-to-r from-white via-emerald-50 to-white',
  blue: 'bg-gradient-to-r from-white via-blue-50 to-white',
  purple: 'bg-gradient-to-r from-white via-purple-50 to-white',
  yellow: 'bg-gradient-to-r from-white via-amber-50 to-white',
  black: 'bg-gradient-to-r from-white via-slate-50 to-white',
  red: 'bg-gradient-to-r from-white via-red-50 to-white',
  lightblue: 'bg-gradient-to-r from-white via-sky-50 to-white',
  pink: 'bg-gradient-to-r from-white via-pink-50 to-white',
};
