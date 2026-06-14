import { getWeekRangeForOffset } from '@/lib/dashboard-week-range';
import { readShippedFilterPreference } from '@/utils/dashboard-preferences';
import {
  readShippedCarrierFilter,
  readShippedExceptionsFilter,
  readShippedStatusFilter,
} from '@/components/shipping/ShippedFilterToolbar';

type ParamsLike = { get(name: string): string | null };

export interface ResolvedShippedParams {
  shippedFilter: string;
  weekOffset: number;
  weekRange: { startStr: string; endStr: string };
  exceptionsOnly: boolean;
  carrierFilter: string | null;
  statusFilter: string | null;
  hasDateRange: boolean;
  /** URL packedBy/testedBy (component props may override). */
  packedBy?: number;
  testedBy?: number;
  anyCarrierFilter: boolean;
  effectiveWeekStart: string;
  effectiveWeekEnd: string;
}

function parseStaffParam(raw: string | null): number | undefined {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Single source of truth for how the Shipped dashboard turns URL state into the
 * `dashboardShippedQuery` arguments + the client-side filter values. Both the
 * main table (`DashboardShippedTable`) and the sidebar scan-out panel resolve
 * params through here so they build an IDENTICAL React Query key and share one
 * fetch (per the dedupe rule in lib/queries/dashboard-queries.ts).
 */
export function resolveShippedQueryArgs(searchParams: ParamsLike): ResolvedShippedParams {
  const shippedFilterParam = searchParams.get('shippedFilter');
  const shippedFilter =
    shippedFilterParam === 'orders' || shippedFilterParam === 'sku' || shippedFilterParam === 'fba'
      ? shippedFilterParam
      : shippedFilterParam === 'all'
        ? 'all'
        : readShippedFilterPreference() ?? 'all';

  const weekOffsetParam = searchParams.get('shippedWeekOffset');
  const weekOffset =
    weekOffsetParam != null ? Math.max(0, Number.parseInt(weekOffsetParam || '0', 10) || 0) : 0;
  const weekRange = getWeekRangeForOffset(weekOffset);

  const exceptionsOnly = readShippedExceptionsFilter(searchParams);
  const carrierFilter = readShippedCarrierFilter(searchParams);
  const statusFilter = readShippedStatusFilter(searchParams);

  const packedBy = parseStaffParam(searchParams.get('packedBy'));
  const testedBy = parseStaffParam(searchParams.get('testedBy'));

  const dateFrom = (searchParams.get('dateFrom') || '').trim();
  const dateTo = (searchParams.get('dateTo') || '').trim();
  const hasDateRange = /^\d{4}-\d{2}-\d{2}$/.test(dateFrom) && /^\d{4}-\d{2}-\d{2}$/.test(dateTo);

  const anyCarrierFilter = exceptionsOnly || !!carrierFilter || !!statusFilter;
  const effectiveWeekStart = hasDateRange ? dateFrom : anyCarrierFilter ? '' : weekRange.startStr;
  const effectiveWeekEnd = hasDateRange ? dateTo : anyCarrierFilter ? '' : weekRange.endStr;

  return {
    shippedFilter,
    weekOffset,
    weekRange,
    exceptionsOnly,
    carrierFilter: carrierFilter ?? null,
    statusFilter: statusFilter ?? null,
    hasDateRange,
    packedBy,
    testedBy,
    anyCarrierFilter,
    effectiveWeekStart,
    effectiveWeekEnd,
  };
}
