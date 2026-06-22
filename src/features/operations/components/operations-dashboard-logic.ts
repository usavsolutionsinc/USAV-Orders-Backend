import type { DashboardCategory, DashboardData } from '@/features/operations/types';
import type { KpiKind } from './KpiDetailsModal';

/** React Query key for the 24h operations dashboard snapshot. */
export const OPERATIONS_QUERY_KEY = ['dashboard-operations', '24h'] as const;

type SummaryCell = DashboardData['summary'][DashboardCategory];
type ActivityEvent = DashboardData['activityFeed'][number];

/** Realtime `kpi_update` message payload. */
export interface KpiUpdateMessage {
  category: DashboardCategory;
  update: SummaryCell;
}

/** Max activity-feed entries retained client-side. */
export const ACTIVITY_FEED_LIMIT = 20;

/** Merge a realtime KPI update into the cached dashboard summary. */
export function mergeKpiUpdate(
  old: DashboardData | undefined,
  msg: KpiUpdateMessage,
): DashboardData | undefined {
  if (!old) return old;
  return { ...old, summary: { ...old.summary, [msg.category]: msg.update } };
}

/** Prepend a realtime activity event, capping the feed at {@link ACTIVITY_FEED_LIMIT}. */
export function prependActivityEvent(
  old: DashboardData | undefined,
  event: ActivityEvent,
): DashboardData | undefined {
  if (!old) return old;
  return { ...old, activityFeed: [event, ...old.activityFeed].slice(0, ACTIVITY_FEED_LIMIT) };
}

/** The summary value backing each KPI tile's details modal. */
export function selectKpiValue(
  kind: KpiKind | null,
  summary: DashboardData['summary'] | undefined,
): number | undefined {
  if (!kind || !summary) return undefined;
  switch (kind) {
    case 'velocity': return summary.all.value;
    case 'tested': return summary.tested.value;
    case 'fba': return summary.fba.value;
    case 'repair': return summary.repair.value;
    default: return undefined;
  }
}
