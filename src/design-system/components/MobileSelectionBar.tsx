'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check, X } from '@/components/Icons';
import { cn } from '@/utils/_cn';

/** Mass actions, in declaration order. `danger` tints the icon rose (delete). */
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
  visible?: boolean;
  onToggleAll: () => void;
  onClear: () => void;
  onDismiss?: () => void;
  actions?: MobileSelectionAction[];
}

const spring = { type: 'spring', stiffness: 520, damping: 38 } as const;

// Light design-system palette — matches the repo's white/blur action chrome
// (StickyActionBar) rather than the old dark-glass capsule.
const TONE = {
  iconBtn: 'text-gray-500 hover:bg-gray-100 hover:text-gray-900',
  danger: 'text-rose-600 hover:bg-rose-50',
  saChip: 'bg-gray-50 ring-gray-200 hover:bg-gray-100',
  saRing: 'border-gray-300 bg-white text-gray-700',
  saActive: 'border-blue-600 bg-blue-600 text-white',
  clear: 'text-gray-400 hover:bg-gray-100 hover:text-gray-600',
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

function GlassActions({
  actions,
  onClear,
  onDismiss,
}: {
  actions: MobileSelectionAction[];
  onClear: () => void;
  onDismiss?: () => void;
}) {
  const handleClear = onDismiss ?? onClear;

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
      {/* Hairline divider keeps the dismiss control visually distinct from actions. */}
      <span aria-hidden className="mx-0.5 h-5 w-px bg-gray-200" />
      <motion.button
        onClick={handleClear}
        aria-label={onDismiss ? 'Exit selection mode' : 'Clear selection'}
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

function useBarAnim() {
  const reduce = useReducedMotion();
  return {
    initial: reduce ? { opacity: 0 } : { opacity: 0, y: 100, scale: 0.9 },
    animate: { opacity: 1, y: 0, scale: 1 },
    exit: reduce ? { opacity: 0 } : { opacity: 0, y: 100, scale: 0.9 },
    transition: { type: 'spring', stiffness: 500, damping: 30 },
  } as const;
}

// Light, clean surface that reads as part of the white table chrome (mirrors
// StickyActionBar's `bg-white/90 backdrop-blur border`) instead of dark glass.
const SURFACE_LIGHT = 'bg-white/95 ring-1 ring-gray-200 backdrop-blur-xl';

export function MobileSelectionBar({
  count,
  allSelected,
  visible = count > 0,
  onToggleAll,
  onClear,
  onDismiss,
  actions = [],
}: MobileSelectionBarProps) {
  const anim = useBarAnim();

  return (
    <AnimatePresence>
      {visible && (
        <motion.div {...anim} className="absolute inset-x-0 bottom-0 z-20 px-3 pb-4">
          <div className={cn('relative flex items-center overflow-hidden rounded-full p-1.5 shadow-xl shadow-gray-900/10', SURFACE_LIGHT)}>
            <div className="relative z-10 flex flex-1 items-center gap-2">
              <SelectAll count={count} allSelected={allSelected} onToggleAll={onToggleAll} />
              <span className="text-eyebrow font-bold uppercase tracking-wider text-gray-500">
                selected
              </span>
              <GlassActions actions={actions} onClear={onClear} onDismiss={onDismiss} />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
