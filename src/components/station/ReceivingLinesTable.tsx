'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useUIModeOptional } from '@/design-system/providers/UIModeProvider';
import { Loader2 } from '@/components/Icons';
import { TrackingChip, OrderIdChip, SkuScanRefChip, SerialChip, getLast4, getLast6Serial } from '@/components/ui/CopyChip';
import { conditionGradeTableLabel, workflowStatusTableLabel } from '@/components/station/receiving-constants';
import WeekHeader from '@/components/ui/WeekHeader';
import { DesktopDateGroupHeader } from '@/components/ui/DesktopDateGroupHeader';
import {
  computeWeekRange,
  formatDateWithOrdinal,
  getCurrentPSTDateKey,
  toPSTDateKey,
} from '@/utils/date';

/** Passed to `/api/receiving-lines` as `view`. The station dashboard uses a single full list. */
export type ReceivingView = 'all' | 'recent' | 'received';

export interface ReceivingLineRow {
  id: number;
  receiving_id: number | null;
  tracking_number: string | null;
  tracking_source?: 'shipment' | 'receiving' | 'zoho_reference' | null;
  carrier: string | null;
  shipment_status?: string | null;
  is_delivered?: boolean;
  delivered_at?: string | null;
  zoho_item_id: string | null;
  zoho_line_item_id: string | null;
  zoho_purchase_receive_id: string | null;
  zoho_purchaseorder_id: string | null;
  zoho_purchaseorder_number: string | null;
  item_name: string | null;
  sku: string | null;
  quantity_received: number;
  quantity_expected: number | null;
  qa_status: string;
  workflow_status: string | null;
  disposition_code: string;
  condition_grade: string;
  disposition_audit: unknown[];
  needs_test: boolean;
  assigned_tech_id: number | null;
  zoho_sync_source: string | null;
  zoho_last_modified_time: string | null;
  zoho_synced_at: string | null;
  receiving_type: string | null;
  notes: string | null;
  /** Carton-level support notes from `receiving.support_notes` (same for all lines on the package). */
  receiving_support_notes?: string | null;
  created_at: string | null;
  image_url: string | null;
  source_platform: string | null;
  serials?: Array<{ id: number; serial_number: string }> | null;
}

interface ApiResponse {
  success: boolean;
  receiving_lines: ReceivingLineRow[];
  total: number;
  limit: number;
  offset: number;
}

export function dispatchSelectLine(row: ReceivingLineRow | null) {
  window.dispatchEvent(new CustomEvent('receiving-select-line', { detail: row }));
}

export function dispatchLineUpdated(row: Partial<ReceivingLineRow> & { id: number }) {
  window.dispatchEvent(new CustomEvent('receiving-line-updated', { detail: row }));
}

function getStatusDotBg(status: string | null | undefined) {
  const value = String(status || '').trim().toUpperCase();
  if (value === 'EXPECTED') return 'bg-amber-400';
  if (value === 'ARRIVED' || value === 'MATCHED') return 'bg-blue-500';
  if (value === 'UNBOXED') return 'bg-indigo-500';
  if (value === 'AWAITING_TEST' || value === 'IN_TEST') return 'bg-violet-500';
  if (value === 'PASSED' || value === 'DONE') return 'bg-emerald-500';
  if (value.startsWith('FAILED') || value === 'SCRAP' || value === 'RTV') return 'bg-rose-500';
  return 'bg-gray-400';
}

