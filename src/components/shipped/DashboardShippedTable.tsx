'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Check, Loader2 } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { DateGroupHeader } from '@/components/ui/DateGroupHeader';
import WeekHeader from '@/components/ui/WeekHeader';
import { SkeletonList } from '@/design-system';
import { sectionLabel, fieldLabel } from '@/design-system/tokens/typography/presets';
import type { DashboardSearchSectionProps } from '@/components/dashboard/DashboardSearchSectionProps';
import { mainStickyHeaderClass, mainStickyHeaderRowClass } from '@/components/layout/header-shell';
import { PaneHeader } from '@/components/ui/pane-header';
import {
  FnskuChip,
  OrderIdChip,
  OrderIdChipPlaceholder,
  TrackingOrSkuScanChip,
  SerialChip,
  PlatformChip,
  getLast4,
} from '@/components/ui/CopyChip';
import { ChipColumns, CHIP_COL } from '@/components/ui/ChipColumns';
import { RowTitle, RowMetaColumns, META_COL } from '@/components/ui/RowMetaColumns';
import { useTableSelectMode } from '@/hooks/useTableSelectMode';
import { DASHBOARD_ORDERS_SELECTION_SCOPE } from '@/lib/selection/dashboard-scopes';
import { isStalled, CarrierStatusIcon } from '@/components/shipping/ShipmentStatusBadge';
import {
  readShippedCarrierFilter,
  readShippedExceptionsFilter,
  readShippedStatusFilter,
} from '@/components/shipping/ShippedFilterToolbar';
import { toPSTDateKey } from '@/utils/date';
import { ShippedOrder } from '@/lib/neon/orders-queries';
import { dashboardShippedQuery } from '@/lib/queries/dashboard-queries';
import { useShippedSearch } from '@/hooks/useShippedSearch';
import { getWeekRangeForOffset } from '@/lib/dashboard-week-range';
import { dispatchCloseShippedDetails, dispatchOpenShippedDetails, getOpenShippedDetailsPayload } from '@/utils/events';
import type { PackerRecord } from '@/hooks/usePackerLogs';
import { getOrderDisplayValues } from '@/utils/order-display';
import { getOrderPlatformLabel, getOrderPlatformColor, getOrderPlatformBorderColor, isFbaOrder } from '@/utils/order-platform';
import { getExternalUrlByItemNumber, skuScanPrefixBeforeColon } from '@/hooks/useExternalItemUrl';
import { isSkuSourceRecord } from '@/utils/source-dot';
import { normalizeShippedSearchField } from '@/lib/shipped-search';
import {
  readShippedFilterPreference,
  writeShippedFilterPreference,
} from '@/utils/dashboard-preferences';
import { getStaffName } from '@/utils/staff';
import { StaffInitials } from '@/design-system/components/StaffBadge';
import { OrderSearchEmptyState } from '@/components/dashboard/OrderSearchEmptyState';
import { useUIModeOptional } from '@/design-system/providers/UIModeProvider';
import {
  dashboardOrderRowChipsClass,
  dashboardOrderRowShellClass,
} from '@/lib/dashboard-order-row-layout';
import { OUTBOUND_STATE_META } from '@/lib/outbound-state';
import {
  dedupeShippedRecords,
  deriveShippedRecord,
  type DerivedPackerRecord,
} from '@/lib/shipped-records';

// FBA records are identified by scan_ref matching Amazon's FBA shipment ID format
// (FBAxxxxxxxx) or by tracking_type being 'FBA' / 'FNSKU'.
const FBA_SHIPMENT_ID_RE = /^FBA[0-9A-Z]{8,}$/i;
function isFbaPackerRecord(record: { scan_ref?: string | null; tracking_type?: string | null }): boolean {
  const scanRef = String(record.scan_ref || '').trim();
  const ttype = String(record.tracking_type || '').toUpperCase();
  return FBA_SHIPMENT_ID_RE.test(scanRef) || ttype === 'FBA' || ttype === 'FNSKU';
}
// SKU records are identified by tracking_type === 'SKU' (set by packer_logs.tracking_type)
// or by scan_ref containing ':' (the "SKU_VALUE:QUANTITY" format used at the pack station).
function isSkuPackerRecord(record: { scan_ref?: string | null; tracking_type?: string | null }): boolean {
  const ttype = String(record.tracking_type || '').toUpperCase();
  if (ttype === 'SKU') return true;
  const scanRef = String(record.scan_ref || '').trim();
  return scanRef.includes(':');
}

