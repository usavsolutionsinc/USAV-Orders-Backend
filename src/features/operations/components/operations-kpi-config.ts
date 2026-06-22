import { Package, Wrench, Activity, Barcode } from '@/components/Icons';
import type { DashboardCategory } from '@/features/operations/types';
import type { KpiKind } from './KpiDetailsModal';

export interface PrimaryKpiConfig {
  /** Modal kind opened on click. */
  kind: KpiKind;
  /** Which `summary` category backs the value + delta. */
  summaryKey: DashboardCategory;
  title: string;
  subtext: string;
  icon: typeof Activity;
  colorTone: 'amber' | 'emerald' | 'orange';
  chartType: 'bar' | 'donut';
  /** Donut progress fill (omitted for bar tiles). */
  progress?: number;
  /** Repair: a `+` delta is bad, so positivity inverts. */
  invertDelta?: boolean;
}

/** The four primary KPI tiles, in display order. */
export const PRIMARY_KPI_CARDS: PrimaryKpiConfig[] = [
  {
    kind: 'velocity',
    summaryKey: 'all',
    title: 'Daily velocity',
    subtext: 'Total units processed',
    icon: Activity,
    colorTone: 'amber',
    chartType: 'bar',
  },
  {
    kind: 'tested',
    summaryKey: 'tested',
    title: 'Tested today',
    subtext: 'QA completed units',
    icon: Barcode,
    colorTone: 'emerald',
    chartType: 'donut',
    progress: 78,
  },
  {
    kind: 'fba',
    summaryKey: 'fba',
    title: 'FBA intake',
    subtext: 'FNSKU shipments today',
    icon: Package,
    colorTone: 'amber',
    chartType: 'bar',
  },
  {
    kind: 'repair',
    summaryKey: 'repair',
    title: 'Repair queue',
    subtext: 'Awaiting service',
    icon: Wrench,
    colorTone: 'orange',
    chartType: 'donut',
    progress: 45,
    invertDelta: true,
  },
];
