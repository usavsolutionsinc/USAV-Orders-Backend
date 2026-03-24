'use client';

import { motion } from 'framer-motion';

export function ViewToggle({
  value,
  onChange,
}: {
  value: 'by_day' | 'by_shipment';
  onChange: (v: 'by_day' | 'by_shipment') => void;
}) {
  return (
    <div className="relative inline-grid min-w-[11rem] grid-cols-2 rounded-xl border border-zinc-200 bg-stone-100/80 p-1 text-[10px] font-black uppercase tracking-[0.14em]">
      <motion.div
        layoutId="fbaPrintViewTogglePill"
        className="pointer-events-none absolute bottom-1 top-1 w-[calc(50%-6px)] rounded-lg border border-sky-200 bg-white shadow-sm shadow-zinc-200/70"
        initial={false}
        animate={{ left: value === 'by_day' ? 4 : 'calc(50% + 2px)' }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      />
      <button
        type="button"
        onClick={() => onChange('by_day')}
        className={`relative z-[1] rounded-lg px-3 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60 ${value === 'by_day' ? 'text-sky-900' : 'text-zinc-500 hover:text-zinc-700'}`}
      >
        By Day
      </button>
      <button
        type="button"
        onClick={() => onChange('by_shipment')}
        className={`relative z-[1] rounded-lg px-3 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60 ${value === 'by_shipment' ? 'text-sky-900' : 'text-zinc-500 hover:text-zinc-700'}`}
      >
        By Shipment
      </button>
    </div>
  );
}
