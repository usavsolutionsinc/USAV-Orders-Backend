'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from '@/components/Icons';
import WeekHeader from '@/components/ui/WeekHeader';
import { getWeekRangeForOffset } from '@/lib/dashboard-week-range';
import { getCurrentPSTDateKey, formatDateWithOrdinal } from '@/utils/date';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { TrackingChip, OrderIdChip, getLast4 } from '@/components/ui/CopyChip';
import { COND_LABEL } from './receiving-constants';

const WORKFLOW_FILTERS: HorizontalSliderItem[] = [
  { id: '',         label: 'All' },
  { id: 'EXPECTED', label: 'Expected' },
  { id: 'MATCHED',  label: 'Matched' },
  { id: 'UNBOXED',  label: 'Unboxed' },
  { id: 'PASSED',   label: 'Passed' },
  { id: 'FAILED',   label: 'Failed' },
];

export interface ReceivingLineRow {
  id: number;
  receiving_id: number | null;
  tracking_number: string | null;
  carrier: string | null;
  zoho_item_id: string | null;
  zoho_line_item_id: string | null;
  zoho_purchase_receive_id: string | null;
  zoho_purchaseorder_id: string | null;
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
  notes: string | null;
  created_at: string | null;
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

export function dispatchLineUpdated(row: ReceivingLineRow) {
  window.dispatchEvent(new CustomEvent('receiving-line-updated', { detail: row }));
}

function formatExpandedDate(value: string | null) {
  if (!value) return 'Not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
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

function getStatusLabel(status: string | null | undefined) {
  return String(status || 'Unknown').replace(/_/g, ' ');
}

function MetaChip({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-500">{label}</p>
      <p className={`mt-1 truncate text-[13px] font-semibold text-gray-900 ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  );
}

function OrderRow({
  row,
  isExpanded,
  onToggle,
  index,
}: {
  row: ReceivingLineRow;
  isExpanded: boolean;
  onToggle: () => void;
  index: number;
}) {
  const panelId = `receiving-line-panel-${row.id}`;
  const productTitle = row.item_name || row.zoho_item_id || 'Unnamed inbound line';
  const quantityText = `${row.quantity_received}/${row.quantity_expected ?? '?'}`;
  const workflowLabel = getStatusLabel(row.workflow_status || 'EXPECTED');
  const conditionLabel = (COND_LABEL[row.condition_grade] ?? row.condition_grade ?? '').trim().toUpperCase() || 'NO CONDITION';
  const trackingValue = (row.tracking_number || '').trim();
  const poValue = (row.zoho_purchaseorder_id || '').trim();

  return (
    <div className="border-b border-gray-50">
      <div
        data-line-row-id={row.id}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onToggle();
          }
        }}
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        aria-controls={panelId}
        aria-label={`Toggle receiving line ${row.id}`}
        className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-1.5 transition-colors cursor-pointer hover:bg-blue-50/50 ${
          isExpanded ? 'bg-blue-50/80' : index % 2 === 0 ? 'bg-white' : 'bg-gray-50/10'
        }`}
      >
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${getStatusDotBg(row.workflow_status)}`}
              title={workflowLabel}
            />
            <div className="text-[13px] font-bold text-gray-900 truncate">
              {productTitle}
            </div>
          </div>
          <div className="mt-0.5 flex items-center gap-2">
            <div className="text-[11px] font-black text-gray-500 uppercase tracking-widest truncate min-w-0 flex-1 pl-4">
              <span className={row.quantity_expected && row.quantity_received >= row.quantity_expected ? 'text-emerald-600' : 'text-gray-700'}>
                {quantityText}
              </span>
              {' • '}
              {row.sku || 'NO SKU'}
              {' • '}
              {conditionLabel}
              {' • '}
              {workflowLabel}
              {row.needs_test ? <span className="text-orange-600">{' • NEEDS TEST'}</span> : null}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-0.5 pr-2">
          <OrderIdChip value={poValue} display={getLast4(poValue)} />
          <TrackingChip value={trackingValue} display={getLast4(trackingValue)} />
        </div>
      </div>

      <div
        id={panelId}
        aria-hidden={!isExpanded}
        className="grid transition-[grid-template-rows,opacity] duration-300 ease-out bg-blue-50/30"
        style={{ gridTemplateRows: isExpanded ? '1fr' : '0fr', opacity: isExpanded ? 1 : 0 }}
      >
        <div className="overflow-hidden">
          <div className="grid gap-4 px-5 pb-4 pt-3 md:grid-cols-3">
            <MetaChip label="Product" value={productTitle} />
            <MetaChip label="SKU" value={row.sku || 'Not provided'} mono />
            <MetaChip label="Inbound ID" value={`#${row.id}`} mono />
            <MetaChip label="Purchase Order" value={poValue || 'Not linked'} mono />
            <MetaChip label="Purchase Receive" value={row.zoho_purchase_receive_id || 'Not linked'} mono />
            <MetaChip label="Condition" value={COND_LABEL[row.condition_grade] ?? row.condition_grade} />
            <MetaChip label="QA Status" value={row.qa_status.replace(/_/g, ' ')} />
            <MetaChip label="Disposition" value={row.disposition_code.replace(/_/g, ' ')} />
            <MetaChip label="Created" value={formatExpandedDate(row.created_at)} />
            <MetaChip label="Tracking" value={trackingValue || 'No package linked'} mono />
            <MetaChip label="Carrier" value={row.carrier || 'Unmatched'} />
            <MetaChip label="Testing" value={row.needs_test ? `Required${row.assigned_tech_id ? ` · Tech #${row.assigned_tech_id}` : ''}` : 'Tech cleared'} />
          </div>

          <div className="border-t border-gray-200 px-5 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-500">Notes & Sync</p>
            <div className="mt-3 grid gap-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
              <p className="min-h-[3rem] text-[13px] leading-6 text-gray-700">
                {row.notes || 'No operator notes yet.'}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <MetaChip label="Sync Source" value={row.zoho_sync_source || 'Local only'} />
                <MetaChip label="Zoho Modified" value={row.zoho_last_modified_time || 'Not available'} mono />
                <MetaChip label="Synced At" value={formatExpandedDate(row.zoho_synced_at)} />
                <MetaChip label="Zoho Line" value={row.zoho_line_item_id || 'Not available'} mono />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function OrdersList({
  rows,
  expandedId,
  onToggle,
}: {
  rows: ReceivingLineRow[];
  expandedId: number | null;
  onToggle: (row: ReceivingLineRow) => void;
}) {
  return (
    <div className="flex flex-col w-full">
      {rows.map((row, index) => (
        <OrderRow
          key={row.id}
          row={row}
          index={index}
          isExpanded={expandedId === row.id}
          onToggle={() => onToggle(row)}
        />
      ))}
    </div>
  );
}

interface ReceivingLinesTableProps {
  receivingId?: number | null;
}

export default function ReceivingLinesTable({ receivingId }: ReceivingLinesTableProps = {}) {
  const queryClient = useQueryClient();
  const [workflowFilter, setWorkflowFilter] = useState('');
  const [weekOffset, setWeekOffset] = useState(0);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [localRows, setLocalRows] = useState<ReceivingLineRow[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const LIMIT = 500;

  const weekRange = useMemo(() => getWeekRangeForOffset(weekOffset), [weekOffset]);

  const buildParams = useCallback(() => {
    const p = new URLSearchParams({ limit: String(LIMIT), offset: '0' });
    if (receivingId) p.set('receiving_id', String(receivingId));
    if (workflowFilter) p.set('workflow_status', workflowFilter);
    if (!receivingId) {
      p.set('week_start', weekRange.startStr);
      p.set('week_end', weekRange.endStr);
    }
    return p.toString();
  }, [receivingId, workflowFilter, weekRange.startStr, weekRange.endStr]);

  const queryKey = ['receiving-lines-table', receivingId, workflowFilter, weekRange.startStr, weekRange.endStr];
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
    if (!expandedId) return;
    if (!localRows.some((row) => row.id === expandedId)) {
      setExpandedId(null);
      dispatchSelectLine(null);
    }
  }, [expandedId, localRows]);

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
      const updated = (event as CustomEvent<ReceivingLineRow>).detail;
      if (!updated) return;
      setLocalRows((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));
    };
    window.addEventListener('receiving-line-updated', handler);
    return () => window.removeEventListener('receiving-line-updated', handler);
  }, []);

  useEffect(() => {
    const handler = () => setExpandedId(null);
    window.addEventListener('receiving-clear-line', handler);
    return () => window.removeEventListener('receiving-clear-line', handler);
  }, []);

  const total = data?.total ?? localRows.length;

  const formatDate = useCallback((dateStr: string) => formatDateWithOrdinal(dateStr), []);
  const fallbackDate =
    weekOffset > 0
      ? `${formatDate(weekRange.startStr)} - ${formatDate(weekRange.endStr)}`
      : formatDate(getCurrentPSTDateKey());

  const handleToggleRow = useCallback((row: ReceivingLineRow) => {
    setExpandedId((current) => {
      const next = current === row.id ? null : row.id;
      dispatchSelectLine(next ? row : null);
      return next;
    });
  }, []);

  return (
    <div className="flex h-full min-w-0 overflow-hidden bg-white">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {receivingId ? null : (
          <WeekHeader
            stickyDate=""
            fallbackDate={fallbackDate}
            count={total}
            weekRange={weekRange}
            weekOffset={weekOffset}
            onPrevWeek={() => {
              setExpandedId(null);
              dispatchSelectLine(null);
              setWeekOffset((o) => o + 1);
            }}
            onNextWeek={() => {
              setExpandedId(null);
              dispatchSelectLine(null);
              setWeekOffset((o) => Math.max(0, o - 1));
            }}
          />
        )}

        <div className="border-b border-gray-200 px-4 py-2">
          <HorizontalButtonSlider
            items={WORKFLOW_FILTERS}
            value={workflowFilter}
            onChange={setWorkflowFilter}
            variant="slate"
            aria-label="Filter by workflow status"
          />
        </div>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
          {isLoading && localRows.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-gray-500" />
            </div>
          ) : localRows.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-[14px] font-semibold text-gray-500">No inbound lines found.</p>
              {workflowFilter && (
                <button
                  type="button"
                  onClick={() => {
                    setWorkflowFilter('');
                    setExpandedId(null);
                    dispatchSelectLine(null);
                  }}
                  className="border-b border-gray-900 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-900"
                >
                  Clear filter
                </button>
              )}
            </div>
          ) : (
            <OrdersList rows={localRows} expandedId={expandedId} onToggle={handleToggleRow} />
          )}
        </div>
      </div>
    </div>
  );
}
