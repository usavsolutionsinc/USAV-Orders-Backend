'use client';

import { motion } from 'framer-motion';
import { Check } from '@/components/Icons';
import type { EnrichedItem } from './types';

export function SelectionFloatingBar({
  selectedItems,
  onClear,
}: {
  selectedItems: EnrichedItem[];
  onClear: () => void;
}) {
  const n = selectedItems.length;
  const shipmentIds = Array.from(new Set(selectedItems.map((i) => i.shipment_id)));
  const allReady = n > 0 && selectedItems.every((i) => i.status === 'ready_to_print');

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.24, ease: [0.25, 1, 0.5, 1] }}
      className={`flex w-full shrink-0 flex-wrap items-center gap-2.5 border-t px-3 py-3 text-sm font-medium text-white sm:px-4 ${
        allReady
          ? 'border-zinc-900 bg-zinc-950 ring-1 ring-inset ring-emerald-400/25'
          : 'border-zinc-900 bg-zinc-900'
      }`}
    >
      <Check className="h-[15px] w-[15px] shrink-0 text-emerald-300" />
      <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-zinc-100">
        {n} item{n !== 1 ? 's' : ''}
      </span>
      <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-zinc-300">
        {shipmentIds.length} shipment{shipmentIds.length !== 1 ? 's' : ''}
      </span>
      <span className={`text-xs font-medium ${allReady ? 'text-emerald-100' : 'text-zinc-300'}`}>
        Complete Amazon shipment ID and UPS tracking in the sidebar before printing.
      </span>
      <button
        type="button"
        onClick={onClear}
        className="ml-auto rounded-full border border-white/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-zinc-200 transition-colors hover:bg-white/10 hover:text-white"
      >
        Clear selection
      </button>
    </motion.div>
  );
}
