import { useMemo } from 'react';
import {
  getStaffThemeById,
  getPackerInputTheme,
  stationThemeColors,
  stationScanInputBorderClass,
  type StationTheme,
  type StationThemeColors,
  type StationInputThemeClasses,
} from '@/utils/staff-colors';

export type { StationTheme, StationThemeColors, StationInputThemeClasses };

export interface ResolvedTheme {
  /** The resolved theme key (e.g. 'purple', 'green', 'black'). */
  theme: StationTheme;
  /** Core color classes: bg, hover, light, border, text, shadow. */
  colors: StationThemeColors;
  /** Scan input border class for this theme. */
  inputBorder: string;
  /** Packer-style input classes (text, bg, ring, border). Always populated. */
  inputTheme: StationInputThemeClasses;
}

interface StaffInput {
  staffId: number | string | null | undefined;
}

/**
 * Single entry point for station theme resolution.
 *
 * @example
 *   // From a known theme string
 *   const { theme, colors } = useStationTheme('purple');
 *
 * @example
 *   // From a staff ID — resolves dynamically via staff-colors lookup tables
 *   const { theme, colors, inputBorder } = useStationTheme({ staffId: 3 });
 */
export function useStationTheme(input: StationTheme | StaffInput): ResolvedTheme {
  return useMemo(() => {
    const theme: StationTheme =
      typeof input === 'string'
        ? input
        : getStaffThemeById(input.staffId);

    return {
      theme,
      colors: stationThemeColors[theme],
      inputBorder: stationScanInputBorderClass[theme],
      inputTheme: getPackerInputTheme(theme),
    };
  }, [
    typeof input === 'string' ? input : input.staffId,
  ]);
}
