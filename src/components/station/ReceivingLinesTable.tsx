'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, RefreshCw, Search, X } from '@/components/Icons';
import { QA_BADGE, DISP_BADGE, COND_LABEL } from './receiving-constants';

// ─── Types ────────────────────────────────────────────────────────────────────

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
  disposition_code: string;
  condition_grade: string;
  disposition_audit: unknown[];
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

// ─── Cross-component event helpers ────────────────────────────────────────────

export function dispatchSelectLine(row: ReceivingLineRow | null) {
  window.dispatchEvent(new CustomEvent('receiving-select-line', { detail: row }));
}
export function dispatchLineUpdated(row: ReceivingLineRow) {
  window.dispatchEvent(new CustomEvent('receiving-line-updated', { detail: row }));
}

// ─── Palette helpers ──────────────────────────────────────────────────────────

function qaBadge(status: string) {
  return QA_BADGE[status] ?? 'bg-gray-100 text-gray-500';
}
function dispBadge(code: string) {
  return DISP_BADGE[code] ?? 'bg-gray-100 text-gray-500 border-gray-200';
}

// ─── Row component ────────────────────────────────────────────────────────────

function LineRow({
  row,
  isSelected,
  onClick,
}: {
  row: ReceivingLineRow;
  isSelected: boolean;
  onClick: () => void;
}) {
  const progressPct =
    row.quantity_expected && row.quantity_expected > 0
      ? Math.min(100, Math.round((row.quantity_received / row.quantity_expected) * 100))
      : null;

  const receivedDate = row.created_at
    ? (() => {
        const d = new Date(row.created_at);
        return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      })()
    : '—';

  const carrierShort = row.carrier ? row.carrier.toUpperCase().slice(0, 5) : null;
  const trackingShort = row.tracking_number ? `…${row.tracking_number.slice(-6)}` : null;

  return (
    <tr
      onClick={onClick}
      data-line-row-id={row.id}
      className={`group cursor-pointer border-b border-gray-50 transition-colors ${
        isSelected ? 'bg-indigo-50' : 'hover:bg-gray-50/60'
      }`}
    >
      {/* ID + date */}
      <td className="px-3 py-2.5 whitespace-nowrap w-[80px]">
        <p className={`text-[10px] font-black tabular-nums ${isSelected ? 'text-indigo-700' : 'text-gray-700'}`}>
          #{row.id}
        </p>
        <p className="text-[8px] font-mono text-gray-400 mt-0.5">{receivedDate}</p>
      </td>

      {/* Item */}
      <td className="px-3 py-2.5 min-w-[160px] max-w-[240px]">
        <p className="text-[11px] font-bold text-gray-800 truncate leading-snug">
          {row.item_name || row.zoho_item_id || '—'}
        </p>
        {row.sku && (
          <p className="text-[8px] font-mono text-indigo-500 mt-0.5 truncate">{row.sku}</p>
        )}
        {row.zoho_purchaseorder_id && (
          <p className="text-[8px] font-mono text-gray-400 mt-0.5 truncate">
            PO {row.zoho_purchaseorder_id}
          </p>
        )}
      </td>

      {/* Package / tracking */}
      <td className="px-3 py-2.5 whitespace-nowrap w-[100px]">
        {row.receiving_id ? (
          <div className="flex flex-col gap-0.5">
            {carrierShort && (
              <span className="text-[7px] font-black uppercase tracking-widest text-gray-400">
                {carrierShort}
              </span>
            )}
            <span className="text-[10px] font-black font-mono text-gray-600">
              {trackingShort ?? `#${row.receiving_id}`}
            </span>
          </div>
        ) : (
          <span className="text-[9px] font-medium text-gray-300 italic">Unmatched</span>
        )}
      </td>

      {/* Qty */}
      <td className="px-3 py-2.5 w-[80px]">
        <div className="flex flex-col items-start gap-1">
          <span className="text-[12px] font-black tabular-nums text-gray-700 leading-none">
            {row.quantity_received}
            <span className="text-gray-300 mx-0.5 font-normal">/</span>
            <span className="text-gray-400 text-[10px]">{row.quantity_expected ?? '?'}</span>
          </span>
          {progressPct !== null && (
            <div className="h-1 w-12 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${progressPct === 100 ? 'bg-emerald-400' : 'bg-indigo-400'}`}
                style={{ width: `${progressPct}%` }}
              />
            </div>
          )}
        </div>
      </td>

      {/* QA status */}
      <td className="px-3 py-2.5 w-[110px]">
        <span className={`inline-block text-[8px] font-black uppercase tracking-wider rounded-lg px-2 py-1 ${qaBadge(row.qa_status)}`}>
          {row.qa_status.replace(/_/g, ' ')}
        </span>
      </td>

      {/* Disposition */}
      <td className="px-3 py-2.5 w-[80px]">
        <span className={`inline-block text-[8px] font-black uppercase tracking-wider rounded-lg px-2 py-1 border ${dispBadge(row.disposition_code)}`}>
          {row.disposition_code}
        </span>
      </td>

      {/* Condition */}
      <td className="px-3 py-2.5 w-[60px]">
        <span className="text-[9px] font-black text-gray-500 uppercase tracking-wide">
          {COND_LABEL[row.condition_grade] ?? row.condition_grade}
        </span>
      </td>

      {/* Notes */}
      <td className="px-3 py-2.5 max-w-[120px]">
        {row.notes ? (
          <p className="text-[9px] font-medium text-gray-400 truncate italic">{row.notes}</p>
        ) : (
          <span className="text-[8px] text-gray-200">—</span>
        )}
      </td>
    </tr>
  );
}

