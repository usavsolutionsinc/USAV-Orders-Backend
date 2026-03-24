'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { Check, Minus } from '@/components/Icons';

export function PrintTableCheckbox({
  checked,
  indeterminate,
  onChange,
  reducedMotion = false,
  label,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (v: boolean) => void;
  reducedMotion?: boolean;
  label?: string;
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
      aria-label={label ?? (checked ? 'Deselect item' : 'Select item')}
      className={`
        relative flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] transition-all duration-150 outline-none
        focus-visible:ring-2 focus-visible:ring-sky-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white
        ${checked || indeterminate
          ? 'border-sky-700 bg-sky-700'
          : 'border-zinc-300 bg-white hover:border-sky-400 hover:bg-sky-50'}
      `}
    >
      <AnimatePresence initial={false} mode="wait">
        {indeterminate && !checked ? (
          <motion.span
            key="minus"
            initial={reducedMotion ? false : { scale: 0 }}
            animate={reducedMotion ? undefined : { scale: 1 }}
            exit={reducedMotion ? undefined : { scale: 0 }}
            className="absolute inset-0 flex items-center justify-center"
          >
            <Minus className="w-[10px] h-[10px] text-white stroke-[3]" />
          </motion.span>
        ) : checked ? (
          <motion.span
            key="check"
            initial={reducedMotion ? false : { scale: 0 }}
            animate={reducedMotion ? undefined : { scale: 1 }}
            exit={reducedMotion ? undefined : { scale: 0 }}
            className="absolute inset-0 flex items-center justify-center"
          >
            <Check className="w-[10px] h-[10px] text-white stroke-[3]" />
          </motion.span>
        ) : null}
      </AnimatePresence>
    </button>
  );
}
