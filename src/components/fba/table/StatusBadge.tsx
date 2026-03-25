'use client';

import type { ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { AlertTriangle, Check, Printer, X } from '@/components/Icons';
import type { ItemStatus } from './types';

const copy: Record<ItemStatus, { label: string; icon: ReactNode; tone: string }> = {
  ready_to_print: {
    label: 'Ready',
    icon: <Check className="h-3 w-3" />,
    tone: 'text-emerald-700',
  },
  needs_print: {
    label: 'Needs Print',
    icon: <Printer className="h-3 w-3" />,
    tone: 'text-violet-800',
  },
  pending_out_of_stock: {
    label: 'Out of Stock',
    icon: <AlertTriangle className="h-3 w-3" />,
    tone: 'text-amber-700',
  },
  pending_qc_fail: {
    label: 'QC Fail',
    icon: <X className="h-3 w-3" />,
    tone: 'text-red-700',
  },
  shipped: {
    label: 'Shipped',
    icon: <Check className="h-3 w-3" />,
    tone: 'text-zinc-500',
  },
};

export function StatusBadge({
  status,
  onBadgeClick,
  needsReason,
  /** When set for `ready_to_print`, shows a themed check icon in a pill (FBA print queue + staff theme). */
  readyPillClassName,
  focusRingClassName = 'focus-visible:ring-2 focus-visible:ring-violet-400/60',
}: {
  status: ItemStatus;
  onBadgeClick?: () => void;
  needsReason?: boolean;
  readyPillClassName?: string;
  focusRingClassName?: string;
}) {
  const reduced = useReducedMotion();
  const cfg = copy[status];

  if (needsReason) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onBadgeClick?.();
        }}
        aria-label="Add reason"
        title="Add reason"
        className="inline-flex h-7 w-7 items-center justify-center text-amber-800 transition-colors hover:text-amber-900"
      >
        <AlertTriangle className="h-3.5 w-3.5" />
      </button>
    );
  }

  const interactive = status === 'ready_to_print' && onBadgeClick;
  const useReadyPill = status === 'ready_to_print' && Boolean(readyPillClassName);

  const inner = useReadyPill ? (
    <span
      className={`inline-flex items-center justify-center ${readyPillClassName}`}
      aria-label={cfg.label}
      title={cfg.label}
    >
      <span aria-hidden>{cfg.icon}</span>
    </span>
  ) : (
    <span
      className={`relative inline-flex h-7 w-7 items-center justify-center ${cfg.tone}`}
      aria-label={cfg.label}
      title={cfg.label}
    >
      <span aria-hidden>{cfg.icon}</span>
      {status === 'needs_print' && !reduced ? (
        <motion.span
          className="absolute h-1.5 w-1.5 translate-x-[6px] translate-y-[-6px] rounded-full bg-violet-600"
          animate={{ scale: [1, 1.35, 1], opacity: [1, 0.45, 1] }}
          transition={{ repeat: Infinity, duration: 1.8, ease: 'easeInOut' }}
        />
      ) : null}
    </span>
  );

  if (interactive) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onBadgeClick?.();
        }}
        aria-label={cfg.label}
        title={cfg.label}
        className={`relative inline-flex min-h-7 items-center justify-center rounded-md outline-none ${focusRingClassName} ${
          useReadyPill ? 'px-0.5 py-0.5' : 'h-7 w-7 rounded-none'
        }`}
      >
        <AnimatePresence mode="wait">
          <motion.span
            key={status}
            initial={reduced ? false : { rotateY: 90, opacity: 0 }}
            animate={reduced ? undefined : { rotateY: 0, opacity: 1 }}
            exit={reduced ? undefined : { rotateY: -90, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="relative inline-block"
            style={{ transformStyle: 'preserve-3d' }}
          >
            {inner}
          </motion.span>
        </AnimatePresence>
      </button>
    );
  }

  return (
    <AnimatePresence mode="wait">
      <motion.span
        key={status}
        initial={reduced ? false : { rotateY: 90, opacity: 0 }}
        animate={reduced ? undefined : { rotateY: 0, opacity: 1 }}
        exit={reduced ? undefined : { rotateY: -90, opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="relative inline-block"
        style={{ transformStyle: 'preserve-3d' }}
      >
        {inner}
      </motion.span>
    </AnimatePresence>
  );
}
