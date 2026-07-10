/**
 * Shared color-mode logic for the warehouse map surfaces.
 *
 * Single source of truth for the bin tone (Tailwind class string) and display
 * value per map view mode, consumed by BOTH renderers so they can never drift:
 *   - the flat table map  (WarehouseMap.tsx)
 *   - the React Flow floor plan (WarehouseFloorPlan.tsx)
 *
 * Extracted from WarehouseMap.tsx per docs/todo/warehouse-map-react-flow-plan.md §6.1.
 * No React / React Flow imports here on purpose — just strings and numbers.
 */

import type { BinsOverviewRow } from '@/hooks/useBinsOverview';

export type MapViewMode = 'fill' | 'age' | 'issues';

/**
 * Bin color per view mode:
 *   fill   — green (low) → amber (high) → red (over)
 *   age    — green (recent) → amber → purple (stale)
 *   issues — gray (ok), amber (low), red (over), purple (stale), slate (empty)
 */
export function cellTone(row: BinsOverviewRow, mode: MapViewMode): string {
  if (mode === 'fill') {
    const p = row.fill_pct;
    if (p == null) return 'bg-surface-strong text-text-soft';
    if (p === 0) return 'bg-surface-sunken text-text-faint';
    if (p > 1) return 'bg-red-500 text-white';
    if (p > 0.95) return 'bg-amber-400 text-amber-900';
    if (p > 0.5) return 'bg-emerald-400 text-emerald-900';
    return 'bg-emerald-200 text-emerald-900';
  }
  if (mode === 'age') {
    if (!row.last_counted) return 'bg-purple-400 text-white';
    const days = (Date.now() - new Date(row.last_counted).getTime()) / 86_400_000;
    if (days > 90)  return 'bg-purple-400 text-white';
    if (days > 30)  return 'bg-amber-300 text-amber-900';
    if (days > 7)   return 'bg-emerald-300 text-emerald-900';
    return 'bg-emerald-500 text-white';
  }
  // issues
  if (row.is_over_capacity) return 'bg-red-500 text-white';
  if (row.is_stale)         return 'bg-purple-400 text-white';
  if (row.has_low_stock)    return 'bg-amber-400 text-amber-900';
  if (row.is_empty)         return 'bg-surface-strong text-text-soft';
  return 'bg-emerald-300 text-emerald-900';
}

/** The number shown inside a bin cell/node for the active mode. */
export function cellValue(row: BinsOverviewRow, mode: MapViewMode): string {
  if (mode === 'fill' && row.fill_pct != null) return String(Math.round(row.fill_pct * 100));
  return String(row.total_qty);
}

/** Hover/aria summary for a bin — identical on the table and the floor plan. */
export function cellLabel(row: BinsOverviewRow): string {
  return `${row.barcode ?? row.name} · ${row.total_qty} unit${row.total_qty === 1 ? '' : 's'}`;
}

export interface MapLegendItem {
  tone: string;
  label: string;
}

/** Legend swatches per view mode (must stay in lockstep with cellTone). */
export const MAP_LEGEND: Record<MapViewMode, MapLegendItem[]> = {
  fill: [
    { tone: 'bg-surface-sunken', label: 'Empty' },
    { tone: 'bg-emerald-200', label: '<50%' },
    { tone: 'bg-emerald-400', label: '50–95%' },
    { tone: 'bg-amber-400', label: '95–100%' },
    { tone: 'bg-red-500', label: 'Over' },
  ],
  age: [
    { tone: 'bg-emerald-500', label: '≤ 7 days' },
    { tone: 'bg-emerald-300', label: '8–30 days' },
    { tone: 'bg-amber-300',  label: '31–90 days' },
    { tone: 'bg-purple-400', label: '> 90d / never' },
  ],
  issues: [
    { tone: 'bg-emerald-300', label: 'OK' },
    { tone: 'bg-surface-strong',  label: 'Empty' },
    { tone: 'bg-amber-400',  label: 'Low' },
    { tone: 'bg-purple-400', label: 'Stale' },
    { tone: 'bg-red-500',    label: 'Over' },
  ],
};
