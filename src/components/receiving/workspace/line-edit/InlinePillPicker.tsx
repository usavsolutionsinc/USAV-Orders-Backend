'use client';

/**
 * Collapse-to-active pill selector. Collapsed, it shows only the current value
 * as a pill; open, it shows the full option set inline so the operator picks
 * without a floating dropdown.
 *
 * Open/closed is now *parent-controlled* (`open` + `onOpenChange`) so the
 * carton bar can orchestrate one picker at a time: opening one unrenders the
 * trailing chip cluster, the options fill the freed row, and selecting (or
 * dismissing) collapses back and rerenders the chips. The same primitive backs
 * the platform, receiving-type, AND urgency pills so all three read identically.
 *
 * Generic over the option set; per-option tone overrides keep e.g. the platform
 * "Unfound" pill amber while everything else uses the default blue active tone.
 */

import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

export interface InlinePillOption {
  value: string;
  label: string;
  /** Active tone classes (default: blue). */
  activeClass?: string;
  /** Inactive tone classes (default: gray). */
  inactiveClass?: string;
  title?: string;
}

const PILL_BASE =
  'inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-full border px-3 text-micro font-black uppercase tracking-wide transition-colors';
const DEFAULT_ACTIVE = 'border-blue-600 bg-blue-600 text-white';
// Slightly translucent at rest so inactive pills sit INTO the frosted card
// instead of stamping opaque tiles onto it; hover restores a solid wash.
const DEFAULT_INACTIVE = 'border-border-soft bg-surface-card/70 text-text-muted hover:border-border-default hover:bg-surface-hover';

export function InlinePillPicker({
  ariaLabel,
  options,
  value,
  onSelect,
  open,
  onOpenChange,
  disabled = false,
  placeholder = '—',
  collapsedLabel,
  collapsedClass,
}: {
  ariaLabel: string;
  options: InlinePillOption[];
  value: string;
  onSelect: (next: string) => void;
  /** Parent-owned open state (one picker open at a time across the bar). */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled?: boolean;
  /** Collapsed label when nothing is selected yet. */
  placeholder?: string;
  /**
   * Override the collapsed pill's label/tone independently of the option list.
   * Lets the urgency pill show its *effective* tier at rest (e.g. derived
   * "Medium") while the expanded list still offers a literal "Auto" option.
   */
  collapsedLabel?: string;
  collapsedClass?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  // Dismiss on click-away / Escape. Only the open picker is mounted in its open
  // state (the parent hides the siblings), so a single listener is enough.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOpenChange(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onOpenChange]);

  const active = options.find((o) => o.value === value) ?? null;

  return (
    <div
      ref={ref}
      className={`flex items-center ${open ? 'min-w-0 flex-1' : 'shrink-0'} ${
        disabled ? 'pointer-events-none opacity-50' : ''
      }`}
    >
      <AnimatePresence initial={false} mode="wait">
        {open ? (
          <motion.div
            key="expanded"
            role="radiogroup"
            aria-label={ariaLabel}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.1 }}
            style={{ originX: 0 }}
            className="flex min-w-0 flex-1 items-center gap-1.5"
          >
            <span className="mr-0.5 shrink-0 select-none text-eyebrow font-black uppercase tracking-widest text-text-faint">
              {ariaLabel}
            </span>
            <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-1.5 overflow-x-auto scrollbar-hide">
              {options.map((opt, i) => {
              const isActive = opt.value === value;
              return (
                <motion.button
                  key={opt.value || '__none__'}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  title={opt.title}
                  // Cascade in from the left so the set visibly expands
                  // left → right out of the pill's origin.
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.14, delay: i * 0.025, ease: 'easeOut' }}
                  onClick={() => {
                    onSelect(opt.value);
                    onOpenChange(false);
                  }}
                  className={`${PILL_BASE} ${
                    isActive ? opt.activeClass ?? DEFAULT_ACTIVE : opt.inactiveClass ?? DEFAULT_INACTIVE
                  }`}
                >
                  {opt.label}
                </motion.button>
              );
            })}
            </div>
          </motion.div>
        ) : (
          <motion.button
            key="collapsed"
            type="button"
            aria-haspopup="true"
            aria-label={`${ariaLabel}: ${collapsedLabel ?? active?.label ?? placeholder} — click to change`}
            title={`${ariaLabel}: ${collapsedLabel ?? active?.label ?? placeholder} — click to change`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.1 }}
            onClick={() => onOpenChange(true)}
            className={`${PILL_BASE} ${
              collapsedClass ?? (active ? active.activeClass ?? DEFAULT_ACTIVE : DEFAULT_INACTIVE)
            }`}
          >
            {collapsedLabel ?? active?.label ?? placeholder}
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

export default InlinePillPicker;