// ─── Main table component ─────────────────────────────────────────────────────

interface ReceivingLinesTableProps {
  /** Pre-filter to a specific receiving package */
  receivingId?: number | null;
}

export default function ReceivingLinesTable({ receivingId }: ReceivingLinesTableProps = {}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [qaFilter, setQaFilter] = useState('');
  const [dispFilter, setDispFilter] = useState('');
  const [offset, setOffset] = useState(0);
  const [selectedLine, setSelectedLine] = useState<ReceivingLineRow | null>(null);
  const [localRows, setLocalRows] = useState<ReceivingLineRow[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const LIMIT = 100;

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setOffset(0); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const buildParams = useCallback(() => {
    const p = new URLSearchParams({ limit: String(LIMIT), offset: String(offset) });
    if (receivingId) p.set('receiving_id', String(receivingId));
    if (debouncedSearch) p.set('search', debouncedSearch);
    if (qaFilter) p.set('qa_status', qaFilter);
    if (dispFilter) p.set('disposition', dispFilter);
    return p.toString();
  }, [receivingId, debouncedSearch, qaFilter, dispFilter, offset]);

  const queryKey = ['receiving-lines-table', receivingId, debouncedSearch, qaFilter, dispFilter, offset];

  const { data, isLoading, isFetching, refetch } = useQuery<ApiResponse>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(`/api/receiving-lines?${buildParams()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('fetch failed');
      return res.json();
    },
    staleTime: 20_000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (data?.receiving_lines) setLocalRows(data.receiving_lines);
  }, [data]);

  // Refresh when a scan event fires
  useEffect(() => {
    const handler = () => { queryClient.invalidateQueries({ queryKey: ['receiving-lines-table'] }); };
    window.addEventListener('receiving-entry-added', handler);
    window.addEventListener('usav-refresh-data', handler);
    return () => {
      window.removeEventListener('receiving-entry-added', handler);
      window.removeEventListener('usav-refresh-data', handler);
    };
  }, [queryClient]);

  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / LIMIT);
  const currentPage = Math.floor(offset / LIMIT) + 1;

  const handleRowClick = useCallback((row: ReceivingLineRow) => {
    setSelectedLine((prev) => {
      const next = prev?.id === row.id ? null : row;
      dispatchSelectLine(next);
      return next;
    });
  }, []);

  // Keep local rows in sync when the sidebar saves a line
  useEffect(() => {
    const handler = (e: Event) => {
      const updated = (e as CustomEvent<ReceivingLineRow>).detail;
      if (!updated) return;
      setLocalRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      setSelectedLine((prev) => (prev?.id === updated.id ? updated : prev));
    };
    window.addEventListener('receiving-line-updated', handler);
    return () => window.removeEventListener('receiving-line-updated', handler);
  }, []);

  // Clear selection when sidebar dismisses the panel
  useEffect(() => {
    const handler = () => {
      setSelectedLine(null);
    };
    window.addEventListener('receiving-clear-line', handler);
    return () => window.removeEventListener('receiving-clear-line', handler);
  }, []);

  const qaOptions = ['', 'PENDING', 'PASSED', 'FAILED_DAMAGED', 'FAILED_INCOMPLETE', 'HOLD'];
  const dispOptions = ['', 'ACCEPT', 'HOLD', 'RTV', 'SCRAP', 'REWORK'];

  return (
    <div className="flex h-full min-w-0 bg-white overflow-hidden">
      {/* ── Main table panel ── */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

        {/* Toolbar */}
        <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 bg-white">
          {/* Search */}
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-300 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search item, SKU, PO…"
              className="w-full pl-8 pr-8 py-2 rounded-xl border border-gray-200 text-[11px] font-medium text-gray-700 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white"
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* QA filter */}
          <select
            value={qaFilter}
            onChange={(e) => { setQaFilter(e.target.value); setOffset(0); }}
            className="text-[10px] font-black uppercase tracking-wider rounded-xl border border-gray-200 px-2 py-2 bg-white text-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-300 cursor-pointer"
          >
            {qaOptions.map((o) => (
              <option key={o} value={o}>{o || 'All QA'}</option>
            ))}
          </select>

          {/* Disposition filter */}
          <select
            value={dispFilter}
            onChange={(e) => { setDispFilter(e.target.value); setOffset(0); }}
            className="text-[10px] font-black uppercase tracking-wider rounded-xl border border-gray-200 px-2 py-2 bg-white text-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-300 cursor-pointer"
          >
            {dispOptions.map((o) => (
              <option key={o} value={o}>{o || 'All Disp.'}</option>
            ))}
          </select>

          {/* Count + refresh */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span className="text-[9px] font-black text-gray-400 tabular-nums">
              {total.toLocaleString()} line{total !== 1 ? 's' : ''}
            </span>
            {isFetching && !isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-300" />}
            <button
              type="button"
              onClick={() => refetch()}
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Table */}
        <div ref={scrollRef} className="flex-1 overflow-auto" style={{ scrollbarWidth: 'thin' }}>
          {isLoading && localRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 opacity-40">
              <Loader2 className="w-8 h-8 animate-spin" />
              <p className="text-[10px] font-black uppercase tracking-widest">Loading lines…</p>
            </div>
          ) : localRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 opacity-20">
              <p className="text-[10px] font-black uppercase tracking-widest">No line items found</p>
              {(search || qaFilter || dispFilter) && (
                <button
                  type="button"
                  onClick={() => { setSearch(''); setQaFilter(''); setDispFilter(''); }}
                  className="text-[9px] font-bold text-indigo-400 hover:underline"
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <table className="w-full border-collapse text-left">
              <thead className="sticky top-0 z-10">
                <tr className="bg-white border-b-2 border-gray-100">
                  <th className="px-3 py-2 text-[8px] font-black uppercase tracking-widest text-gray-400 w-[80px]">ID / Date</th>
                  <th className="px-3 py-2 text-[8px] font-black uppercase tracking-widest text-gray-400">Item</th>
                  <th className="px-3 py-2 text-[8px] font-black uppercase tracking-widest text-gray-400 w-[100px]">Package</th>
                  <th className="px-3 py-2 text-[8px] font-black uppercase tracking-widest text-gray-400 w-[80px]">Qty</th>
                  <th className="px-3 py-2 text-[8px] font-black uppercase tracking-widest text-gray-400 w-[110px]">QA Status</th>
                  <th className="px-3 py-2 text-[8px] font-black uppercase tracking-widest text-gray-400 w-[80px]">Disp.</th>
                  <th className="px-3 py-2 text-[8px] font-black uppercase tracking-widest text-gray-400 w-[60px]">Cond.</th>
                  <th className="px-3 py-2 text-[8px] font-black uppercase tracking-widest text-gray-400">Notes</th>
                </tr>
              </thead>
              <tbody>
                {localRows.map((row) => (
                  <LineRow
                    key={row.id}
                    row={row}
                    isSelected={selectedLine?.id === row.id}
                    onClick={() => handleRowClick(row)}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-t border-gray-100 bg-white">
            <button
              type="button"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - LIMIT))}
              className="text-[9px] font-black uppercase tracking-widest text-gray-500 hover:text-gray-800 disabled:opacity-30 disabled:cursor-not-allowed px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
            >
              ← Prev
            </button>
            <span className="text-[9px] font-black text-gray-400 tabular-nums">
              Page {currentPage} of {totalPages}
            </span>
            <button
              type="button"
              disabled={offset + LIMIT >= total}
              onClick={() => setOffset(offset + LIMIT)}
              className="text-[9px] font-black uppercase tracking-widest text-gray-500 hover:text-gray-800 disabled:opacity-30 disabled:cursor-not-allowed px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
            >
              Next →
            </button>
          </div>
        )}
      </div>

    </div>
  );
}
