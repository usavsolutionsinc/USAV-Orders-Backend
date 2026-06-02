'use client';

import type { ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  StickyActionBar,
  type StickyActionMenuItem,
  type StickyActionTone,
} from './StickyActionBar';
import { emitToggleAll } from '@/lib/selection/table-selection';

interface SelectionActionBarProps<T> {
  /** Must match the `scope` passed to {@link useTableSelection} and the table. */
  scope: string;
  /** Selected rows, from `useTableSelection(scope)`. */
  rows: T[];
  /** Primary CTA label, e.g. "Print labels". */
  primaryLabel: string;
  /** Primary CTA handler — receives the selected rows. */
  onPrimary: (rows: T[]) => void;
  primaryIcon?: ReactNode;
  primaryTone?: StickyActionTone;
  /** Override the primary tone with explicit Tailwind classes (e.g. station theme). */
  primaryToneClasses?: { bg: string; hover: string };
  /** Extra bulk actions surfaced in the split-button menu. */
  actions?: Array<{
    label: string;
    onClick: (rows: T[]) => void;
    icon?: ReactNode;
    disabled?: boolean;
    /** Tooltip (e.g. why the item is disabled). */
    title?: string;
  }>;
  /** Custom leading content; defaults to "N selected". */
  leading?: ReactNode;
  /** Disable the primary CTA (e.g. while a mutation is in flight). */
  primaryDisabled?: boolean;
  /** Tooltip for the primary CTA (e.g. why it's disabled). */
  primaryTitle?: string;
  primaryLoading?: boolean;
}

/**
 * Floating bulk-action bar for the generic "Select → pick rows → act" flow.
 *
 * A thin wrapper over {@link StickyActionBar} (the canonical action chrome)
 * that auto-shows when `rows` is non-empty, renders a selection count, and
 * wires "Clear" to the shared toggle-all event so the table deselects.
 *
 * Render it inside a `relative` container (the table region) — it pins to the
 * bottom of that region, mirroring the FBA board's combine bar.
 */
export function SelectionActionBar<T>({
  scope,
  rows,
  primaryLabel,
  onPrimary,
  primaryIcon,
  primaryTone = 'blue',
  primaryToneClasses,
  actions,
  leading,
  primaryDisabled,
  primaryTitle,
  primaryLoading,
}: SelectionActionBarProps<T>) {
  const prefersReducedMotion = useReducedMotion();
  const count = rows.length;

  const menu: StickyActionMenuItem[] | undefined = actions?.map((a) => ({
    label: a.label,
    icon: a.icon,
    disabled: a.disabled,
    title: a.title,
    onClick: () => a.onClick(rows),
  }));

  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.div
          key={`selection-bar:${scope}`}
          initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 16 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          className="absolute inset-x-0 bottom-0 z-20"
        >
          <StickyActionBar
            maxWidth="max-w-none"
            leading={
              leading ?? (
                <span className="text-micro font-black uppercase tracking-widest tabular-nums text-gray-500">
                  {count} selected
                </span>
              )
            }
            secondary={{
              label: 'Clear',
              onClick: () => emitToggleAll(scope, 'none'),
            }}
            primary={{
              label: primaryLabel,
              onClick: () => onPrimary(rows),
              icon: primaryIcon,
              tone: primaryTone,
              toneClasses: primaryToneClasses,
              disabled: primaryDisabled,
              title: primaryTitle,
              isLoading: primaryLoading,
              menu,
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default SelectionActionBar;
