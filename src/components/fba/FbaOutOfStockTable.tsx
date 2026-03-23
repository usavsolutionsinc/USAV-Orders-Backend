'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, Loader2, Package } from '@/components/Icons';

interface OosItem {
  item_id: number;
  fnsku: string;
  display_title: string;
  expected_qty: number;
  actual_qty: number;
  shipment_id: number;
  shipment_ref: string;
  amazon_shipment_id: string | null;
  due_date: string | null;
}

interface ShipmentGroup {
  shipment_id: number;
  shipment_ref: string;
  amazon_shipment_id: string | null;
  due_date: string | null;
  items: OosItem[];
}

interface Props {
  refreshTrigger?: number | string;
}

const rowVariants = {
  hidden:  { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 400, damping: 28 } },
};

export function FbaOutOfStockTable({ refreshTrigger }: Props) {
  const [items,   setItems]   = useState<OosItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res  = await fetch('/api/fba/print-queue?status=OUT_OF_STOCK');
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed');
      setItems(data.items ?? []);
    } catch (e: any) { setError(e.message ?? 'Network error'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load, refreshTrigger]);

  const groups = useMemo<ShipmentGroup[]>(() => {
    const map = new Map<number, ShipmentGroup>();
    for (const item of items) {
      if (!map.has(item.shipment_id)) {
        map.set(item.shipment_id, {
          shipment_id: item.shipment_id,
          shipment_ref: item.shipment_ref,
          amazon_shipment_id: item.amazon_shipment_id,
          due_date: item.due_date,
          items: [],
        });
      }
      map.get(item.shipment_id)!.items.push(item);
    }
    return Array.from(map.values());
  }, [items]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-zinc-400">
        <Loader2 className="w-7 h-7 animate-spin" />
        <span className="text-sm">Loading out-of-stock items…</span>
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
        <p className="text-sm font-medium text-zinc-400">No out-of-stock items</p>
        <p className="text-xs text-zinc-300 text-center max-w-[240px]">
          When tech marks an FNSKU as unavailable it appears here.
        </p>
      </motion.div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200/80 bg-white shadow-sm">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-zinc-100 bg-zinc-50/80">
            <th className="pl-4 pr-3 py-2.5 text-left text-[11px] font-semibold text-zinc-500 uppercase tracking-wide">FNSKU</th>
            <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-zinc-500 uppercase tracking-wide">Title</th>
            <th className="px-3 py-2.5 text-center text-[11px] font-semibold text-zinc-500 uppercase tracking-wide">Planned</th>
            <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-zinc-500 uppercase tracking-wide">Plan</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <Fragment key={group.shipment_id}>
              <motion.tr
                key={`group-${group.shipment_id}`}
                variants={rowVariants}
                initial="hidden"
                animate="visible"
                className="bg-red-50/60 border-y border-red-100/80"
              >
                <td colSpan={4} className="pl-4 pr-3 py-1.5">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-[11px] h-[11px] text-red-400 shrink-0" />
                    <span className="text-[11px] font-bold text-red-700 tracking-wide uppercase">{group.shipment_ref}</span>
                    {group.amazon_shipment_id && (
                      <span className="text-[11px] text-red-500 font-mono bg-red-100 px-1.5 py-0.5 rounded">{group.amazon_shipment_id}</span>
                    )}
                  </div>
                </td>
              </motion.tr>

              <AnimatePresence>
                {group.items.map((item) => (
                  <motion.tr
                    key={item.item_id}
                    variants={rowVariants}
                    initial="hidden"
                    animate="visible"
                    className="border-b border-zinc-100/80 bg-white hover:bg-red-50/20"
                  >
                    <td className="pl-4 pr-3 py-2.5">
                      <span className="font-mono text-xs text-zinc-700 bg-zinc-100 px-1.5 py-0.5 rounded">{item.fnsku}</span>
                    </td>
                    <td className="px-3 py-2.5 max-w-[220px]">
                      <p className="text-xs text-zinc-700 line-clamp-2 leading-snug">{item.display_title}</p>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className="inline-flex items-center justify-center min-w-[28px] px-1.5 py-0.5 rounded-md border text-xs font-mono font-semibold bg-zinc-100 text-zinc-600 border-zinc-200">
                        {item.expected_qty}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-xs text-zinc-500">{item.shipment_ref}</span>
                    </td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