function hasLinkedOrder(record: { order_row_id?: number | null; order_id?: string | null }): boolean {
  if (record.order_row_id != null) return true;
  return String(record.order_id || '').trim().length > 0;
}

function isExceptionPackerRecord(record: { row_source?: string | null; exception_reason?: string | null }): boolean {
  return String(record.row_source || '').trim().toLowerCase() === 'exception'
    || !!String(record.exception_reason || '').trim();
}

export interface DashboardShippedTableProps {
  packedBy?: number;
  testedBy?: number;
  /** Mobile tech/packer: one scroll column, no extra shell wrappers; WeekHeader matches other mobile week tables. */
  embedded?: boolean;
  /** Pencil multi-select: rows render checkboxes; the page owns the action bar. */
  selectMode?: boolean;
  bannerTitle?: DashboardSearchSectionProps['bannerTitle'];
  bannerSubtitle?: DashboardSearchSectionProps['bannerSubtitle'];
  searchEmptyTitle?: DashboardSearchSectionProps['searchEmptyTitle'];
  searchResultLabel?: DashboardSearchSectionProps['searchResultLabel'];
  clearSearchLabel?: DashboardSearchSectionProps['clearSearchLabel'];
}

export function DashboardShippedTable({
  packedBy,
  testedBy,
  embedded = false,
  selectMode = false,
  bannerTitle,
  bannerSubtitle,
  searchEmptyTitle = 'No shipped orders found',
  searchResultLabel = 'shipped orders',
  clearSearchLabel = 'Show All Shipped Orders',
}: DashboardShippedTableProps = {}) {
  const { isMobile } = useUIModeOptional();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [selectedDetailId, setSelectedDetailId] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const shippedSearchField = normalizeShippedSearchField(searchParams.get('shippedSearchField'));
  const shippedFilterParam = searchParams.get('shippedFilter');
  const shippedFilter = useMemo(() => {
    if (shippedFilterParam === 'orders' || shippedFilterParam === 'sku' || shippedFilterParam === 'fba') {
      return shippedFilterParam;
    }
    if (shippedFilterParam === 'all') return 'all';
    return readShippedFilterPreference() ?? 'all';
  }, [shippedFilterParam]);
  const weekOffsetParam = searchParams.get('shippedWeekOffset');
  const weekOffset = useMemo(() => {
    if (weekOffsetParam != null) {
      return Math.max(0, Number.parseInt(weekOffsetParam || '0', 10) || 0);
    }
    return 0;
  }, [weekOffsetParam]);
  const weekRange = getWeekRangeForOffset(weekOffset);

  const exceptionsOnly = readShippedExceptionsFilter(searchParams);
  const carrierFilter = readShippedCarrierFilter(searchParams);
  const statusFilter = readShippedStatusFilter(searchParams);
  // Click-to-filter from the outbound status legend (`?ostatus`). Narrows the
  // already-loaded week records by exact derived state — week-scoped, so it
  // stays in lockstep with the legend's week counts (no all-time widening).
  // The Exception chip folds PROCESS_GAP (same bucket the legend renders).
  const obStatus = String(searchParams.get('ostatus') || '').trim().toUpperCase();
  const matchesOutbound = useCallback(
    (r: PackerRecord): boolean => {
      if (!obStatus) return true;
      const s = deriveShippedRecord(r).outboundState;
      return obStatus === 'EXCEPTION' ? s === 'EXCEPTION' || s === 'PROCESS_GAP' : s === obStatus;
    },
    [obStatus],
  );

  const parseStaffParam = (raw: string | null): number | undefined => {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const effPackedBy = packedBy ?? parseStaffParam(searchParams.get('packedBy'));
  const effTestedBy = testedBy ?? parseStaffParam(searchParams.get('testedBy'));

  const dateFrom = (searchParams.get('dateFrom') || '').trim();
  const dateTo = (searchParams.get('dateTo') || '').trim();
  const hasDateRange =
    /^\d{4}-\d{2}-\d{2}$/.test(dateFrom) && /^\d{4}-\d{2}-\d{2}$/.test(dateTo);

  const anyCarrierFilter = exceptionsOnly || !!carrierFilter || !!statusFilter;
  const effectiveWeekStart = hasDateRange ? dateFrom : anyCarrierFilter ? '' : weekRange.startStr;
  const effectiveWeekEnd   = hasDateRange ? dateTo   : anyCarrierFilter ? '' : weekRange.endStr;

  const search = searchParams.get('search') || '';
  const normalizedSearch = search.trim().toLowerCase();

  const query = useQuery({
    ...dashboardShippedQuery({
      weekStart: effectiveWeekStart,
      weekEnd: effectiveWeekEnd,
      packedBy: effPackedBy,
      testedBy: effTestedBy,
      shippedFilter,
    }),
    enabled: !normalizedSearch,
    placeholderData: (previousData) => previousData,
  });

  const searchResult = useShippedSearch({
    query: search,
    shippedFilter,
    searchField: shippedSearchField,
    packedBy: effPackedBy,
    testedBy: effTestedBy,
  });

  useEffect(() => {
    writeShippedFilterPreference(
      shippedFilter === 'orders' || shippedFilter === 'sku' || shippedFilter === 'fba' ? shippedFilter : 'all'
    );
  }, [shippedFilter]);

  useEffect(() => {
    const handleRefresh = () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard-table', 'shipped'] });
      queryClient.invalidateQueries({ queryKey: ['shipped-table'] });
    };
    window.addEventListener('usav-refresh-data' as any, handleRefresh as any);
    window.addEventListener('dashboard-refresh' as any, handleRefresh as any);
    return () => {
      window.removeEventListener('usav-refresh-data' as any, handleRefresh as any);
      window.removeEventListener('dashboard-refresh' as any, handleRefresh as any);
    };
  }, [queryClient]);

  useEffect(() => {
    const handleOpen = (e: CustomEvent<ShippedOrder>) => {
      const payload = getOpenShippedDetailsPayload(e.detail);
      const nextId = Number(payload?.order?.id);
      setSelectedDetailId(Number.isFinite(nextId) ? nextId : null);
    };
    const handleClose = () => setSelectedDetailId(null);
    window.addEventListener('open-shipped-details' as any, handleOpen as any);
    window.addEventListener('close-shipped-details' as any, handleClose as any);
    return () => {
      window.removeEventListener('open-shipped-details' as any, handleOpen as any);
      window.removeEventListener('close-shipped-details' as any, handleClose as any);
    };
  }, []);

  const setWeekOffsetInUrl = (nextOffset: number) => {
    const params = new URLSearchParams(searchParams.toString());
    if (nextOffset <= 0) params.delete('shippedWeekOffset');
    else params.set('shippedWeekOffset', String(nextOffset));
    const nextSearch = params.toString();
    const nextPath = pathname || '/dashboard';
    router.replace(nextSearch ? `${nextPath}?${nextSearch}` : nextPath, { scroll: false });
  };

  const clearSearch = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('search');
    const nextSearch = params.toString();
    const nextPath = pathname || '/dashboard';
    router.replace(nextSearch ? `${nextPath}?${nextSearch}` : nextPath, { scroll: false });
  };

  const rawRecords = useMemo(() => query.data || [], [query.data]);

  const toDetailRecord = useCallback((record: PackerRecord): ShippedOrder => ({
    id: record.order_row_id || record.id,
    deadline_at: record.deadline_at || null,
    ship_by_date: record.ship_by_date || null,
    order_id: record.order_id || '',
    product_title: record.product_title || '',
    quantity: record.quantity || '1',
    item_number: record.item_number || null,
    condition: record.condition || '',
    shipment_id: record.shipment_id ?? null,
    shipping_tracking_number: record.shipping_tracking_number || '',
    tracking_numbers: record.tracking_numbers || [],
    tracking_number_rows: (record as any).tracking_number_rows || [],
    serial_number: record.serial_number || '',
    sku: record.sku || '',
    tester_id: record.tester_id ?? null,
    tested_by: record.tested_by ?? null,
    test_date_time: record.test_date_time || null,
    packer_id: record.packed_by ?? null,
    packed_by: record.packed_by ?? null,
    packed_at: record.created_at || null,
    ship_confirmed_at: record.ship_confirmed_at ?? null,
    shipped_out_by: record.shipped_out_by ?? null,
    shipped_out_by_name: record.shipped_out_by_name ?? null,
    packer_photos_url: record.packer_photos_url || [],
    tracking_type: record.tracking_type || null,
    account_source: record.account_source || null,
    notes: record.notes || '',
    status_history: record.status_history || [],
    created_at: record.created_at || null,
    tested_by_name: record.tested_by_name || null,
    packed_by_name: record.packed_by_name || null,
    tester_name: record.tester_name || null,
    packer_log_id: record.packer_log_id ?? null,
    station_activity_log_id: record.id,
    row_source: ((record as any).row_source || 'order') as ShippedOrder['row_source'],
    exception_reason: (record as any).exception_reason || null,
    exception_status: (record as any).exception_status || null,
    fnsku: record.fnsku || null,
    fnsku_log_id: record.fnsku_log_id ?? null,
    carrier: record.carrier ?? null,
    latest_status_code: record.latest_status_code ?? null,
    latest_status_label: record.latest_status_label ?? null,
    latest_status_description: record.latest_status_description ?? null,
    latest_status_category: record.latest_status_category ?? null,
    latest_event_at: record.latest_event_at ?? null,
    has_exception: record.has_exception ?? null,
    exception_at: record.exception_at ?? null,
    is_terminal: record.is_terminal ?? null,
  } as ShippedOrder), []);

  const getDetailId = useCallback((record: PackerRecord) => Number(record.order_row_id || record.id), []);

  const toSearchResultRecord = useCallback((record: ShippedOrder): PackerRecord => ({
    id: Number(record.id),
    created_at: record.pack_activity_at || record.packed_at || record.created_at || null,
    scan_ref: record.shipping_tracking_number || '',
    shipping_tracking_number: record.shipping_tracking_number || '',
    tracking_numbers: Array.isArray((record as any).tracking_numbers) ? (record as any).tracking_numbers : [],
    tracking_number_rows: Array.isArray((record as any).tracking_number_rows) ? (record as any).tracking_number_rows : [],
    packed_by: record.packer_id ?? record.packed_by ?? null,
    packed_by_name: record.packed_by_name || null,
    tracking_type: record.tracking_type || null,
    packer_photos_url: record.packer_photos_url || [],
    order_row_id: Number(record.id),
    shipment_id: record.shipment_id ?? null,
    order_id: record.order_id || '',
    account_source: record.account_source || null,
    product_title: record.product_title || '',
    quantity: record.quantity || '1',
    item_number: record.item_number || null,
    condition: record.condition || '',
    sku: record.sku || '',
    notes: record.notes || '',
    status_history: record.status_history || [],
    serial_number: record.serial_number || '',
    tested_by: record.tested_by ?? null,
    tester_id: record.tester_id ?? null,
    test_date_time: record.test_date_time || null,
    tested_by_name: record.tested_by_name || null,
    tester_name: record.tester_name || null,
    row_source: (record as any).row_source || 'order',
    exception_reason: (record as any).exception_reason || null,
    exception_status: (record as any).exception_status || null,
    fnsku: record.fnsku ?? null,
    fnsku_log_id: record.fnsku_log_id ?? null,
    carrier: record.carrier ?? null,
    latest_status_code: record.latest_status_code ?? null,
    latest_status_label: record.latest_status_label ?? null,
    latest_status_description: record.latest_status_description ?? null,
    latest_status_category: record.latest_status_category ?? null,
    latest_event_at: record.latest_event_at ?? null,
    has_exception: record.has_exception ?? null,
    exception_at: record.exception_at ?? null,
    is_terminal: record.is_terminal ?? null,
  } as PackerRecord), []);

  const dedupedRecords = useMemo(() => dedupeShippedRecords(rawRecords), [rawRecords]);

  const typeFilteredRecords = useMemo(() =>
    shippedFilter === 'fba'
      ? dedupedRecords.filter(isFbaPackerRecord)
      : shippedFilter === 'orders'
        ? dedupedRecords.filter((r) => !isFbaPackerRecord(r) && (hasLinkedOrder(r) || isExceptionPackerRecord(r)))
        : shippedFilter === 'sku'
          ? dedupedRecords.filter(isSkuPackerRecord)
          : dedupedRecords.filter((r) => {
              if (isSkuPackerRecord(r)) return false;
              if (isFbaPackerRecord(r)) return true;
              return hasLinkedOrder(r) || isExceptionPackerRecord(r);
            }),
    [dedupedRecords, shippedFilter],
  );

  const carrierFilteredRecords = useMemo(() => {
    if (!exceptionsOnly && !carrierFilter && !statusFilter && !obStatus) return typeFilteredRecords;
    return typeFilteredRecords.filter((r) => {
      if (!matchesOutbound(r)) return false;
      if (carrierFilter && String(r.carrier ?? '').toUpperCase() !== carrierFilter) return false;
      if (statusFilter && String(r.latest_status_category ?? '').toUpperCase() !== statusFilter) return false;
      if (exceptionsOnly) {
        const hasEx = Boolean(r.has_exception);
        const stalled = isStalled({
          isTerminal: r.is_terminal ?? null,
          category: r.latest_status_category ?? null,
          latestEventAt: r.latest_event_at ?? null,
        });
        if (!hasEx && !stalled) return false;
      }
      return true;
    });
  }, [typeFilteredRecords, exceptionsOnly, carrierFilter, statusFilter, obStatus, matchesOutbound]);

  const searchRecords = useMemo<PackerRecord[]>(
    () => (searchResult.data?.records ?? []).map(toSearchResultRecord),
    [searchResult.data, toSearchResultRecord],
  );
  const searchFilteredRecords = useMemo(() => {
    if (!exceptionsOnly && !carrierFilter && !statusFilter && !obStatus) return searchRecords;
    return searchRecords.filter((r) => {
      if (!matchesOutbound(r)) return false;
      if (carrierFilter && String(r.carrier ?? '').toUpperCase() !== carrierFilter) return false;
      if (statusFilter && String(r.latest_status_category ?? '').toUpperCase() !== statusFilter) return false;
      if (exceptionsOnly) {
        const hasEx = Boolean(r.has_exception);
        const stalled = isStalled({
          isTerminal: r.is_terminal ?? null,
          category: r.latest_status_category ?? null,
          latestEventAt: r.latest_event_at ?? null,
        });
        if (!hasEx && !stalled) return false;
      }
      return true;
    });
  }, [searchRecords, exceptionsOnly, carrierFilter, statusFilter, obStatus, matchesOutbound]);
  const records = useMemo(
    () => (normalizedSearch ? searchFilteredRecords : carrierFilteredRecords),
    [normalizedSearch, searchFilteredRecords, carrierFilteredRecords],
  );

  // Attach the derived outbound state (packed-time vs left-warehouse-time) once,
  // so the grouped list and the scan-out sections read the same source of truth.
  const derivedRecords = useMemo<DerivedPackerRecord[]>(
    () => records.map(deriveShippedRecord),
    [records],
  );

  const searchMeta = searchResult.data?.meta ?? null;
  const isResolvingSearch = searchResult.isFetching && normalizedSearch.length > 0;

  const handleRowClick = useCallback((record: PackerRecord) => {
    const detail = toDetailRecord(record);
    const detailId = getDetailId(record);
    if (selectedDetailId !== null && detailId === selectedDetailId) {
      dispatchCloseShippedDetails();
      return;
    }
    dispatchOpenShippedDetails(detail, 'shipped');
  }, [getDetailId, selectedDetailId, toDetailRecord]);

  const groupedRecords = useMemo(() => {
    const groups: Record<string, DerivedPackerRecord[]> = {};
    derivedRecords.forEach((record) => {
      // File each package under the day it was PACKED (created_at = pack-scan time),
      // so the list order matches the packing photo / camera timeline. effShipTime
      // (scan-out time) is only a last-resort fallback for rows with no pack time.
      const dateSource = record.created_at || record.effShipTime;
      if (!dateSource || dateSource === '1') return;
      let date = '';
      try {
        date = toPSTDateKey(String(dateSource)) || 'Unknown';
      } catch { date = 'Unknown'; }
      if (!groups[date]) groups[date] = [];
      groups[date].push(record);
    });
    return groups;
  }, [derivedRecords]);

  const sortedGroupedEntries = useMemo(
    () => Object.entries(groupedRecords).sort((a, b) => b[0].localeCompare(a[0])),
    [groupedRecords]
  );

  const orderedRecords = sortedGroupedEntries.flatMap(([, dayRecords]) =>
      [...dayRecords].sort((a, b) => {
        const timeA = new Date(a.created_at || a.effShipTime || 0).getTime();
        const timeB = new Date(b.created_at || b.effShipTime || 0).getTime();
        return timeB - timeA;
      })
    );

  // Pencil multi-select wiring (off by default → no-op for non-select callers).
  const getRowId = useCallback((r: DerivedPackerRecord) => Number(r.id), []);
  const { selectedIds, toggle } = useTableSelectMode<DerivedPackerRecord>({
    scope: DASHBOARD_ORDERS_SELECTION_SCOPE,
    selectMode,
    rows: orderedRecords,
    getId: getRowId,
  });

  useEffect(() => {
    const handleNavigate = (e: CustomEvent<{ direction?: 'up' | 'down' }>) => {
      if (selectedDetailId === null || orderedRecords.length === 0) return;
      const currentIndex = orderedRecords.findIndex((record) => getDetailId(record) === selectedDetailId);
      if (currentIndex < 0) return;
      const step = e.detail?.direction === 'up' ? -1 : 1;
      const nextRecord = orderedRecords[currentIndex + step];
      if (!nextRecord) return;
      const nextDetail = toDetailRecord(nextRecord);
      dispatchOpenShippedDetails(nextDetail, 'shipped');
    };
    window.addEventListener('navigate-shipped-details' as any, handleNavigate as any);
    return () => {
      window.removeEventListener('navigate-shipped-details' as any, handleNavigate as any);
    };
  }, [getDetailId, orderedRecords, selectedDetailId, toDetailRecord]);

  useEffect(() => {
    // Reset to the top of the list when the week / filter changes so a new
    // window opens at its first day rather than wherever the prior scroll sat.
    const container = scrollRef.current;
    if (container) container.scrollTop = 0;
  }, [sortedGroupedEntries]);

  const totalCount = Object.values(groupedRecords).reduce((sum, dayRecords) => sum + dayRecords.length, 0);
  const normalizePersonName = (value: unknown): string => {
    const text = String(value ?? '').replace(/^tech:\s*/i, '').replace(/^packer:\s*/i, '').trim();
    if (!text || /^(not specified|n\/a|null|undefined|staff\s*#\d+)$/i.test(text)) return '---';
    return text;
  };

  // One row renderer, reused by the day-grouped list AND the two scan-out sections
  // so both render the exact same shipped row (chips, platform, state pill, staff).
  const renderRecordRow = (record: DerivedPackerRecord, index: number) => {
    const detail = toDetailRecord(record);
    const displayValues = getOrderDisplayValues({ sku: record.sku, condition: record.condition, trackingNumber: record.shipping_tracking_number });
    const rowIsFba = isFbaPackerRecord(record);
    const techStaffId = (record as any).tested_by ?? (record as any).tester_id ?? null;
    const packerStaffId = (record as any).packed_by ?? (record as any).packer_id ?? null;
    const techDisplay = normalizePersonName(String((record as any).tested_by_name || (record as any).tester_name || getStaffName(techStaffId)));
    const packerDisplay = normalizePersonName(String((record as any).packed_by_name || (record as any).packer_name || getStaffName(packerStaffId)));
    const platformLabel = getOrderPlatformLabel(record.order_id || '', record.account_source);
    const orderIsFbaMeta = isFbaOrder(record.order_id, record.account_source);
    const productPageUrl = getExternalUrlByItemNumber(String(record.item_number || '').trim() || skuScanPrefixBeforeColon(String(record.scan_ref || record.shipping_tracking_number || '').trim()));
    const hideOrderIdChip = isSkuSourceRecord({ orderId: record.order_id, accountSource: record.account_source, trackingType: record.tracking_type, scanRef: String(record.scan_ref || record.shipping_tracking_number || '').trim() });
    const checked = selectMode && selectedIds.has(Number(record.id));

    return (
      <div
        key={record.id}
        onClick={(e) => (selectMode ? toggle(Number(record.id), e.shiftKey) : handleRowClick(record))}
        // Suppress native text-selection on shift-click so range-select reads cleanly.
        onMouseDown={(e) => { if (selectMode && e.shiftKey) e.preventDefault(); }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (selectMode) { toggle(Number(record.id), e.shiftKey); } else { handleRowClick(record); } } }}
        role={selectMode ? 'checkbox' : 'button'}
        tabIndex={0}
        aria-checked={selectMode ? checked : undefined}
        aria-pressed={selectMode ? undefined : selectedDetailId === detail.id}
        className={`${dashboardOrderRowShellClass(isMobile)} border-b border-gray-100 px-3 py-1.5 transition-colors cursor-pointer hover:bg-blue-50/50 ${
          (selectMode ? checked : selectedDetailId === detail.id) ? 'bg-blue-50/80' : index % 2 === 1 ? 'bg-gray-50/40' : 'bg-white'
        }`}
      >
        <div className="flex flex-col min-w-0">
          <RowTitle
            leading={
              selectMode ? (
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                    checked ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-white'
                  }`}
                >
                  {checked && <Check className="h-3 w-3" />}
                </span>
              ) : undefined
            }
            dot={OUTBOUND_STATE_META[record.outboundState].dot}
            dotTitle={`${OUTBOUND_STATE_META[record.outboundState].label} — ${OUTBOUND_STATE_META[record.outboundState].description}`}
            dotTooltip
            title={record.product_title || record.item_number || record.sku || 'Unknown Product'}
          />
          <RowMetaColumns
            indent={selectMode ? `calc(${META_COL.indent} + 1.5rem)` : undefined}
            qty={<span className={(parseInt(String(record.quantity || '1'), 10) || 1) > 1 ? 'text-yellow-600' : 'text-gray-500'}>{parseInt(String(record.quantity || '1'), 10) || 1}</span>}
            condition={<span className={String(displayValues.condition || '').trim().toLowerCase() === 'new' ? 'text-yellow-600' : 'text-gray-400'}>{displayValues.condition || 'N/A'}</span>}
            rest={<div className="flex items-center gap-2">
              {techDisplay !== '---' ? <HoverTooltip label={`Tested by ${techDisplay}`}><StaffInitials staffId={techStaffId} name={techDisplay} /></HoverTooltip> : <StaffInitials staffId={techStaffId} name={techDisplay} />}
              {packerDisplay !== '---' ? <HoverTooltip label={`Packed by ${packerDisplay}`}><StaffInitials staffId={packerStaffId} name={packerDisplay} /></HoverTooltip> : <StaffInitials staffId={packerStaffId} name={packerDisplay} />}
              <CarrierStatusIcon className="ml-1" carrier={record.carrier} category={record.latest_status_category} statusLabel={record.latest_status_label} description={record.latest_status_description} latestEventAt={record.latest_event_at} hasException={record.has_exception} isTerminal={record.is_terminal} />
            </div>}
          />
        </div>
        {(() => {
          const platformNode = !orderIsFbaMeta ? (
            <PlatformChip
              label="Product Page"
              labelTransform="none"
              tooltipValue={productPageUrl ?? ''}
              underlineClass={getOrderPlatformBorderColor(platformLabel)}
              iconClass={platformLabel && productPageUrl ? getOrderPlatformColor(platformLabel) : 'text-gray-500'}
              onClick={() => {
                if (productPageUrl) window.open(productPageUrl, '_blank', 'noopener,noreferrer');
              }}
            />
          ) : null;
          const orderIdNode = hideOrderIdChip ? <OrderIdChipPlaceholder /> : <OrderIdChip value={record.order_id || ''} display={getLast4(record.order_id)} />;
          const serialNode = <SerialChip value={String(record.serial_number || '').trim()} width="w-fit max-w-full" />;
          const columns = rowIsFba
            ? [{ key: 'platform', width: CHIP_COL.platform, node: null }, { key: 'orderid', width: CHIP_COL.id, node: null }, { key: 'tracking', width: CHIP_COL.tracking, node: <FnskuChip value={String(record.scan_ref || '').trim()} /> }, { key: 'serial', width: CHIP_COL.serial, node: serialNode }]
            : [{ key: 'platform', width: CHIP_COL.platform, node: platformNode }, { key: 'orderid', width: CHIP_COL.id, node: orderIdNode }, { key: 'tracking', width: CHIP_COL.tracking, node: <TrackingOrSkuScanChip value={record.shipping_tracking_number || ''} /> }, { key: 'serial', width: CHIP_COL.serial, node: serialNode }];
          return isMobile ? (
            <div className={dashboardOrderRowChipsClass(true)}>{columns.map((c) => c.node && <span key={c.key} className="contents">{c.node}</span>)}</div>
          ) : <ChipColumns columns={columns} />;
        })()}
      </div>
    );
  };

  const shippedTableInner = (
    <>
      <div className="flex-1 flex flex-col min-h-0 relative">
        {bannerTitle ? (
          <div className={mainStickyHeaderClass}>
            <div className={mainStickyHeaderRowClass}>
              <div>
                <p className={`${sectionLabel} text-blue-700`}>{bannerTitle}</p>
                {bannerSubtitle ? <p className={`mt-0.5 ${fieldLabel}`}>{bannerSubtitle}</p> : null}
              </div>
              <div className="min-w-[18px] flex items-center justify-end">
                {((query.isFetching && !query.isLoading) || isResolvingSearch) ? <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" /> : null}
              </div>
            </div>
          </div>
        ) : (normalizedSearch || anyCarrierFilter) ? (
          // Render through PaneHeader with the SAME class overrides WeekHeader
          // uses (border-b-0 shell + gray-300 row divider) so the search-results
          // header is pixel-identical chrome to every other table header —
          // same 40px height, padding, and divider weight.
          <PaneHeader
            className="border-b-0"
            rowClassName="border-b border-gray-300"
            leftSlot={
              <p className={`${sectionLabel} text-gray-700`}>{totalCount} result{totalCount !== 1 ? 's' : ''}</p>
            }
            rightSlot={
              <div className="min-w-[18px] flex items-center justify-end">
                {((query.isFetching && !query.isLoading) || isResolvingSearch) ? <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" /> : null}
              </div>
            }
          />
        ) : (
          <WeekHeader
            count={totalCount}
            weekRange={weekRange}
            weekOffset={weekOffset}
            onPrevWeek={() => setWeekOffsetInUrl(weekOffset + 1)}
            onNextWeek={() => setWeekOffsetInUrl(Math.max(0, weekOffset - 1))}
          />
        )}

        <div
          ref={scrollRef}
          className="flex-1 min-h-0 overflow-x-auto overflow-y-auto no-scrollbar w-full"
        >
          {query.isLoading ? (
            <SkeletonList count={12} />
          ) : Object.keys(groupedRecords).length === 0 ? (
            <div className="flex flex-col items-center justify-center py-40 text-center">
              {search ? (
                <>
                  <OrderSearchEmptyState
                    query={search}
                    title={searchEmptyTitle}
                    resultLabel={searchResultLabel}
                    clearLabel={clearSearchLabel}
                    onClear={clearSearch}
                  />
                  {searchMeta?.outOfScope && searchMeta.outOfScopeSuggestion ? (
                    <button
                      type="button"
                      onClick={() => {
                        const params = new URLSearchParams(searchParams.toString());
                        params.set('shippedFilter', searchMeta.outOfScopeSuggestion!.filter);
                        const nextSearch = params.toString();
                        const nextPath = pathname || '/dashboard';
                        router.replace(nextSearch ? `${nextPath}?${nextSearch}` : nextPath, { scroll: false });
                      }}
                      className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-100"
                    >
                      Found {searchMeta.outOfScopeSuggestion.count} match{searchMeta.outOfScopeSuggestion.count === 1 ? '' : 'es'} in the <span className="uppercase">{searchMeta.outOfScopeSuggestion.filter}</span> tab — switch?
                    </button>
                  ) : null}
                </>
              ) : (
                <div className="max-w-xs mx-auto animate-in fade-in zoom-in duration-300">
                  <p className="text-gray-500 font-semibold italic opacity-20">No shipped records for this week</p>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col w-full">
              {sortedGroupedEntries.map(([date, dayRecords]) => {
                const sortedRecords = [...dayRecords].sort((a, b) => {
                  const timeA = new Date(a.created_at || a.effShipTime || 0).getTime();
                  const timeB = new Date(b.created_at || b.effShipTime || 0).getTime();
                  return timeB - timeA;
                });
                return (
                  <div key={date} className="flex flex-col">
                    <DateGroupHeader date={date} total={dayRecords.length} />
                    {sortedRecords.map((record, index) => renderRecordRow(record, index))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );

  if (embedded) return <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-white">{shippedTableInner}</div>;
  return (
    <div className="flex-1 min-w-0 h-full overflow-hidden">
      <div className="flex h-full min-w-0 flex-1 bg-white relative">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{shippedTableInner}</div>
      </div>
    </div>
  );
}
