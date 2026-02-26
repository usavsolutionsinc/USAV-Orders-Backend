import { useMemo } from 'react';
import { stationThemeColors, type StationTheme } from '@/utils/staff-colors';

export type ThemeColor = StationTheme;

export interface ThemeColors {
    bg: string;
    hover: string;
    light: string;
    border: string;
    text: string;
    shadow: string;
}

/**
 * Hook to get consistent theme colors for station components
 * @param color - The theme color variant
 * @returns Theme color classes for Tailwind CSS
 */
export function useStationTheme(color: ThemeColor = 'purple'): ThemeColors {
    return useMemo(() => {
        return stationThemeColors[color];
    }, [color]);
}
