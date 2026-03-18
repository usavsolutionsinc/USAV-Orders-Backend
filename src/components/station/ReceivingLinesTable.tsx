'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Calendar, ChevronRight, Loader2, RefreshCw } from '@/components/Icons';
import { SearchBar } from '@/components/ui/SearchBar';
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

function formatCompactDate(value: string | null) {
  if (!value) return 'No timestamp';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date).replace(',', '');
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

function getStatusTone(status: string | null | undefined) {
  const value = String(status || '').trim().toUpperCase();
  if (value === 'EXPECTED') return 'bg-amber-50 text-amber-900 ring-amber-200';
  if (value === 'MATCHED') return 'bg-blue-50 text-blue-900 ring-blue-200';
  if (value === 'UNBOXED') return 'bg-indigo-50 text-indigo-900 ring-indigo-200';
  if (value === 'PASSED') return 'bg-emerald-50 text-emerald-900 ring-emerald-200';
  if (value.startsWith('FAILED') || value === 'SCRAP') return 'bg-rose-50 text-rose-900 ring-rose-200';
  return 'bg-slate-100 text-slate-800 ring-slate-200';
}

function RowStatusPill({ status }: { status: string | null | undefined }) {
  const label = String(status || 'Unknown').replace(/_/g, ' ');
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-semibold ring-1 ring-inset ${getStatusTone(status)}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {label}
    </span>
  );
}

