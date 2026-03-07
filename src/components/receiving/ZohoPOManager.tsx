'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Check,
  ChevronRight,
  Loader2,
  Package,
  RefreshCw,
  Search,
  X,
} from '@/components/Icons';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ZohoPOLine {
  line_item_id: string;
  item_id: string;
  name?: string;
  sku?: string;
  description?: string;
  quantity?: number;
  quantity_received?: number;
  rate?: number;
  total?: number;
  unit?: string;
}

interface ZohoPO {
  purchaseorder_id: string;
  purchaseorder_number?: string;
  vendor_name?: string;
  status?: string;
  date?: string;
  delivery_date?: string;
  expected_delivery_date?: string;
  total?: number;
  currency_code?: string;
  warehouse_id?: string;
  warehouse_name?: string;
  line_items?: ZohoPOLine[];
  reference_number?: string;
}

type POStatus = 'open' | 'billed' | 'draft' | 'cancelled' | 'all';

const STATUS_OPTIONS: Array<{ value: POStatus; label: string }> = [
  { value: 'open', label: 'Open' },
  { value: 'billed', label: 'Billed' },
  { value: 'draft', label: 'Draft' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'all', label: 'All' },
];

const CONDITION_OPTIONS = [
  { value: 'BRAND_NEW', label: 'Brand New' },
  { value: 'USED_A', label: 'Used — A' },
  { value: 'USED_B', label: 'Used — B' },
  { value: 'USED_C', label: 'Used — C' },
  { value: 'PARTS', label: 'Parts' },
] as const;

const CHANNEL_OPTIONS = [
  { value: '', label: 'No Channel' },
  { value: 'ORDERS', label: 'Orders' },
  { value: 'FBA', label: 'FBA' },
] as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function statusColor(status?: string) {
  switch ((status || '').toLowerCase()) {
    case 'open':      return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'billed':    return 'bg-green-50 text-green-700 border-green-200';
    case 'draft':     return 'bg-gray-100 text-gray-600 border-gray-200';
    case 'cancelled': return 'bg-red-50 text-red-600 border-red-200';
    default:          return 'bg-gray-100 text-gray-500 border-gray-200';
  }
}

function fmtDate(d?: string) {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return `${m}/${day}/${y}`;
}

function fmtCurrency(n?: number, code?: string) {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: code || 'USD',
    maximumFractionDigits: 2,
  }).format(n);
}

// ─── PO List Item ─────────────────────────────────────────────────────────────

