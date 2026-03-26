'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { Check, Minus } from '@/components/Icons';
import type { StationTheme } from '@/utils/staff-colors';
import { printQueueTableUi } from '@/utils/staff-colors';

export function PrintTableCheckbox({
  checked,
  indeterminate,
  onChange,
  reducedMotion = false,
  label,
  stationTheme = 'lightblue',
  disabled = false,
  className,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (v: boolean) => void;
  reducedMotion?: boolean;
  label?: string;
  stationTheme?: StationTheme;
  disabled?: boolean;
  /** Merged onto the root button (e.g. larger hit target in table headers). */
  className?: string;
}) {
  const u = printQueueTableUi[stationTheme];

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        if (disabled) return;
        onChange(!checked);
      }}
      role="checkbox"
      aria-checked={indeterminate && !checked ? 'mixed' : checked}
      aria-disabled={disabled}
      aria-label={label ?? (checked ? 'Deselect item' : 'Select item')}
      className={[
        'relative flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] transition-all duration-150 outline-none',
        u.checkboxFocusRing,
        disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer',
        className ?? '',
        checked || indeterminate
          ? u.checkboxChecked
          : ['border-zinc-300 bg-white', u.checkboxIdleHover].join(' '),
      ].join(' ')}
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
