'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  Box,
  ClipboardList,
  Copy,
  Loader2,
  Package,
  PackageCheck,
  Printer,
  RefreshCw,
  Search,
} from '@/components/Icons';
import { FnskuChip, SerialChip, getLast6Serial } from '@/components/ui/CopyChip';
import WeekHeader from '@/components/ui/WeekHeader';
import { DateGroupHeader } from '@/components/shipped/DateGroupHeader';
import { formatDateWithOrdinal, getCurrentPSTDateKey, toPSTDateKey } from '@/utils/date';
import type { FbaSummaryRow, FbaWorkflowMode } from '@/components/fba/types';
import { deriveFbaWorkflowMode } from '@/components/fba/types';

export type FbaPlanSummaryMode = 'ALL' | 'PLAN' | 'PACKING' | 'PRINT_READY';

interface FbaShipmentBoardProps {
  summaryMode: FbaPlanSummaryMode;
  refreshTrigger: number;
  searchQuery: string;
}

const MODE_LABEL = {
  PLAN: 'Plan',
  PACKING: 'Packing',
  PRINT_READY: 'Print ready',
  NONE: '—',
} as const;

const STATUS_ICON_CLASS = 'h-3.5 w-3.5 shrink-0 text-gray-500';

function WorkflowStatusIcon({ mode }: { mode: FbaWorkflowMode }) {
  const label = MODE_LABEL[mode];
  const icon =
    mode === 'PLAN' ? (
      <ClipboardList className={STATUS_ICON_CLASS} />
    ) : mode === 'PACKING' ? (
      <Package className={STATUS_ICON_CLASS} />
    ) : mode === 'PRINT_READY' ? (
      <PackageCheck className={STATUS_ICON_CLASS} />
    ) : (
      <Box className={`${STATUS_ICON_CLASS} text-gray-400`} />
    );
  return (
    <span className="inline-flex shrink-0" title={label} aria-label={label}>
      {icon}
    </span>
  );
}

function matchesMode(row: FbaSummaryRow, summaryMode: FbaShipmentBoardProps['summaryMode']): boolean {
  const mode = deriveFbaWorkflowMode(row);
  if (summaryMode === 'ALL') return mode === 'PLAN' || mode === 'PACKING' || mode === 'PRINT_READY';
  if (summaryMode === 'PACKING') return mode === 'PACKING';
  if (summaryMode === 'PRINT_READY') return mode === 'PRINT_READY';
  return mode === 'PLAN';
}

function EmptyState({ searchQuery, summaryMode }: { searchQuery: string; summaryMode: FbaShipmentBoardProps['summaryMode'] }) {
  const modeLabel =
    summaryMode === 'ALL'
      ? 'workflow rows'
      : summaryMode === 'PACKING'
        ? 'packing rows'
        : summaryMode === 'PRINT_READY'
          ? 'print-ready rows'
          : 'plan rows';
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-gray-200 bg-gray-50">
        <Search className="h-6 w-6 text-gray-300" />
      </div>
      <p className="text-sm font-black text-gray-900">
        {searchQuery ? 'No FBA rows match this search' : `No ${modeLabel.toLowerCase()} rows right now`}
      </p>
      <p className="mt-1 text-xs font-bold text-gray-400">
        {searchQuery
          ? 'Try another FNSKU, ASIN, SKU, or shipment reference.'
          : 'Rows appear after FNSKU scans from tech and packing stations.'}
      </p>
    </div>
  );
}

function InlineActionButton({
  label,
  onClick,
  icon,
}: {
  label: string;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-300 text-gray-600 transition hover:bg-gray-50 hover:text-gray-900"
    >
      {icon}
    </button>
  );
}