function POListItem({
  po,
  selected,
  onClick,
}: {
  po: ZohoPO;
  selected: boolean;
  onClick: () => void;
}) {
  const lineCount = po.line_items?.length ?? 0;
  return (
    <motion.button
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 border-b border-gray-50/80 transition-colors group ${
        selected ? 'bg-blue-50/70' : 'bg-white hover:bg-gray-50/60'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-black text-gray-800 uppercase tracking-wide truncate">
          {po.purchaseorder_number || po.purchaseorder_id}
        </span>
        <span
          className={`shrink-0 text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border ${statusColor(po.status)}`}
        >
          {po.status || '—'}
        </span>
      </div>
      <div className="flex items-center justify-between mt-0.5 gap-1">
        <span className="text-[10px] text-gray-500 truncate">{po.vendor_name || 'Unknown vendor'}</span>
        <span className="text-[10px] text-gray-400 shrink-0 tabular-nums">
          {fmtCurrency(po.total, po.currency_code)}
        </span>
      </div>
      <div className="flex items-center gap-2 mt-0.5">
        <span className="text-[9px] text-gray-400">{fmtDate(po.date)}</span>
        {lineCount > 0 && (
          <span className="text-[9px] text-gray-400">
            {lineCount} item{lineCount !== 1 ? 's' : ''}
          </span>
        )}
        {po.delivery_date && (
          <span className="text-[9px] text-orange-400">Due {fmtDate(po.delivery_date)}</span>
        )}
      </div>
    </motion.button>
  );
}

// ─── PO Detail / Receive Form ─────────────────────────────────────────────────

interface LineFormState {
  quantity_received: string;
  condition_grade: string;
}

function PODetailPanel({
  po,
  onClose,
  onReceived,
}: {
  po: ZohoPO;
  onClose: () => void;
  onReceived: (receivingId: number) => void;
}) {
  const lines = po.line_items ?? [];

  const [lineState, setLineState] = useState<Record<string, LineFormState>>(() =>
    Object.fromEntries(
      lines.map((l) => [
        l.line_item_id,
        {
          quantity_received: String(l.quantity ?? ''),
          condition_grade: 'BRAND_NEW',
        },
      ])
    )
  );
  const [targetChannel, setTargetChannel] = useState('');
  const [needsTest, setNeedsTest] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [successId, setSuccessId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const updateLine = (id: string, field: keyof LineFormState, value: string) =>
    setLineState((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));

  const handleReceive = async () => {
    setError(null);
    const submitLines = lines
      .map((l) => ({
        line_item_id: l.line_item_id,
        item_id: l.item_id,
        item_name: l.name || null,
        sku: l.sku || null,
        quantity_received: Number(lineState[l.line_item_id]?.quantity_received ?? 0),
        condition_grade: lineState[l.line_item_id]?.condition_grade ?? 'BRAND_NEW',
      }))
      .filter((l) => l.quantity_received > 0);

    if (submitLines.length === 0) {
      setError('Enter a received quantity for at least one item.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/zoho/purchase-orders/receive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          purchaseorder_id: po.purchaseorder_id,
          warehouse_id: po.warehouse_id || undefined,
          line_items: submitLines,
          target_channel: targetChannel || undefined,
          needs_test: needsTest,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Receive failed');
      setSuccessId(Number(json.receiving_id));
      onReceived(Number(json.receiving_id));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Receive failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (successId) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-8">
        <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center">
          <Check className="w-7 h-7 text-green-600" />
        </div>
        <p className="text-[13px] font-black text-gray-800 uppercase tracking-wide">
          Items Received
        </p>
        <p className="text-[11px] text-gray-500">
          Receiving record #{successId} created and saved to Zoho Inventory.
        </p>
        <button
          onClick={onClose}
          className="mt-2 text-[10px] font-black uppercase tracking-widest text-blue-600 hover:text-blue-700 transition-colors"
        >
          Close
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-black text-gray-900 uppercase tracking-wide">
              {po.purchaseorder_number || po.purchaseorder_id}
            </span>
            <span
              className={`text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border ${statusColor(po.status)}`}
            >
              {po.status}
            </span>
          </div>
          <p className="text-[10px] text-gray-500 mt-0.5">
            {po.vendor_name} &middot; {fmtDate(po.date)}
            {po.delivery_date ? ` · Due ${fmtDate(po.delivery_date)}` : ''}
          </p>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Line Items Table */}
      <div className="flex-1 overflow-y-auto">
        {lines.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center opacity-30">
            <Package className="w-10 h-10 mb-3" />
            <p className="text-[10px] font-black uppercase tracking-widest">No line items</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {/* Table header */}
            <div className="grid grid-cols-[1fr_80px_90px_110px] gap-2 px-4 py-1.5 bg-gray-50 border-b border-gray-100 sticky top-0 z-10">
              {['Item', 'Expected', 'Receive', 'Condition'].map((h) => (
                <span key={h} className="text-[8px] font-black uppercase tracking-widest text-gray-400">
                  {h}
                </span>
              ))}
            </div>

            {lines.map((line) => {
              const ls = lineState[line.line_item_id] ?? { quantity_received: '', condition_grade: 'BRAND_NEW' };
              const remaining = Math.max(
                0,
                (line.quantity ?? 0) - (line.quantity_received ?? 0)
              );
              return (
                <div
                  key={line.line_item_id}
                  className="grid grid-cols-[1fr_80px_90px_110px] gap-2 px-4 py-2.5 items-center"
                >
                  {/* Item info */}
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold text-gray-800 truncate leading-tight">
                      {line.name || line.item_id}
                    </p>
                    {line.sku && (
                      <p className="text-[9px] font-mono text-gray-400 mt-0.5">{line.sku}</p>
                    )}
                  </div>

                  {/* Expected qty */}
                  <div className="text-center">
                    <span className="text-[12px] font-black tabular-nums text-gray-700">
                      {line.quantity ?? '—'}
                    </span>
                    {remaining > 0 && line.quantity_received != null && line.quantity_received > 0 && (
                      <p className="text-[8px] text-orange-500 font-semibold">
                        {remaining} left
                      </p>
                    )}
                  </div>

                  {/* Received qty input */}
                  <input
                    type="number"
                    min={0}
                    max={line.quantity ?? 9999}
                    value={ls.quantity_received}
                    onChange={(e) =>
                      updateLine(line.line_item_id, 'quantity_received', e.target.value)
                    }
                    placeholder="0"
                    className="w-full text-center text-[12px] font-black tabular-nums border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 transition-colors bg-white"
                  />

                  {/* Condition select */}
                  <select
                    value={ls.condition_grade}
                    onChange={(e) =>
                      updateLine(line.line_item_id, 'condition_grade', e.target.value)
                    }
                    className="w-full text-[10px] font-bold border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 transition-colors bg-white text-gray-700"
                  >
                    {CONDITION_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer: options + submit */}
      <div className="border-t border-gray-100 px-4 py-3 bg-white">
        {/* Options row */}
        <div className="flex items-center gap-4 mb-3">
          {/* Channel */}
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-black uppercase tracking-widest text-gray-400">
              Channel
            </span>
            <select
              value={targetChannel}
              onChange={(e) => setTargetChannel(e.target.value)}
              className="text-[10px] font-bold border border-gray-200 rounded-md px-2 py-1 focus:outline-none focus:border-blue-400 bg-white text-gray-700"
            >
              {CHANNEL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {/* Needs Test toggle */}
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <div
              onClick={() => setNeedsTest((v) => !v)}
              className={`w-8 h-4 rounded-full transition-colors relative ${
                needsTest ? 'bg-blue-500' : 'bg-gray-200'
              }`}
            >
              <div
                className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${
                  needsTest ? 'translate-x-4' : 'translate-x-0.5'
                }`}
              />
            </div>
            <span className="text-[9px] font-black uppercase tracking-widest text-gray-500">
              Needs Test
            </span>
          </label>
        </div>

        {error && (
          <p className="text-[10px] font-semibold text-red-500 mb-2">{error}</p>
        )}

        <button
          onClick={handleReceive}
          disabled={submitting || lines.length === 0}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[11px] font-black uppercase tracking-widest transition-colors"
        >
          {submitting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Check className="w-4 h-4" />
          )}
          {submitting ? 'Receiving…' : 'Receive Items'}
        </button>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ZohoPOManager() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<POStatus>('open');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedPO, setSelectedPO] = useState<ZohoPO | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce search
  useEffect(() => {
    if (searchRef.current) clearTimeout(searchRef.current);
    searchRef.current = setTimeout(() => setDebouncedSearch(search), 350);
    return () => { if (searchRef.current) clearTimeout(searchRef.current); };
  }, [search]);

  // Fetch PO list
  const { data: poList, isLoading, isFetching, refetch } = useQuery<ZohoPO[]>({
    queryKey: ['zoho-po-list', statusFilter, debouncedSearch],
    queryFn: async () => {
      const params = new URLSearchParams({ per_page: '100' });
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (debouncedSearch) params.set('search_text', debouncedSearch);
      const res = await fetch(`/api/zoho/purchase-orders?${params}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to fetch purchase orders');
      const json = await res.json();
      return Array.isArray(json.purchaseorders) ? json.purchaseorders : [];
    },
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const handleSelectPO = useCallback(async (po: ZohoPO) => {
    // If we already have line items from the list, use them; otherwise fetch detail
    if (po.line_items && po.line_items.length > 0) {
      setSelectedPO(po);
      return;
    }
    setDetailLoading(true);
    setSelectedPO(po); // show skeleton immediately
    try {
      const res = await fetch(
        `/api/zoho/purchase-orders?purchaseorder_id=${encodeURIComponent(po.purchaseorder_id)}`,
        { cache: 'no-store' }
      );
      const json = await res.json();
      if (json.purchaseorder) setSelectedPO(json.purchaseorder as ZohoPO);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const handleReceived = useCallback((_receivingId: number) => {
    // Invalidate PO list and receiving logs
    queryClient.invalidateQueries({ queryKey: ['zoho-po-list'] });
    queryClient.invalidateQueries({ queryKey: ['receiving-logs'] });
    window.dispatchEvent(new CustomEvent('usav-refresh-data'));
  }, [queryClient]);

  return (
    <div className="flex h-full w-full bg-white overflow-hidden">
      {/* ── Left: PO List ──────────────────────────────────────────── */}
      <div className="flex flex-col w-[280px] shrink-0 border-r border-gray-100 overflow-hidden">
        {/* Toolbar */}
        <div className="px-3 pt-3 pb-2 space-y-2 border-b border-gray-100">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search POs…"
              className="w-full pl-8 pr-7 py-1.5 text-[11px] border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 bg-white placeholder-gray-400"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Status filter pills */}
          <div className="flex gap-1 flex-wrap">
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setStatusFilter(opt.value)}
                className={`text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border transition-colors ${
                  statusFilter === opt.value
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* List header */}
        <div className="flex items-center justify-between px-3 py-1.5">
          <span className="text-[8px] font-black uppercase tracking-widest text-gray-400">
            {isLoading ? 'Loading…' : `${poList?.length ?? 0} orders`}
          </span>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="text-gray-400 hover:text-blue-500 transition-colors disabled:opacity-40"
            title="Refresh"
          >
            <RefreshCw className={`w-3 h-3 ${isFetching ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* PO rows */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-gray-300">
              <Loader2 className="w-7 h-7 animate-spin" />
              <p className="text-[9px] font-black uppercase tracking-widest">Loading POs…</p>
            </div>
          ) : !poList || poList.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center opacity-25">
              <Package className="w-10 h-10 mb-3" />
              <p className="text-[9px] font-black uppercase tracking-widest">
                {debouncedSearch ? 'No matching POs' : 'No purchase orders'}
              </p>
            </div>
          ) : (
            poList.map((po) => (
              <POListItem
                key={po.purchaseorder_id}
                po={po}
                selected={selectedPO?.purchaseorder_id === po.purchaseorder_id}
                onClick={() => handleSelectPO(po)}
              />
            ))
          )}
        </div>
      </div>

      {/* ── Right: PO Detail / Receive Form ────────────────────────── */}
      <div className="flex-1 min-w-0 overflow-hidden relative">
        <AnimatePresence mode="wait">
          {selectedPO ? (
            detailLoading ? (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center h-full gap-3 text-gray-300"
              >
                <Loader2 className="w-8 h-8 animate-spin" />
                <p className="text-[9px] font-black uppercase tracking-widest">
                  Loading PO details…
                </p>
              </motion.div>
            ) : (
              <motion.div
                key={selectedPO.purchaseorder_id}
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                className="h-full"
              >
                <PODetailPanel
                  po={selectedPO}
                  onClose={() => setSelectedPO(null)}
                  onReceived={handleReceived}
                />
              </motion.div>
            )
          ) : (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center h-full gap-4 text-center opacity-20 select-none"
            >
              <Package className="w-16 h-16" />
              <div>
                <p className="text-[11px] font-black uppercase tracking-widest">
                  Select a Purchase Order
                </p>
                <p className="text-[9px] mt-1 text-gray-500">
                  Choose a PO from the list to review and receive items
                </p>
              </div>
              <ChevronRight className="w-5 h-5 -rotate-90 opacity-50" />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
