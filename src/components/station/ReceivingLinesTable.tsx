'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, RefreshCw } from '@/components/Icons';
import { TrackingChip, OrderIdChip, SkuScanRefChip, SerialChip, getLast4, getLast6Serial } from '@/components/ui/CopyChip';
import { conditionGradeTableLabel } from '@/components/station/receiving-constants';

// View id dispatched from the sidebar. Both go through the API `view` param.
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

function getStatusLabel(status: string | null | undefined) {
  const raw = String(status || 'Unknown').trim().toUpperCase();
  if (raw === 'MATCHED') return 'RECEIVED';
  return raw.replace(/_/g, ' ');
}

function OrderRow({
  row,
  isSelected,
  onSelect,
  onResolve,
  index,
}: {
  row: ReceivingLineRow;
  isSelected: boolean;
  onSelect: () => void;
  onResolve: (row: ReceivingLineRow) => Promise<void> | void;
  index: number;
}) {
  const productTitle = row.item_name || row.zoho_item_id || 'Unnamed inbound line';
  const quantityText = `${row.quantity_received}/${row.quantity_expected ?? '?'}`;
  const qtyExpected = row.quantity_expected ?? 0;
  const workflowLabel = getStatusLabel(row.workflow_status || 'EXPECTED');
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

  // Show the resolve button when the line isn't fully paired: no carton link
  // yet (receiving_id null) OR no tracking on this row. Keep the icon left of
  // the TrackingChip so it visually anchors to the chip it refreshes.
  const [resolving, setResolving] = useState(false);
  const needsResolve = (!row.receiving_id || !trackingValue);
  const handleResolve = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (resolving) return;
    setResolving(true);
    try { await onResolve(row); } finally { setResolving(false); }
  };

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
      className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-gray-50 px-3 py-1.5 transition-colors cursor-pointer hover:bg-blue-50/50 ${
        isSelected ? 'bg-blue-50/80' : index % 2 === 0 ? 'bg-white' : 'bg-gray-50/10'
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
        {needsResolve && (
          <button
            type="button"
            onClick={handleResolve}
            disabled={resolving}
            aria-label="Refetch tracking / PO from Zoho"
            title="Refetch from Zoho"
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-400 transition-colors hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${resolving ? 'animate-spin' : ''}`} />
          </button>
        )}
        <TrackingChip value={trackingValue} display={getLast4(trackingValue)} />
        <SerialChip value={serialsCsv} display={getLast6Serial(serialsCsv)} />
      </div>
    </div>
  );
}

function OrdersList({
  rows,
  selectedId,
  onSelect,
  onResolve,
}: {
  rows: ReceivingLineRow[];
  selectedId: number | null;
  onSelect: (row: ReceivingLineRow) => void;
  onResolve: (row: ReceivingLineRow) => Promise<void> | void;
}) {
  return (
    <div className="flex flex-col w-full">
      {rows.map((row, index) => (
        <OrderRow
          key={row.id}
          row={row}
          index={index}
          isSelected={selectedId === row.id}
          onSelect={() => onSelect(row)}
          onResolve={onResolve}
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
  // Default to 'recent'. Sidebar can switch to any supported view id.
  const [view, setView] = useState<ReceivingView>('recent');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [localRows, setLocalRows] = useState<ReceivingLineRow[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const LIMIT = 500;

  const buildParams = useCallback(() => {
    const p = new URLSearchParams({ limit: String(LIMIT), offset: '0' });
    p.set('include', 'serials');
    if (receivingId) {
      p.set('receiving_id', String(receivingId));
      return p.toString();
    }
    p.set('view', view);
    return p.toString();
  }, [receivingId, view]);

  const queryKey = ['receiving-lines-table', receivingId, view];
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

  useEffect(() => {
    const handler = (e: Event) => {
      const raw = String((e as CustomEvent<string>).detail ?? '').toLowerCase();
      setView(raw === 'received' ? 'received' : raw === 'all' ? 'all' : 'recent');
    };
    window.addEventListener('receiving-workflow-filter', handler);
    return () => window.removeEventListener('receiving-workflow-filter', handler);
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
  }, []);

  // Row-level resolve: posts the line's tracking# to /api/receiving/lookup-po
  // so the server re-pings Zoho (with digit-suffix candidates) and repairs
  // the pairing. Invalidates the query cache when done.
  const handleResolveRow = useCallback(async (row: ReceivingLineRow) => {
    const tracking = (row.tracking_number || '').trim();
    if (!tracking) return;
    try {
      await fetch('/api/receiving/lookup-po', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackingNumber: tracking }),
      });
    } catch { /* silent — user can retry */ }
    await queryClient.invalidateQueries({ queryKey: ['receiving-lines-table'] });
  }, [queryClient]);

  const emptyMessage = view === 'received'
    ? 'No received lines yet.'
    : view === 'all'
    ? 'No lines yet — start scanning to populate.'
    : 'No recent scans — start scanning to populate.';

  return (
    <div className="flex h-full min-w-0 overflow-hidden bg-white">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
          {isLoading && localRows.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-gray-500" />
            </div>
          ) : localRows.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-[14px] font-semibold text-gray-500">{emptyMessage}</p>
            </div>
          ) : (
            <OrdersList
              rows={localRows}
              selectedId={selectedId}
              onSelect={handleSelectRow}
              onResolve={handleResolveRow}
            />
          )}
        </div>
      </div>
    </div>
  );
}
