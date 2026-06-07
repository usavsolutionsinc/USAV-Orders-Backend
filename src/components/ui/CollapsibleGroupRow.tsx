'use client';

import { useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown } from '@/components/Icons';
import { framerPresence, framerTransition } from '@/design-system';
import { cn } from '@/utils/_cn';

/**
 * Generic "one summary row, expand to reveal the lines" disclosure — the
 * presentation-only mechanic shared by any table that groups child rows under a
 * single header (receiving lines under a PO, FBA items under a shipment).
 *
 * It owns ONLY the disclosure chrome: a clickable summary bar with a rotating
 * chevron + a count badge, and an animated expandable body. It is deliberately
 * domain-blind — the caller passes a `summary` node built from the same row
 * primitives its child rows use (RowTitle / RowMetaColumns / identity chips) so
 * the collapsed header reads like a real row, and passes the child rows as
 * `children`. That split is what makes it reusable across surfaces: same
 * mechanic, different summary.
 *
 * Header click toggles expansion only — it never selects a row. Selecting a
 * line is the child rows' job (their own onClick).
 */
export function CollapsibleGroupRow({
  summary,
  count,
  children,
  defaultExpanded = false,
  expanded: controlled,
  onToggle,
  countLabel = 'items',
  showChevron = true,
  className,
  index,
}: {
  /** Collapsed-header content (left: title+meta, right: shared chips). */
  summary: ReactNode;
  /**
   * Number of child rows. When provided, renders the trailing count badge.
   * Omit it when the `summary` already carries its own count (e.g. aligned into
   * a chip column) so the badge doesn't push the summary out of alignment.
   */
  count?: number;
  /** The per-line rows, revealed when expanded. */
  children: ReactNode;
  /** Start expanded (uncontrolled). Applied on mount only. */
  defaultExpanded?: boolean;
  /** Controlled open state — pair with `onToggle`. Overrides internal state. */
  expanded?: boolean;
  onToggle?: (next: boolean) => void;
  /** Noun after the count, e.g. "items" (default) / "lines". */
  countLabel?: string;
  /** Render the leading disclosure chevron. Off → the header has no glyph and
   *  its content aligns flush with the sibling rows' left edge. */
  showChevron?: boolean;
  className?: string;
  /** Row index for zebra striping the header, matching the sibling rows. */
  index?: number;
}) {
  const [internal, setInternal] = useState(defaultExpanded);
  const isOpen = controlled ?? internal;

  const toggle = () => {
    const next = !isOpen;
    if (onToggle) onToggle(next);
    else setInternal(next);
  };

  return (
    // When expanded, a darker bottom hairline closes off the revealed child rows
    // as one visually-bounded unit; collapsed, it matches the gray-100 row dividers.
    <div className={cn('border-b', isOpen ? 'border-gray-300' : 'border-gray-100', className)}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={isOpen}
        className={cn(
          'flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-blue-50/50',
          isOpen ? 'bg-blue-50/40' : index != null && index % 2 === 1 ? 'bg-gray-50/40' : 'bg-white',
        )}
      >
        {showChevron ? (
          <ChevronDown
            className={cn(
              'h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform duration-200',
              isOpen && 'rotate-180',
            )}
          />
        ) : null}
        <div className="min-w-0 flex-1">{summary}</div>
        {count != null ? (
          <span className="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-gray-500">
            {count} {countLabel}
          </span>
        ) : null}
      </button>
      <AnimatePresence initial={false}>
        {isOpen ? (
          <motion.div
            key="body"
            {...framerPresence.collapseHeight}
            transition={framerTransition.cardExpansion}
            className="overflow-hidden"
          >
            {/* Indent the child rows past the chevron so the nesting reads as
                "these belong to the row above". Left padding only — the child
                rows' right-aligned chips stay flush with the summary's. */}
            <div className="border-l-2 border-gray-100 bg-gray-50/30 pl-5">{children}</div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
