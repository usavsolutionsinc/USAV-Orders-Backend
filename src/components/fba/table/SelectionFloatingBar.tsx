'use client';

import { motion } from 'framer-motion';
import { Check } from '@/components/Icons';
import type { EnrichedItem } from './types';
import { getPlanId } from './utils';

export function SelectionFloatingBar({
  selectedItems,
  onClear,
  attachmentQty,
}: {
  selectedItems: EnrichedItem[];
  onClear?: () => void;
  attachmentQty?: number;
}) {
  const n = selectedItems.length;
  const planIds = Array.from(new Set(selectedItems.map((i) => getPlanId(i))));
  const allReady = n > 0 && selectedItems.every((i) => i.status === 'ready_to_print');
  const computedQty = selectedItems.reduce((sum, item) => {
    const actual = Number(item.actual_qty || 0);
    const remaining = Math.max(0, Number(item.expected_qty || 0) - actual);
    return sum + (actual > 0 ? actual : remaining);
  }, 0);
  const qty = Number.isFinite(attachmentQty) ? Number(attachmentQty) : computedQty;
  const pairingCopy =
    planIds.length === 1
      ? 'Amazon FBA shipment ID and UPS tracking pair to this plan in the sidebar.'
      : 'Select 1 plan at a time before pairing Amazon FBA shipment ID and UPS tracking.';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.24, ease: [0.25, 1, 0.5, 1] }}
      className={`flex w-full shrink-0 flex-wrap items-center gap-2.5 border-t px-3 py-3 text-sm font-medium text-white sm:px-4 ${
        allReady
          ? 'border-gray-900 bg-gray-950 ring-1 ring-inset ring-violet-400/30'
          : 'border-gray-900 bg-gray-900'
      }`}
    >
      <Check className="h-[15px] w-[15px] shrink-0 text-violet-300" />
      <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-gray-100">
        {n} item{n !== 1 ? 's' : ''}
      </span>
      <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-gray-300">
        {planIds.length} plan{planIds.length !== 1 ? 's' : ''}
      </span>
      <span className={`text-xs font-medium ${allReady ? 'text-violet-100' : 'text-gray-300'}`}>
        {pairingCopy}
      </span>
      {onClear ? (
        <button
          type="button"
          onClick={onClear}
          className="ml-auto rounded-full border border-white/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-gray-200 transition-colors hover:bg-white/10 hover:text-white"
        >
          Clear selection
        </button>
      ) : (
        <span className="ml-auto" />
      )}
      <span className="rounded-full border border-violet-300/40 bg-violet-500/20 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-violet-100">
        Qty {qty}
      </span>
    </motion.div>
  );
}
