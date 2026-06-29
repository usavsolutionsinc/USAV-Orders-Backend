'use client';

import { useMemo } from 'react';
import { getMonthRangeForOffset } from '@/lib/dashboard-week-range';
import type { DateRangePreset } from '@/components/ui/DateRangeHeader';
import type { ShippedTableFilters } from './useShippedTableFilters';

interface Range {
  startStr: string;
  endStr: string;
}

export interface ShippedPeriodControls {
  /** Active explicit (non-week) range, or null when on a week. */
  activeRange: Range | null;
  /** This week / Last week / This month / Last month presets. */
  presets: DateRangePreset[];
  /** Apply an arbitrary calendar range. */
  onSelectCustomRange: (range: Range) => void;
  /** Reset to the current week (only when off it). */
  onClear?: () => void;
}

const eq = (a: Range, b: Range) => a.startStr === b.startStr && a.endStr === b.endStr;

/**
 * Maps the shipped table's URL period state onto the {@link DateRangePickerPill}
 * vocabulary: the four week/month presets, a custom-range handler, the active
 * explicit range, and a reset. Shared by the list header and the board header so
 * both pills behave identically. Every handler is a single atomic URL write via
 * the filters hook's `setPeriod*` setters.
 */
export function useShippedPeriodControls(filters: ShippedTableFilters): ShippedPeriodControls {
  const { hasDateRange, dateFrom, dateTo, weekOffset, setPeriodWeek, setPeriodRange, clearPeriod } = filters;

  return useMemo(() => {
    const activeRange: Range | null = hasDateRange ? { startStr: dateFrom, endStr: dateTo } : null;
    const monthThis = getMonthRangeForOffset(0);
    const monthLast = getMonthRangeForOffset(1);

    const presets: DateRangePreset[] = [
      { label: 'This week', active: !activeRange && weekOffset === 0, onSelect: () => setPeriodWeek(0) },
      { label: 'Last week', active: !activeRange && weekOffset === 1, onSelect: () => setPeriodWeek(1) },
      {
        label: 'This month',
        active: !!activeRange && eq(activeRange, monthThis),
        onSelect: () => setPeriodRange(monthThis.startStr, monthThis.endStr),
      },
      {
        label: 'Last month',
        active: !!activeRange && eq(activeRange, monthLast),
        onSelect: () => setPeriodRange(monthLast.startStr, monthLast.endStr),
      },
    ];

    return {
      activeRange,
      presets,
      onSelectCustomRange: (range: Range) => setPeriodRange(range.startStr, range.endStr),
      onClear: activeRange || weekOffset > 0 ? () => clearPeriod() : undefined,
    };
  }, [hasDateRange, dateFrom, dateTo, weekOffset, setPeriodWeek, setPeriodRange, clearPeriod]);
}