function MetaChip({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</p>
      <p className={`mt-1 truncate text-[13px] font-semibold text-slate-900 ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  );
}

function OrderRow({
  row,
  isExpanded,
  onToggle,
}: {
  row: ReceivingLineRow;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const panelId = `receiving-line-panel-${row.id}`;
  const productTitle = row.item_name || row.zoho_item_id || 'Unnamed inbound line';
  const quantityText = `${row.quantity_received}/${row.quantity_expected ?? '?'}`;

  return (
    <>
      <tr
        data-line-row-id={row.id}
        className={`border-b border-slate-200 bg-white transition-colors ${
          isExpanded ? 'bg-[color-mix(in_srgb,var(--color-brand-light)_38%,white)]' : 'hover:bg-slate-50'
        }`}
      >
        <td className="w-14 px-3 py-4 align-top">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={isExpanded}
            aria-controls={panelId}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          >
            <ChevronRight className={`h-4 w-4 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
          </button>
        </td>

        <td className="w-[11rem] px-2 py-4 align-top">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={isExpanded}
            aria-controls={panelId}
            className="w-full text-left"
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Inbound</p>
            <p className="mt-1 text-[16px] font-semibold leading-none text-slate-950">#{row.id}</p>
            <p className="mt-2 inline-flex items-center gap-2 text-[12px] font-medium text-slate-600">
              <Calendar className="h-3.5 w-3.5" />
              {formatCompactDate(row.created_at)}
            </p>
          </button>
        </td>

        <td className="min-w-[18rem] px-3 py-4 align-top">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={isExpanded}
            aria-controls={panelId}
            className="w-full text-left"
          >
            <div className="flex flex-wrap items-center gap-2">
              <RowStatusPill status={row.workflow_status || 'EXPECTED'} />
              {row.needs_test ? (
                <span className="inline-flex rounded-full border border-orange-200 bg-orange-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-orange-800">
                  Needs Test
                </span>
              ) : null}
            </div>
            <p className="mt-3 text-[15px] font-semibold leading-6 text-slate-950 md:text-[16px]">
              {productTitle}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-slate-600">
              <span className="font-mono font-semibold text-blue-700">{row.sku || 'No SKU'}</span>
              <span className="font-mono">{row.zoho_purchaseorder_id ? `PO ${row.zoho_purchaseorder_id}` : 'No PO'}</span>
            </div>
            <div className="mt-3 grid gap-2 text-[12px] text-slate-600 sm:hidden">
              <div className="flex items-center justify-between">
                <span className="uppercase tracking-[0.14em] text-slate-400">Qty</span>
                <span className="font-mono font-semibold text-slate-900">{quantityText}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="uppercase tracking-[0.14em] text-slate-400">PO</span>
                <span className="font-mono text-slate-900">{row.zoho_purchaseorder_id || '—'}</span>
              </div>
            </div>
          </button>
        </td>

        <td className="hidden w-[9rem] px-3 py-4 align-top sm:table-cell">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Qty</p>
          <p className="mt-1 text-[18px] font-semibold tabular-nums text-slate-950">{quantityText}</p>
          <p className="mt-2 text-[12px] text-slate-500">
            {row.quantity_expected && row.quantity_expected > 0
              ? `${Math.round((row.quantity_received / row.quantity_expected) * 100)}% received`
              : 'Expected qty pending'}
          </p>
        </td>

        <td className="hidden w-[13rem] px-3 py-4 align-top lg:table-cell">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Purchase Order</p>
          <p className="mt-1 font-mono text-[14px] font-semibold text-slate-950">{row.zoho_purchaseorder_id || '—'}</p>
        </td>
      </tr>

      <tr aria-hidden={!isExpanded} className="border-b border-slate-200 bg-[color-mix(in_srgb,var(--color-brand-light)_20%,white)]">
        <td colSpan={5} className="p-0">
          <div
            id={panelId}
            className="grid transition-[grid-template-rows,opacity] duration-300 ease-out"
            style={{ gridTemplateRows: isExpanded ? '1fr' : '0fr', opacity: isExpanded ? 1 : 0 }}
          >
            <div className="overflow-hidden">
              <div className="grid gap-5 px-5 pb-5 pt-1 md:grid-cols-3">
                <MetaChip label="Product" value={productTitle} />
                <MetaChip label="SKU" value={row.sku || 'Not provided'} mono />
                <MetaChip label="Inbound ID" value={`#${row.id}`} mono />
                <MetaChip label="Purchase Order" value={row.zoho_purchaseorder_id || 'Not linked'} mono />
                <MetaChip label="Purchase Receive" value={row.zoho_purchase_receive_id || 'Not linked'} mono />
                <MetaChip label="Condition" value={COND_LABEL[row.condition_grade] ?? row.condition_grade} />
                <MetaChip label="QA Status" value={row.qa_status.replace(/_/g, ' ')} />
                <MetaChip label="Disposition" value={row.disposition_code.replace(/_/g, ' ')} />
                <MetaChip label="Created" value={formatExpandedDate(row.created_at)} />
                <MetaChip label="Tracking" value={row.tracking_number || 'No package linked'} mono />
                <MetaChip label="Carrier" value={row.carrier || 'Unmatched'} />
                <MetaChip label="Testing" value={row.needs_test ? `Required${row.assigned_tech_id ? ` · Tech #${row.assigned_tech_id}` : ''}` : 'Tech cleared'} />
              </div>

              <div className="border-t border-slate-200 px-5 py-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Notes & Sync</p>
                <div className="mt-3 grid gap-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                  <p className="min-h-[3rem] text-[13px] leading-6 text-slate-700">
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
        </td>
      </tr>
    </>
  );
}

function OrdersTable({
  rows,
  expandedId,
  onToggle,
}: {
  rows: ReceivingLineRow[];
  expandedId: number | null;
  onToggle: (row: ReceivingLineRow) => void;
}) {
  return (
    <table className="w-full min-w-[760px] border-collapse text-left">
      <thead className="sticky top-0 z-10 bg-white">
        <tr className="border-b border-slate-200">
          <th className="w-14 px-3 py-3" />
          <th className="w-[11rem] px-2 py-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Inbound</th>
          <th className="px-3 py-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Product</th>
          <th className="hidden w-[9rem] px-3 py-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 sm:table-cell">Quantity</th>
          <th className="hidden w-[13rem] px-3 py-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 lg:table-cell">Purchase Order</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <OrderRow
            key={row.id}
            row={row}
            isExpanded={expandedId === row.id}
            onToggle={() => onToggle(row)}
          />
        ))}
      </tbody>
    </table>
  );
}

