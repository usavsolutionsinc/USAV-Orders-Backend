'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from '@/components/Icons';
import WeekHeader from '@/components/ui/WeekHeader';
import { getWeekRangeForOffset } from '@/lib/dashboard-week-range';
import { getCurrentPSTDateKey, formatDateWithOrdinal } from '@/utils/date';
import { TrackingChip, OrderIdChip, SkuScanRefChip, getLast4 } from '@/components/ui/CopyChip';
import { COND_LABEL } from './receiving-constants';

export interface ReceivingLineRow {
  id: number;
  receiving_id: number | null;
  tracking_number: string | null;
  carrier: string | null;
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
  created_at: string | null;
  image_url: string | null;
  source_platform: string | null;
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
  const raw = String(status || 'Unknown').trim().toUpperCase();
  if (raw === 'MATCHED') return 'RECEIVED';
  return raw.replace(/_/g, ' ');
}

function MetaChip({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-500">{label}</p>
      <p className={`mt-1 truncate text-[13px] font-semibold text-gray-900 ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  );
}

const INLINE_PLATFORM_OPTS: Array<{ value: string; label: string }> = [
  { value: '',           label: 'Unknown' },
  { value: 'ebay',       label: 'eBay' },
  { value: 'amazon',     label: 'Amazon' },
  { value: 'aliexpress', label: 'AliExp' },
  { value: 'walmart',    label: 'Walmart' },
  { value: 'other',      label: 'Other' },
];

function InlineDetail({ row }: { row: ReceivingLineRow }) {
  const trackingValue = (row.tracking_number || '').trim();
  const [platform, setPlatform] = useState<string>(() => (row.source_platform || '').toLowerCase());
  const [platformSaving, setPlatformSaving] = useState(false);
  const [notes, setNotes] = useState<string>(row.notes || '');
  const [notesSaving, setNotesSaving] = useState(false);
  const notesDirtyRef = useRef(false);

  useEffect(() => {
    setPlatform((row.source_platform || '').toLowerCase());
  }, [row.source_platform, row.receiving_id]);

  useEffect(() => {
    if (!notesDirtyRef.current) setNotes(row.notes || '');
  }, [row.notes, row.id]);

  // Keep the inline platform in sync when another surface (top PO card,
  // sidebar inspector) mutates source_platform for the same receiving_id.
  useEffect(() => {
    if (row.receiving_id == null) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ receiving_id?: number; source_platform?: string | null }>).detail;
      if (!detail || detail.receiving_id !== row.receiving_id) return;
      setPlatform((detail.source_platform || '').toLowerCase());
    };
    window.addEventListener('receiving-package-updated', handler);
    return () => window.removeEventListener('receiving-package-updated', handler);
  }, [row.receiving_id]);

  const savePlatform = useCallback(async (next: string) => {
    if (row.receiving_id == null) return;
    setPlatformSaving(true);
    try {
      await fetch(`/api/receiving/${row.receiving_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_platform: next || null }),
      });
      window.dispatchEvent(new CustomEvent('receiving-package-updated', {
        detail: { receiving_id: row.receiving_id, source_platform: next || null },
      }));
    } catch {
      /* silent */
    } finally {
      setPlatformSaving(false);
    }
  }, [row.receiving_id]);

  const saveNotes = useCallback(async (next: string) => {
    if (next === (row.notes || '')) return;
    setNotesSaving(true);
    try {
      const res = await fetch('/api/receiving-lines', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id, notes: next || null }),
      });
      const data = await res.json();
      if (data?.success && data.receiving_line) {
        dispatchLineUpdated(data.receiving_line as ReceivingLineRow);
        notesDirtyRef.current = false;
      }
    } catch {
      /* silent */
    } finally {
      setNotesSaving(false);
    }
  }, [row.id, row.notes]);

  return (
    <div className="px-5 pb-3 pt-2">
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-5">
        {/* Notes — leftmost, spans 2 columns for room to read/edit. */}
        <div className="sm:col-span-2 min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-500">
            Notes{notesSaving ? ' · Saving' : ''}
          </p>
          <textarea
            value={notes}
            onChange={(e) => { notesDirtyRef.current = true; setNotes(e.target.value); }}
            onBlur={() => { if (notesDirtyRef.current) void saveNotes(notes); }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="Add notes for this line…"
            rows={3}
            className="mt-1 w-full resize-none rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[12px] leading-snug text-gray-900 placeholder:text-gray-400 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500/10"
          />
        </div>

        {/* Platform dropdown — one edit propagates to every line on the same receiving row. */}
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-500">
            Platform{platformSaving ? ' · …' : ''}
          </p>
          <select
            value={platform}
            onChange={(e) => {
              const next = e.target.value;
              setPlatform(next);
              void savePlatform(next);
            }}
            onClick={(e) => e.stopPropagation()}
            disabled={row.receiving_id == null}
            className="mt-1 w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[12px] font-semibold text-gray-900 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {INLINE_PLATFORM_OPTS.map((opt) => (
              <option key={opt.value || 'auto'} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <MetaChip label="Tracking" value={trackingValue || 'No package linked'} mono />
        <MetaChip label="Created" value={formatExpandedDate(row.created_at)} />
        <MetaChip
          label="Testing"
          value={row.needs_test ? `Required${row.assigned_tech_id ? ` · Tech #${row.assigned_tech_id}` : ''}` : 'Cleared'}
        />
      </div>
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
  const qtyExpected = row.quantity_expected ?? 0;
  const workflowLabel = getStatusLabel(row.workflow_status || 'EXPECTED');
  const condGrade = (row.condition_grade || '').toUpperCase();
  const conditionLabel = condGrade === 'BRAND_NEW' ? 'NEW' : condGrade === 'PARTS' ? 'PARTS' : condGrade.startsWith('USED') ? 'USED' : condGrade || 'N/A';
  const conditionColor = condGrade === 'BRAND_NEW' ? 'text-yellow-600' : condGrade === 'PARTS' ? 'text-amber-800' : 'text-gray-500';
  const trackingValue = (row.tracking_number || '').trim();
  const skuValue = (row.sku || '').trim();
  const poValue = (row.zoho_purchaseorder_number || row.zoho_purchaseorder_id || '').trim();

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

        <div className="flex shrink-0 items-center gap-0.5 pr-2">
          <OrderIdChip value={poValue} display={getLast4(poValue)} />
          <SkuScanRefChip value={skuValue} display={getLast4(skuValue)} />
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
          {isExpanded && <InlineDetail row={row} />}
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

  useEffect(() => {
    const handler = (e: Event) => {
      const filter = (e as CustomEvent<string>).detail ?? '';
      setWorkflowFilter(filter);
    };
    window.addEventListener('receiving-workflow-filter', handler);
    return () => window.removeEventListener('receiving-workflow-filter', handler);
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
                    window.dispatchEvent(new CustomEvent('receiving-workflow-filter-reset'));
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
