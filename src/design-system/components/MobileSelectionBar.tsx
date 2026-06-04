'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check, Share2, Star, DollarSign, X } from '@/components/Icons';
import { cn } from '@/utils/_cn';

/** Mass actions, in the order named: share · highlight · quote. */
export type MobileSelectionAction = {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: 'default' | 'danger';
  onTap?: () => void;
};

interface MobileSelectionBarProps {
  count: number;
  total: number;
  allSelected: boolean;
  onToggleAll: () => void;
  onClear: () => void;
  actions?: MobileSelectionAction[];
}

const spring = { type: 'spring', stiffness: 520, damping: 38 } as const;

const TONE = {
  iconBtn: 'text-white hover:bg-white/15',
  danger: 'text-rose-300 hover:bg-rose-500/20',
  saChip: 'text-white bg-white/10 ring-white/15 hover:bg-white/[0.18]',
  saRing: 'border-white/50 text-white/80',
  saActive: 'border-white bg-white text-navy-900',
  clear: 'text-white/60 hover:bg-white/10 hover:text-white',
};

/**
 * A vertical sliding digit counter that animates whenever the count changes.
 * Uses mode="popLayout" to keep the digits in the same spot during transition.
 */
function AnimatedCounter({ value }: { value: number }) {
  return (
    <div className="relative h-4 overflow-hidden">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={value}
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -20, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 500, damping: 35 }}
          className="flex h-4 items-center justify-center text-[10px] font-black tabular-nums"
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}

function SelectAll({ count, allSelected, onToggleAll }: { count: number; allSelected: boolean; onToggleAll: () => void }) {
  return (
    <motion.button
      onClick={onToggleAll}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      className={cn('flex shrink-0 items-center rounded-full p-0.5 ring-1 transition-colors', TONE.saChip)}
      aria-label={allSelected ? 'Deselect all' : 'Select all'}
      title={allSelected ? 'Deselect all' : 'Select all'}
    >
      <span className={cn('flex h-7 w-7 items-center justify-center rounded-full border transition-colors duration-150', allSelected ? TONE.saActive : TONE.saRing)}>
        {allSelected ? (
          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={spring}>
            <Check className="h-3.5 w-3.5" />
          </motion.div>
        ) : (
          <AnimatedCounter value={count} />
        )}
      </span>
    </motion.button>
  );
}

function GlassActions({ actions, onClear }: { actions: MobileSelectionAction[]; onClear: () => void }) {
  return (
    <motion.div
      variants={{
        visible: { transition: { staggerChildren: 0.05, delayChildren: 0.05 } },
      }}
      initial="hidden"
      animate="visible"
      className="ml-auto flex items-center gap-0.5"
    >
      {actions.map((a) => {
        const Icon = a.icon;
        return (
          <motion.button
            key={a.key}
            title={a.label}
            aria-label={a.label}
            onClick={a.onTap}
            variants={{
              hidden: { opacity: 0, scale: 0.8 },
              visible: { opacity: 1, scale: 1 },
            }}
            whileHover={{ scale: 1.15 }}
            whileTap={{ scale: 0.85 }}
            className={cn('flex h-9 w-9 items-center justify-center rounded-full transition-colors', a.tone === 'danger' ? TONE.danger : TONE.iconBtn)}
          >
            <Icon className="h-[18px] w-[18px]" />
          </motion.button>
        );
      })}
      <motion.button
        onClick={onClear}
        aria-label="Clear selection"
        variants={{
          hidden: { opacity: 0, scale: 0.8 },
          visible: { opacity: 1, scale: 1 },
        }}
        whileHover={{ scale: 1.15 }}
        whileTap={{ scale: 0.85 }}
        className={cn('flex h-9 w-9 items-center justify-center rounded-full transition-colors', TONE.clear)}
      >
        <X className="h-4 w-4" />
      </motion.button>
    </motion.div>
  );
}

function AuroraSweep() {
  const reduce = useReducedMotion();
  if (reduce) return null;
  return (
    <>
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 z-[1] w-4/5"
        initial={{ x: '-55%' }}
        animate={{ x: '185%' }}
        transition={{ duration: 5.4, ease: 'easeInOut', repeat: Infinity, repeatDelay: 0.2 }}
        style={{
          background:
            'linear-gradient(90deg, transparent, rgba(167, 139, 250, 0.45), rgba(34, 211, 238, 0.45), rgba(52, 211, 153, 0.4), transparent)',
          skewX: '-12deg',
          filter: 'blur(24px)',
        }}
      />
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 z-[1] w-3/4"
        initial={{ x: '180%' }}
        animate={{ x: '-60%' }}
        transition={{ duration: 7.2, ease: 'easeInOut', repeat: Infinity, repeatDelay: 0.1 }}
        style={{
          background:
            'linear-gradient(90deg, transparent, rgba(236, 72, 153, 0.35), rgba(99, 102, 241, 0.4), transparent)',
          skewX: '-12deg',
          filter: 'blur(28px)',
        }}
      />
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-[1]"
        initial={{ opacity: 0.3 }}
        animate={{ opacity: [0.3, 0.55, 0.3] }}
        transition={{ duration: 6, ease: 'easeInOut', repeat: Infinity }}
        style={{
          background:
            'linear-gradient(110deg, rgba(99, 102, 241, 0.25), rgba(34, 211, 238, 0.2), rgba(52, 211, 153, 0.2))',
          filter: 'blur(35px)',
        }}
      />
    </>
  );
}

function useBarAnim() {
  const reduce = useReducedMotion();
  return {
    initial: reduce ? { opacity: 0 } : { opacity: 0, y: 100, scale: 0.9 },
    animate: { opacity: 1, y: 0, scale: 1 },
    exit: reduce ? { opacity: 0 } : { opacity: 0, y: 100, scale: 0.9 },
    transition: { type: 'spring', stiffness: 500, damping: 30 },
  } as const;
}

const SURFACE_FROSTED = 'bg-gray-950/55 ring-1 ring-white/20 backdrop-blur-3xl backdrop-saturate-200';

export function MobileSelectionBar({
  count,
  allSelected,
  onToggleAll,
  onClear,
  actions = [],
}: MobileSelectionBarProps) {
  const anim = useBarAnim();

  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.div {...anim} className="absolute inset-x-0 bottom-0 z-20 px-3 pb-4">
          <div className={cn('relative flex items-center overflow-hidden rounded-full p-1.5 shadow-2xl shadow-black/60', SURFACE_FROSTED)}>
            <span aria-hidden className="pointer-events-none absolute inset-0 bg-white/[0.05]" />
            <span aria-hidden className="pointer-events-none absolute inset-0 rounded-full ring-1 ring-inset ring-white/10" />
            <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-2/3 bg-gradient-to-b from-white/20 to-transparent" />
            <AuroraSweep />
            <div className="relative z-10 flex flex-1 items-center gap-1.5">
              <SelectAll count={count} allSelected={allSelected} onToggleAll={onToggleAll} />
              <GlassActions actions={actions} onClear={onClear} />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
