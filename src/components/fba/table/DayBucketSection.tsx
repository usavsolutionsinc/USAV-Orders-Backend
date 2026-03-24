'use client';

import { motion } from 'framer-motion';
import { ChevronDown } from '@/components/Icons';

export function DayBucketHeaderRow({
  label,
  summary,
  collapsed,
  onToggle,
  reducedMotion,
}: {
  label: string;
  summary: string;
  collapsed: boolean;
  onToggle: () => void;
  reducedMotion: boolean;
}) {
  return (
    <tr className="bg-zinc-50/90 border-y border-zinc-200">
      <td colSpan={3} className="p-0">
        <button
          type="button"
          onClick={onToggle}
          className="flex w-full items-center gap-2 px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 sm:px-4"
        >
          <motion.span
            animate={{ rotate: collapsed ? -90 : 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.2 }}
            className="inline-flex text-zinc-400"
          >
            <ChevronDown className="h-4 w-4" />
          </motion.span>
          <span className="text-[11px] font-black uppercase tracking-wide text-zinc-700">{label}</span>
          <span className="text-[10px] font-semibold text-zinc-500">{summary}</span>
        </button>
      </td>
    </tr>
  );
}
