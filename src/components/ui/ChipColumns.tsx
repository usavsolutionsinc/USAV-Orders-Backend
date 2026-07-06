'use client';

import type { ReactNode } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { cn } from '@/utils/_cn';
import { useIsColumnHidden } from '@/components/ui/table-column-config/TableColumnConfig';
import { framerTransition } from '@/design-system/foundations/motion-framer';
import { useMotionTransition } from '@/design-system/foundations/motion-framer-hooks';

/**
 * Fixed column widths for a table row's identity-chip grid. Each chip type gets
 * a stable width so the same column lines up vertically across every row (PO/
 * order-id under PO/order-id, tracking under tracking, serial under serial),
 * the way a real table does — instead of the old right-packed flex where a
 * column only aligned when its values happened to be the same width.
 *
 * Values are last-4 previews (or a short platform label), so these are sized to
 * fit "icon + 4 mono chars" snugly; the serial keeps the slightly wider box it
 * has always used across tables.
 */
export const CHIP_COL = {
  /** PlatformChip (amazon / ebay / walmart …). */
  platform: 'w-[92px]',
  /** Hash-style id chips: OrderIdChip, PoChip, SkuScanRefChip. */
  id: 'w-[64px]',
  /** TrackingChip / TrackingOrSkuScanChip / FnskuChip. */
  tracking: 'w-[64px]',
  /** SerialChip — same width as the other last-4 columns so the gap between
   *  the tracking and serial values matches every other inter-column gap.
   *  (Render the SerialChip content-width, not its default fixed 84px box, so
   *  it doesn't reserve empty space on the left of this column.) */
  serial: 'w-[64px]',
} as const;

export interface ChipColumn {
  key: string;
  /** Tailwind width utility (use a CHIP_COL value) — fixed so the column aligns row-to-row. */
  width: string;
  /** The chip to render, or null to reserve an empty column (FBA etc.). */
  node: ReactNode;
}

/**
 * Right-aligned, fixed-column layout for a desktop table row's identity chips.
 * Each column is a fixed-width, right-justified cell; the trailing cell sits
 * flush with the day-group count (the `-mr-1.5` cancels the trailing chip's
 * 6px `px-1.5` gutter, matching the count's `pr-1` inset).
 *
 * Staff-hidden columns are removed from layout so visible chips slide flush-right;
 * Framer `layout` animates sibling reflow when toggling in Configure columns.
 */
export function ChipColumns({
  columns,
  className,
}: {
  columns: ChipColumn[];
  className?: string;
}) {
  const isHidden = useIsColumnHidden();
  const layoutTransition = useMotionTransition(framerTransition.chipColumnLayout);
  const presenceTransition = useMotionTransition(framerTransition.dropdownOpen);

  return (
    <LayoutGroup>
      <div
        className={cn(
          'flex shrink-0 items-center justify-end gap-0.5 pr-1 -mr-1.5',
          className,
        )}
      >
        <AnimatePresence initial={false} mode="popLayout">
          {columns.map((c) => {
            if (isHidden(c.key)) return null;
            return (
              <motion.div
                key={c.key}
                layout
                layoutScroll
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                transition={{
                  layout: layoutTransition,
                  opacity: presenceTransition,
                  x: presenceTransition,
                }}
                data-col={c.key}
                className={cn('flex items-center justify-end', c.width)}
              >
                {c.node}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </LayoutGroup>
  );
}
