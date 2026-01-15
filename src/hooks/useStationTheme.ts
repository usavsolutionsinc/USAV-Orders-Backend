import { useMemo } from 'react';

export type ThemeColor = 'green' | 'blue' | 'purple';

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
        const themes: Record<ThemeColor, ThemeColors> = {
            green: {
                bg: 'bg-emerald-600',
                hover: 'hover:bg-emerald-700',
                light: 'bg-emerald-50',
                border: 'border-emerald-100',
                text: 'text-emerald-600',
                shadow: 'shadow-emerald-100'
            },
            blue: {
                bg: 'bg-blue-600',
                hover: 'hover:bg-blue-700',
                light: 'bg-blue-50',
                border: 'border-blue-100',
                text: 'text-blue-600',
                shadow: 'shadow-blue-100'
            },
            purple: {
                bg: 'bg-purple-600',
                hover: 'hover:bg-purple-700',
                light: 'bg-purple-50',
                border: 'border-purple-100',
                text: 'text-purple-600',
                shadow: 'shadow-purple-100'
            }
        };

        return themes[color];
    }, [color]);
}