function InlineRowDetails({
  row,
  onRefresh,
  onOpenLabels,
}: {
  row: FbaSummaryRow;
  onRefresh: () => void;
  onOpenLabels: () => void;
}) {
  const mode = deriveFbaWorkflowMode(row);

  const copyFnsku = async () => {
    try {
      await navigator.clipboard.writeText(row.fnsku);
    } catch {
      // no-op
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      className="border-b border-gray-100 bg-gray-50/80 px-3 py-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2" title={MODE_LABEL[mode]}>
          <WorkflowStatusIcon mode={mode} />
        </div>
        <div className="flex items-center gap-1.5">
          <InlineActionButton label="Copy FNSKU" onClick={copyFnsku} icon={<Copy className="h-3.5 w-3.5" />} />
          <InlineActionButton label="Open print queue" onClick={onOpenLabels} icon={<Printer className="h-3.5 w-3.5" />} />
          <InlineActionButton label="Refresh row" onClick={onRefresh} icon={<RefreshCw className="h-3.5 w-3.5" />} />
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-medium text-gray-500">
        <span>Shipment: {row.shipment_ref || '---'}</span>
        <span>Serial: {getLast6Serial(row.latest_serial_number || '')}</span>
        <span>ASIN: {row.asin || '---'}</span>
      </div>
    </motion.div>
  );
}

export function FbaShipmentBoard({ summaryMode, refreshTrigger, searchQuery }: FbaShipmentBoardProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [rows, setRows] = useState<FbaSummaryRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFnsku, setSelectedFnsku] = useState<string | null>(null);

  const [stickyDate, setStickyDate] = useState('');
  const [currentCount, setCurrentCount] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const formatDate = (dateStr: string) => formatDateWithOrdinal(dateStr);
  const fallbackDate = formatDate(getCurrentPSTDateKey());

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('limit', '500');
      if (searchQuery.trim()) params.set('q', searchQuery.trim());
      if (summaryMode === 'PACKING') params.set('mode', 'PACKING');
      if (summaryMode === 'PLAN') params.set('mode', 'PLAN');
      if (summaryMode === 'PRINT_READY') params.set('mode', 'PRINT_READY');

      const res = await fetch(`/api/fba/logs/summary?${params.toString()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to fetch FBA summary');
      const data = await res.json();
      setRows(Array.isArray(data?.rows) ? (data.rows as FbaSummaryRow[]) : []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load FBA summary');
    } finally {
      setIsLoading(false);
    }
  }, [searchQuery, summaryMode]);

  useEffect(() => {
    load();
  }, [load, refreshTrigger]);

  const visibleRows = useMemo(
    () => rows.filter((row) => matchesMode(row, summaryMode)),
    [rows, summaryMode]
  );

  useEffect(() => {
    if (visibleRows.length === 0) {
      setSelectedFnsku(null);
      return;
    }
    if (selectedFnsku && !visibleRows.some((row) => row.fnsku === selectedFnsku)) {
      setSelectedFnsku(null);
    }
  }, [selectedFnsku, visibleRows]);

  const openLabels = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', 'labels');
    router.replace(`/fba?${params.toString()}`);
  }, [router, searchParams]);

  const openPrintForRow = useCallback(
    (e: React.MouseEvent, row: FbaSummaryRow) => {
      e.stopPropagation();
      const params = new URLSearchParams(searchParams.toString());
      params.set('tab', 'labels');
      const ref = String(row.shipment_ref || '').trim();
      if (ref) params.set('q', ref);
      else if (row.fnsku) params.set('q', row.fnsku);
      router.replace(`/fba?${params.toString()}`);
    },
    [router, searchParams]
  );

  const groupedRows: Record<string, FbaSummaryRow[]> = {};
  visibleRows.forEach((row) => {
    const dateSource = row.last_event_at;
    if (!dateSource) return;

    let key = 'Unknown';
    try {
      key = toPSTDateKey(String(dateSource)) || 'Unknown';
    } catch {
      key = 'Unknown';
    }

    if (!groupedRows[key]) groupedRows[key] = [];
    groupedRows[key].push(row);
  });

  if (Object.keys(groupedRows).length === 0 && visibleRows.length > 0) {
    groupedRows.Unknown = [...visibleRows];
  }

  const totalCount = visibleRows.length;

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop } = scrollRef.current;
    const headers = scrollRef.current.querySelectorAll('[data-day-header]');
    let activeDate = '';
    let activeCount = 0;

    for (let i = 0; i < headers.length; i += 1) {
      const header = headers[i] as HTMLElement;
      if (header.offsetTop - scrollRef.current.offsetTop <= scrollTop + 5) {
        activeDate = header.getAttribute('data-date') || '';
        activeCount = parseInt(header.getAttribute('data-count') || '0', 10);
      } else {
        break;
      }
    }

    if (activeDate) setStickyDate(formatDate(activeDate));
    setCurrentCount(activeCount || totalCount);
  }, [totalCount]);

  useEffect(() => {
    const container = scrollRef.current;
    if (container) {
      container.addEventListener('scroll', handleScroll);
      window.setTimeout(() => handleScroll(), 100);
    }
    return () => container?.removeEventListener('scroll', handleScroll);
  }, [handleScroll, visibleRows]);

  if (isLoading && rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center gap-3 bg-white">
        <Loader2 className="h-6 w-6 animate-spin text-gray-900" />
        <span className="text-sm text-gray-500">Loading FBA summary…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="flex max-w-md items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-700">
          <AlertCircle className="h-5 w-5 flex-shrink-0" />
          <p className="text-sm font-semibold">{error}</p>
        </div>
      </div>
    );
  }

  if (visibleRows.length === 0) {
    return <EmptyState searchQuery={searchQuery} summaryMode={summaryMode} />;
  }

  return (
    <div className="flex h-full min-w-0 flex-1 bg-white">
      <div className="flex-1 flex flex-col overflow-hidden">
        <WeekHeader
          stickyDate={stickyDate}
          fallbackDate={fallbackDate}
          count={currentCount || totalCount}
          countClassName="text-gray-600"
          formatDate={formatDate}
          showWeekControls={false}
          rightSlot={(
            <div className="flex items-center">
              <button
                type="button"
                onClick={load}
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-gray-300 text-gray-500 transition hover:bg-gray-50 hover:text-gray-900"
                title="Refresh FBA summary"
                aria-label="Refresh FBA summary"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        />

        <div ref={scrollRef} className="flex-1 overflow-x-auto overflow-y-auto no-scrollbar w-full">
          <div className="flex flex-col w-full">
            {Object.entries(groupedRows)
              .sort((a, b) => b[0].localeCompare(a[0]))
              .map(([date, dayRows]) => {
                const sortedRows = [...dayRows].sort((a, b) => {
                  const timeA = new Date(a.last_event_at || 0).getTime();
                  const timeB = new Date(b.last_event_at || 0).getTime();
                  return timeB - timeA;
                });

                return (
                  <div key={date} className="flex flex-col">
                    <DateGroupHeader date={date} total={dayRows.length} formatDate={formatDate} />
                    {sortedRows.map((row, index) => {
                      const isSelected = selectedFnsku === row.fnsku;

                      return (
                        <div key={row.fnsku} className="flex flex-col">
                          <div
                            className={`flex w-full items-center gap-2 border-b border-gray-50 px-3 py-2 transition-colors ${
                              isSelected ? 'bg-gray-100' : index % 2 === 0 ? 'bg-white' : 'bg-gray-50/20'
                            } hover:bg-gray-50`}
                          >
                            <motion.button
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              type="button"
                              onClick={() => setSelectedFnsku((current) => (current === row.fnsku ? null : row.fnsku))}
                              className="min-w-0 flex-1 text-left"
                              aria-pressed={isSelected}
                            >
                              <div className="whitespace-normal break-words text-[15px] font-bold leading-snug tracking-tight text-gray-900">
                                {row.product_title || 'Unknown Product'}
                              </div>
                            </motion.button>

                            <div
                              className="flex shrink-0 items-center gap-1.5"
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => e.stopPropagation()}
                              role="presentation"
                            >
                              <FnskuChip value={row.fnsku} />
                              <SerialChip
                                value={row.latest_serial_number || ''}
                                display={getLast6Serial(row.latest_serial_number || '')}
                              />
                              <button
                                type="button"
                                onClick={(e) => openPrintForRow(e, row)}
                                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
                                title="Open print queue"
                                aria-label="Open print queue"
                              >
                                <Printer className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>

                          <AnimatePresence initial={false}>
                            {isSelected ? <InlineRowDetails row={row} onRefresh={load} onOpenLabels={openLabels} /> : null}
                          </AnimatePresence>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
          </div>
        </div>
      </div>
    </div>
  );
}