function OrderRow({
  row,
  isSelected,
  onSelect,
  index,
}: {
  row: ReceivingLineRow;
  isSelected: boolean;
  onSelect: () => void;
  index: number;
}) {
  const productTitle = row.item_name || row.zoho_item_id || 'Unnamed inbound line';
  const quantityText = `${row.quantity_received}/${row.quantity_expected ?? '?'}`;
  const qtyExpected = row.quantity_expected ?? 0;
  const workflowLabel = workflowStatusTableLabel(row.workflow_status || 'EXPECTED');
  const condGrade = (row.condition_grade || '').toUpperCase();
  const conditionLabel = conditionGradeTableLabel(row.condition_grade);
  const conditionColor =
    condGrade === 'BRAND_NEW'
      ? 'text-yellow-600'
      : condGrade === 'PARTS'
        ? 'text-amber-800'
        : condGrade.startsWith('USED')
          ? 'text-gray-500'
          : 'text-gray-500';
  const trackingValue = (row.tracking_number || '').trim();
  const skuValue = (row.sku || '').trim();
  const poValue = (row.zoho_purchaseorder_number || row.zoho_purchaseorder_id || '').trim();
  // Join all serials so SerialChip's CSV-aware helper picks the most recent and
  // shows its last 6 chars. Clipboard carries the full list for traceability.
  const serialsCsv = (row.serials ?? [])
    .map((s) => (s.serial_number || '').trim())
    .filter(Boolean)
    .join(', ');

  return (
    <div
      data-line-row-id={row.id}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      aria-label={`Select receiving line ${row.id}`}
      className={`flex flex-col gap-1.5 border-b border-gray-50 px-3 py-1.5 transition-colors cursor-pointer hover:bg-blue-50/50 md:grid md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-2 ${
        isSelected ? 'bg-blue-50/80' : index % 2 === 0 ? 'bg-white' : 'bg-gray-50/10'
      }`}
    >
      <div className="flex min-w-0 flex-col">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${getStatusDotBg(row.workflow_status)}`}
            title={workflowLabel}
          />
          <div className="truncate text-[13px] font-bold text-gray-900">
            {productTitle}
          </div>
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <div className="min-w-0 flex-1 truncate pl-4 text-[11px] font-black uppercase tracking-widest text-gray-500">
            <span className={qtyExpected > 1 ? 'text-yellow-600' : row.quantity_expected && row.quantity_received >= row.quantity_expected ? 'text-emerald-600' : 'text-gray-700'}>
              {quantityText}
            </span>
            {' • '}
            <span className={conditionColor}>{conditionLabel}</span>
            {' • '}
            {workflowLabel}
            {row.needs_test ? <span className="text-orange-600">{' • NEEDS TEST'}</span> : null}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-0.5 pl-4 md:justify-end md:pl-0 md:pr-2">
        <OrderIdChip value={poValue} display={getLast4(poValue)} />
        <SkuScanRefChip value={skuValue} display={getLast4(skuValue)} />
        <TrackingChip value={trackingValue} display={getLast4(trackingValue)} />
        <SerialChip value={serialsCsv} display={getLast6Serial(serialsCsv)} />
      </div>
    </div>
  );
}

export default function ReceivingLinesTable() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isMobile } = useUIModeOptional();
  const view: ReceivingView = 'all';
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [localRows, setLocalRows] = useState<ReceivingLineRow[]>([]);
  const [weekOffset, setWeekOffset] = useState(0);
  const [stickyDate, setStickyDate] = useState<string>('');
  const [currentCount, setCurrentCount] = useState<number>(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const LIMIT = 500;

  const weekRange = computeWeekRange(weekOffset);

  const buildParams = useCallback(() => {
    const p = new URLSearchParams({ limit: String(LIMIT), offset: '0' });
    p.set('include', 'serials');
    p.set('view', view);
    return p.toString();
  }, [view]);

  const queryKey = ['receiving-lines-table', view] as const;
  const { data, isLoading } = useQuery<ApiResponse>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(`/api/receiving-lines?${buildParams()}`);
      if (!res.ok) throw new Error('fetch failed');
      return res.json();
    },
    staleTime: 20_000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (data?.receiving_lines) setLocalRows(data.receiving_lines);
  }, [data]);

  useEffect(() => {
    if (!selectedId) return;
    if (!localRows.some((row) => row.id === selectedId)) {
      setSelectedId(null);
      dispatchSelectLine(null);
    }
  }, [selectedId, localRows]);

  useEffect(() => {
    const handler = () => {
      queryClient.invalidateQueries({ queryKey: ['receiving-lines-table'] });
    };
    window.addEventListener('receiving-entry-added', handler);
    window.addEventListener('usav-refresh-data', handler);
    return () => {
      window.removeEventListener('receiving-entry-added', handler);
      window.removeEventListener('usav-refresh-data', handler);
    };
  }, [queryClient]);

  useEffect(() => {
    const handler = (event: Event) => {
      const updated = (event as CustomEvent<Partial<ReceivingLineRow>>).detail;
      if (!updated || typeof updated.id !== 'number') return;
      // Merge — some dispatchers (e.g. mark-received) return the raw DB
      // row without the joined fields the list endpoint computes
      // (tracking_number, carrier, zoho_purchaseorder_number, etc). A
      // wholesale replace would blank those. Shallow-merge keeps the
      // existing joined data while applying whatever fresh columns came
      // through (quantity_received, qa_status, workflow_status, …).
      setLocalRows((rows) =>
        rows.map((row) => (row.id === updated.id ? { ...row, ...updated } as ReceivingLineRow : row)),
      );
    };
    window.addEventListener('receiving-line-updated', handler);
    return () => window.removeEventListener('receiving-line-updated', handler);
  }, []);

  useEffect(() => {
    const handler = () => setSelectedId(null);
    window.addEventListener('receiving-clear-line', handler);
    return () => window.removeEventListener('receiving-clear-line', handler);
  }, []);

  // Tracking scan match → prepend every matched line to the top of the table.
  // Dedupe by id so a re-scan moves the existing row up instead of duplicating.
  // Also jumps to the current week and scrolls to top so the new rows are in view.
  useEffect(() => {
    const handler = (event: Event) => {
      const incoming = (event as CustomEvent<ReceivingLineRow[]>).detail;
      if (!Array.isArray(incoming) || incoming.length === 0) return;
      setLocalRows((rows) => {
        const incomingIds = new Set(incoming.map((r) => r.id));
        const kept = rows.filter((r) => !incomingIds.has(r.id));
        return [...incoming, ...kept];
      });
      setWeekOffset(0);
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      });
    };
    window.addEventListener('receiving-lines-prepended', handler);
    return () => window.removeEventListener('receiving-lines-prepended', handler);
  }, []);

  // External highlight — the sidebar's up/down arrows fire this event to
  // move the selected-row indicator in the table without the full
  // row-click semantics (which would wipe sidebar state). detail is the
  // receiving_line id or null to clear.
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<number | null>).detail;
      setSelectedId(typeof detail === 'number' ? detail : null);
    };
    window.addEventListener('receiving-highlight-line', handler);
    return () => window.removeEventListener('receiving-highlight-line', handler);
  }, []);

  // Track selectedId in a ref so the click handler can read the current value
  // without a stale closure — the dispatch must happen OUTSIDE the setState
  // updater (updaters must be pure; dispatching a custom event synchronously
  // triggers the sidebar's setState and React flags it as "setState during
  // render of a different component").
  const selectedIdRef = useRef<number | null>(null);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);

  const handleSelectRow = useCallback((row: ReceivingLineRow) => {
    const next = selectedIdRef.current === row.id ? null : row.id;
    setSelectedId(next);
    dispatchSelectLine(next ? row : null);
    // On mobile, tapping a row should reveal the Actions pane with the
    // chosen carton already loaded. We persist `recvId` in the URL so the
    // selection survives Actions↔History tab flips (RouteShell unmounts
    // the inactive pane on mobile).
    if (next && isMobile) {
      const params = new URLSearchParams(searchParams.toString());
      params.set('pane', 'actions');
      if (row.receiving_id) params.set('recvId', String(row.receiving_id));
      router.replace(`?${params.toString()}`, { scroll: false });
    }
  }, [isMobile, router, searchParams]);

  // ── Day grouping (PST) ────────────────────────────────────────────────────
  const groupedRecords = useMemo(() => {
    const groups: Record<string, ReceivingLineRow[]> = {};
    for (const row of localRows) {
      let date = 'Unknown';
      try {
        date = toPSTDateKey(row.created_at) || 'Unknown';
      } catch {
        date = 'Unknown';
      }
      if (!groups[date]) groups[date] = [];
      groups[date].push(row);
    }
    return groups;
  }, [localRows]);

  const filteredGroupedRecords = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(groupedRecords).filter(
          ([date]) => date >= weekRange.startStr && date <= weekRange.endStr,
        ),
      ),
    [groupedRecords, weekRange.startStr, weekRange.endStr],
  );

  // ── Scroll-based sticky header (matches TechTable) ────────────────────────
  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop } = scrollRef.current;
    const headers = scrollRef.current.querySelectorAll('[data-day-header]');
    let activeDate = '';
    let activeCount = 0;
    for (let i = 0; i < headers.length; i++) {
      const header = headers[i] as HTMLElement;
      if (header.offsetTop - scrollRef.current.offsetTop <= scrollTop + 5) {
        activeDate = header.getAttribute('data-date') || '';
        activeCount = parseInt(header.getAttribute('data-count') || '0', 10);
      } else {
        break;
      }
    }
    if (activeDate) setStickyDate(formatDateWithOrdinal(activeDate));
    if (activeCount) setCurrentCount(activeCount);
  }, []);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    container.addEventListener('scroll', handleScroll);
    const t = setTimeout(() => handleScroll(), 100);
    return () => {
      container.removeEventListener('scroll', handleScroll);
      clearTimeout(t);
    };
  }, [handleScroll, localRows]);

  const getWeekCount = () =>
    Object.values(filteredGroupedRecords).reduce((sum, rows) => sum + rows.length, 0);

  const formatHeaderDate = () => formatDateWithOrdinal(getCurrentPSTDateKey());

  const emptyMessage = 'No lines yet — start scanning to populate.';

  return (
    <div className="flex h-full min-w-0 overflow-hidden bg-white">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <WeekHeader
          stickyDate={stickyDate}
          fallbackDate={formatHeaderDate()}
          count={currentCount || getWeekCount()}
          weekRange={weekRange}
          weekOffset={weekOffset}
          onPrevWeek={() => setWeekOffset(weekOffset + 1)}
          onNextWeek={() => setWeekOffset(Math.max(0, weekOffset - 1))}
        />
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
          {isLoading && localRows.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-gray-500" />
            </div>
          ) : Object.keys(filteredGroupedRecords).length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-[14px] font-semibold text-gray-500">{emptyMessage}</p>
            </div>
          ) : (
            <div className="flex w-full flex-col">
              {Object.entries(filteredGroupedRecords)
                .sort((a, b) => b[0].localeCompare(a[0]))
                .map(([date, dateRows]) => {
                  const sortedRows = [...dateRows].sort((a, b) => {
                    const tA = new Date(a.created_at || 0).getTime();
                    const tB = new Date(b.created_at || 0).getTime();
                    return tB - tA;
                  });
                  return (
                    <div key={date} className="flex flex-col">
                      <DesktopDateGroupHeader date={date} total={dateRows.length} />
                      {sortedRows.map((row, index) => (
                        <OrderRow
                          key={row.id}
                          row={row}
                          index={index}
                          isSelected={selectedId === row.id}
                          onSelect={() => handleSelectRow(row)}
                        />
                      ))}
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
