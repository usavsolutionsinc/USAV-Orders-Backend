'use client';

import { Fragment, useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Package, Loader2, AlertCircle, Minus } from '@/components/Icons';

// ─── Types ────────────────────────────────────────────────────────────────────
export interface PrintQueueItem {
  item_id: number;
  fnsku: string;
  expected_qty: number;
  actual_qty: number;
  item_status: string;
  display_title: string;
  asin: string | null;
  sku: string | null;
  shipment_id: number;
  shipment_ref: string;
  amazon_shipment_id: string | null;
  due_date: string | null;
  destination_fc: string | null;
}

interface ShipmentGroup {
  shipment_id: number;
  shipment_ref: string;
  amazon_shipment_id: string | null;
  due_date: string | null;
  destination_fc: string | null;
  items: PrintQueueItem[];
}

export interface PrintSelectionPayload {
  selectedItems: PrintQueueItem[];
  shipmentIds: number[];
}

interface Props {
  refreshTrigger?: number | string;
  onSelectionChange?: (payload: PrintSelectionPayload) => void;
}

// ─── Animation variants ───────────────────────────────────────────────────────
const tableVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.04 } },
};

const rowVariants = {
  hidden:  { opacity: 0, y: 12, scale: 0.98 },
  visible: { opacity: 1, y: 0,  scale: 1,    transition: { type: 'spring', stiffness: 400, damping: 28 } },
  exit:    { opacity: 0, y: -8, scale: 0.97, transition: { duration: 0.18 } },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function dueDateLabel(iso: string | null): { text: string; cls: string } {
  if (!iso) return { text: 'No date', cls: 'text-zinc-400' };
  const d    = new Date(iso);
  const now  = new Date();
  const diff = Math.ceil((d.getTime() - now.getTime()) / 86_400_000);
  if (diff < 0)  return { text: `${Math.abs(diff)}d overdue`, cls: 'text-red-500 font-semibold' };
  if (diff === 0) return { text: 'Due today',                 cls: 'text-orange-500 font-semibold' };
  if (diff <= 3)  return { text: `${diff}d left`,             cls: 'text-amber-500' };
  return { text: `${diff}d left`, cls: 'text-zinc-400' };
}

function qtyTag(value: number, kind: 'planned' | 'shipped' | 'remaining') {
  const cfg: Record<typeof kind, string> = {
    planned:   'bg-zinc-100 text-zinc-600 border-zinc-200',
    shipped:   'bg-emerald-50 text-emerald-700 border-emerald-200',
    remaining: 'bg-amber-50 text-amber-700 border-amber-200',
  };
  return (
    <span className={`inline-flex items-center justify-center min-w-[28px] px-1.5 py-0.5 rounded-md border text-xs font-mono font-semibold ${cfg[kind]}`}>
      {value}
    </span>
  );
}

// ─── Checkbox component ───────────────────────────────────────────────────────
function Checkbox({ checked, indeterminate, onChange }: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onChange(!checked);
      }}
      role="checkbox"
      aria-checked={indeterminate && !checked ? 'mixed' : checked}
      aria-label={checked ? 'Deselect item' : 'Select item'}
      className={`
        relative flex items-center justify-center w-4.5 h-4.5 rounded border transition-all duration-150 flex-shrink-0 outline-none
        focus-visible:ring-2 focus-visible:ring-violet-400/60
        ${checked || indeterminate
          ? 'bg-violet-600 border-violet-600'
          : 'bg-white border-zinc-300 hover:border-violet-400'}
      `}
      style={{ width: 18, height: 18 }}
    >
      <AnimatePresence initial={false} mode="wait">
        {indeterminate && !checked ? (
          <motion.span
            key="minus"
            initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}
            className="absolute inset-0 flex items-center justify-center"
          >
            <Minus className="w-[10px] h-[10px] text-white stroke-[3]" />
          </motion.span>
        ) : checked ? (
          <motion.span
            key="check"
            initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}
            className="absolute inset-0 flex items-center justify-center"
          >
            <Check className="w-[10px] h-[10px] text-white stroke-[3]" />
          </motion.span>
        ) : null}
      </AnimatePresence>
    </button>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────