interface ReceivingLinesTableProps {
  receivingId?: number | null;
}

export default function ReceivingLinesTable({ receivingId }: ReceivingLinesTableProps = {}) {
  const queryClient = useQueryClient();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [qaFilter, setQaFilter] = useState('');
  const [dispFilter, setDispFilter] = useState('');
  const [offset, setOffset] = useState(0);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [localRows, setLocalRows] = useState<ReceivingLineRow[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const LIMIT = 100;

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setOffset(0);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (search.trim()) setSearchExpanded(true);
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

  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / LIMIT);
  const currentPage = Math.floor(offset / LIMIT) + 1;

  const handleToggleRow = useCallback((row: ReceivingLineRow) => {
    setExpandedId((current) => {
      const next = current === row.id ? null : row.id;
      dispatchSelectLine(next ? row : null);
      return next;
    });
  }, []);

  const qaOptions = ['', 'PENDING', 'PASSED', 'FAILED_DAMAGED', 'FAILED_INCOMPLETE', 'HOLD'];
  const dispOptions = ['', 'ACCEPT', 'HOLD', 'RTV', 'SCRAP', 'REWORK'];

  return (
    <div className="flex h-full min-w-0 overflow-hidden bg-white">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {searchExpanded ? (
              <SearchBar
                inputRef={searchInputRef}
                value={search}
                onChange={setSearch}
                onClear={() => {
                  setSearch('');
                  setSearchExpanded(false);
                }}
                placeholder="Search product, SKU, PO number..."
                variant="blue"
                size="compact"
                className="max-w-[34rem] flex-1"
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  setSearchExpanded(true);
                  requestAnimationFrame(() => searchInputRef.current?.focus());
                }}
                className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:text-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                aria-label="Expand search"
              >
                <ChevronRight className="h-4 w-4 -rotate-45" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <select
              value={qaFilter}
              onChange={(e) => {
                setQaFilter(e.target.value);
                setOffset(0);
              }}
              className="border-b border-slate-200 bg-transparent px-2 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-700 focus:outline-none"
            >
              {qaOptions.map((option) => (
                <option key={option} value={option}>{option || 'All QA'}</option>
              ))}
            </select>

            <select
              value={dispFilter}
              onChange={(e) => {
                setDispFilter(e.target.value);
                setOffset(0);
              }}
              className="border-b border-slate-200 bg-transparent px-2 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-700 focus:outline-none"
            >
              {dispOptions.map((option) => (
                <option key={option} value={option}>{option || 'All Disp.'}</option>
              ))}
            </select>

            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                {total.toLocaleString()} rows
              </span>
              <button
                type="button"
                onClick={() => refetch()}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:text-slate-950"
                title="Refresh"
              >
                <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>
        </div>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
          {isLoading && localRows.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
            </div>
          ) : localRows.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-[14px] font-semibold text-slate-500">No inbound lines found.</p>
              {(search || qaFilter || dispFilter) && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch('');
                    setQaFilter('');
                    setDispFilter('');
                    setSearchExpanded(false);
                  }}
                  className="border-b border-slate-900 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-900"
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <OrdersTable rows={localRows} expandedId={expandedId} onToggle={handleToggleRow} />
          )}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3">
            <button
              type="button"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - LIMIT))}
              className="border-b border-transparent py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-700 transition hover:border-slate-900 hover:text-slate-950 disabled:opacity-30"
            >
              Prev
            </button>
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Page {currentPage} of {totalPages}
            </span>
            <button
              type="button"
              disabled={offset + LIMIT >= total}
              onClick={() => setOffset(offset + LIMIT)}
              className="border-b border-transparent py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-700 transition hover:border-slate-900 hover:text-slate-950 disabled:opacity-30"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
