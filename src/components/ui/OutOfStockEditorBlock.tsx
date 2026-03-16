'use client';

import { motion } from 'framer-motion';
import { Check } from '@/components/Icons';
import { dmSans } from '@/lib/fonts';

interface OutOfStockEditorBlockProps {
  value: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
  isSaving?: boolean;
  autoFocus?: boolean;
  className?: string;
}

export function OutOfStockEditorBlock({
  value,
  onChange,
  onCancel,
  onSubmit,
  isSaving = false,
  autoFocus = false,
  className = '',
}: OutOfStockEditorBlockProps) {
  return (
    <motion.div
      initial={{ height: 0, opacity: 0, y: -4 }}
      animate={{ height: 'auto', opacity: 1, y: 0 }}
      exit={{ height: 0, opacity: 0, y: -4 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className={`overflow-hidden ${className}`}
    >
      <div className="flex flex-col gap-2 rounded-xl border border-red-200 bg-red-50/40 p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.88),inset_0_0_0_1px_rgba(239,68,68,0.06)]">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="What is out of stock?"
          rows={2}
          className={`w-full resize-none rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-normal leading-5 text-gray-900 shadow-[inset_0_1px_2px_rgba(15,23,42,0.06)] outline-none transition-[border-color,box-shadow] placeholder:text-gray-400 focus:border-red-400 focus:shadow-[inset_0_1px_2px_rgba(15,23,42,0.06),0_0_0_1px_rgba(239,68,68,0.18)] ${dmSans.className}`}
          autoFocus={autoFocus}
        />
        <div className="grid grid-cols-2 gap-2">
          <motion.button
            type="button"
            onClick={onCancel}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.96 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            className="h-8 rounded-lg border border-red-200 bg-white text-[9px] font-black uppercase tracking-wider text-red-700"
          >
            Cancel
          </motion.button>
          <motion.button
            type="button"
            onClick={onSubmit}
            disabled={isSaving}
            whileHover={isSaving ? undefined : { scale: 1.02 }}
            whileTap={isSaving ? undefined : { scale: 0.96 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-red-600 text-[9px] font-black uppercase tracking-wider text-white disabled:opacity-50"
          >
            <Check className="w-3 h-3" />
            {isSaving ? 'Saving' : 'Submit'}
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
}