export function FbaPrintReadyTable({ refreshTrigger, onSelectionChange }: Props) {
  const [items,    setItems]    = useState<PrintQueueItem[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch('/api/fba/print-queue');
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed');
      setItems(data.items ?? []);
      setSelected(new Set());
    } catch (e: any) {
      setError(e.message ?? 'Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, refreshTrigger]);

  // ── Selection helpers ──────────────────────────────────────────────────────
  const allIds    = useMemo(() => items.map((i) => i.item_id), [items]);
  const allChecked = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const someChecked = !allChecked && allIds.some((id) => selected.has(id));

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      if (allChecked) return new Set();
      return new Set(allIds);
    });
  }, [allChecked, allIds]);

  const toggleRow = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  // ── Dispatch selection event ──────────────────────────────────────────────
  useEffect(() => {
    const selectedItems = items.filter((i) => selected.has(i.item_id));
    const shipmentIds   = Array.from(new Set(selectedItems.map((i) => i.shipment_id)));
    const payload: PrintSelectionPayload = { selectedItems, shipmentIds };

    window.dispatchEvent(new CustomEvent('fba-print-selection', { detail: payload }));
    onSelectionChange?.(payload);
  }, [selected, items, onSelectionChange]);

  // ── Group by shipment ─────────────────────────────────────────────────────
  const groups = useMemo<ShipmentGroup[]>(() => {
    const map = new Map<number, ShipmentGroup>();
    for (const item of items) {
      if (!map.has(item.shipment_id)) {
        map.set(item.shipment_id, {
          shipment_id:       item.shipment_id,
          shipment_ref:      item.shipment_ref,
          amazon_shipment_id: item.amazon_shipment_id,
          due_date:          item.due_date,
          destination_fc:    item.destination_fc,
          items:             [],
        });
      }
      map.get(item.shipment_id)!.items.push(item);
    }
    return Array.from(map.values());
  }, [items]);

  // ─────────────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-zinc-400">
        <Loader2 className="w-7 h-7 animate-spin" />
        <span className="text-sm">Loading print queue…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 py-16 text-red-500">
        <AlertCircle className="w-[22px] h-[22px]" />
        <p className="text-sm font-medium">{error}</p>
        <button onClick={load} className="text-xs text-zinc-500 underline hover:text-zinc-700">Retry</button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        className="flex flex-col items-center gap-3 py-20 text-zinc-400"
      >
        <div className="w-12 h-12 rounded-2xl bg-zinc-50 border border-zinc-100 flex items-center justify-center">
          <Package className="w-[22px] h-[22px] text-zinc-300" />
        </div>
        <p className="text-sm font-medium text-zinc-400">No items ready to ship</p>
        <p className="text-xs text-zinc-300 text-center max-w-[240px]">
          Items reach this queue once a tech marks them <strong>Ready to Go</strong>.
        </p>
      </motion.div>
    );
  }

  return (
    <div className="flex flex-col gap-0">
      {/* ── Table ─────────────────────────────────────────────────────────── */}
      <div className="overflow-x-auto rounded-xl border border-zinc-200/80 bg-white shadow-sm">
        <table className="w-full text-sm border-collapse">
          {/* Header */}
          <thead>
            <tr className="border-b border-zinc-100 bg-zinc-50/80">
              <th className="pl-4 pr-2 py-2.5 w-8">
                <Checkbox
                  checked={allChecked}
                  indeterminate={someChecked}
                  onChange={toggleAll}
                />
              </th>
              <th className="pl-1 pr-3 py-2.5 text-left text-[11px] font-semibold text-zinc-500 uppercase tracking-wide">FNSKU</th>
              <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-zinc-500 uppercase tracking-wide">Title</th>
              <th className="px-3 py-2.5 text-center text-[11px] font-semibold text-zinc-500 uppercase tracking-wide whitespace-nowrap">Planned</th>
              <th className="px-3 py-2.5 text-center text-[11px] font-semibold text-zinc-500 uppercase tracking-wide whitespace-nowrap">Shipped</th>
              <th className="px-3 py-2.5 text-center text-[11px] font-semibold text-zinc-500 uppercase tracking-wide whitespace-nowrap">Remaining</th>
            </tr>
          </thead>

          <motion.tbody variants={tableVariants} initial="hidden" animate="visible">
            {groups.map((group, gi) => (
              <Fragment key={group.shipment_id}>
                {/* Shipment group header */}
                <motion.tr
                  key={`group-${group.shipment_id}`}
                  variants={rowVariants}
                  className="bg-violet-50/60 border-y border-violet-100/80"
                >
                  <td colSpan={6} className="pl-4 pr-3 py-1.5">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="text-[11px] font-bold text-violet-700 tracking-wide uppercase">
                        {group.shipment_ref}
                      </span>
                      {group.amazon_shipment_id && (
                        <span className="text-[11px] text-violet-500 font-mono bg-violet-100 px-1.5 py-0.5 rounded">
                          {group.amazon_shipment_id}
                        </span>
                      )}
                      {group.destination_fc && (
                        <span className="text-[11px] text-zinc-500">{group.destination_fc}</span>
                      )}
                      <span className={`ml-auto text-[11px] ${dueDateLabel(group.due_date).cls}`}>
                        {dueDateLabel(group.due_date).text}
                      </span>
                    </div>
                  </td>
                </motion.tr>

                {/* Item rows */}
                <AnimatePresence>
                  {group.items.map((item) => {
                    const isChecked  = selected.has(item.item_id);
                    const remaining  = Math.max(0, item.expected_qty - item.actual_qty);

                    return (
                      <motion.tr
                        key={item.item_id}
                        variants={rowVariants}
                        layout
                        exit="exit"
                        onClick={() => toggleRow(item.item_id)}
                        onKeyDown={(event: KeyboardEvent<HTMLTableRowElement>) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            toggleRow(item.item_id);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                        aria-pressed={isChecked}
                        aria-label={`Toggle selection for ${item.fnsku}`}
                        className={`
                          border-b border-zinc-100/80 cursor-pointer transition-colors duration-100 select-none
                          ${isChecked
                            ? 'bg-violet-50/70 hover:bg-violet-50'
                            : 'bg-white hover:bg-zinc-50/60'}
                        `}
                      >
                        {/* Checkbox */}
                        <td className="pl-4 pr-2 py-2.5 w-8">
                          <Checkbox checked={isChecked} onChange={() => toggleRow(item.item_id)} />
                        </td>

                        {/* FNSKU */}
                        <td className="pl-1 pr-3 py-2.5">
                          <span className="font-mono text-xs text-zinc-700 bg-zinc-100 px-1.5 py-0.5 rounded">
                            {item.fnsku}
                          </span>
                        </td>

                        {/* Title */}
                        <td className="px-3 py-2.5 max-w-[220px]">
                          <p className="text-xs text-zinc-700 line-clamp-2 leading-snug">
                            {item.display_title}
                          </p>
                          {item.asin && (
                            <p className="text-[11px] text-zinc-400 font-mono mt-0.5">{item.asin}</p>
                          )}
                        </td>

                        {/* Planned */}
                        <td className="px-3 py-2.5 text-center">
                          {qtyTag(item.expected_qty, 'planned')}
                        </td>

                        {/* Shipped */}
                        <td className="px-3 py-2.5 text-center">
                          {qtyTag(item.actual_qty, 'shipped')}
                        </td>

                        {/* Remaining */}
                        <td className="px-3 py-2.5 text-center">
                          {qtyTag(remaining, 'remaining')}
                        </td>
                      </motion.tr>
                    );
                  })}
                </AnimatePresence>

                {/* Spacer between groups */}
                {gi < groups.length - 1 && (
                  <tr key={`spacer-${group.shipment_id}`} className="h-1 bg-zinc-50" />
                )}
              </Fragment>
            ))}
          </motion.tbody>
        </table>
      </div>

      {/* ── Summary bar ───────────────────────────────────────────────────── */}
      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ type: 'spring', stiffness: 400, damping: 28 }}
            className="mt-3 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-medium shadow-md shadow-violet-200"
          >
            <Check className="w-[15px] h-[15px] text-violet-200" />
            <span>{selected.size} item{selected.size !== 1 ? 's' : ''} selected</span>
            <span className="mx-1.5 opacity-40">·</span>
            <span className="text-violet-200 text-xs font-normal">
              Enter tracking details in the sidebar →
            </span>
            <button
              onClick={() => setSelected(new Set())}
              className="ml-auto text-violet-200 hover:text-white transition-colors"
            >
              <span className="text-xs">Clear</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
