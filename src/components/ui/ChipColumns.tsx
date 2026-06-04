'use client';

import type { ReactNode } from 'react';
import { cn } from '@/utils/_cn';

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
  /** The chip to render, or null to reserve an empty column so later columns stay aligned. */
  node: ReactNode;
}

/**
 * Right-aligned, fixed-column layout for a desktop table row's identity chips.
 * Each column is a fixed-width, right-justified cell; the trailing cell sits
 * flush with the day-group count (the `-mr-1.5` cancels the trailing chip's
 * 6px `px-1.5` gutter, matching the count's `pr-1` inset).
 *
 * Pass a `null` node to reserve a column's width (keeps the columns to its right
 * aligned when a row lacks that chip — e.g. an order with no platform or no
 * order-id). Omit the column entirely only when no row in the table has it
 * (e.g. the orders queue never has a serial column).
 */
export function ChipColumns({
  columns,
  className,
}: {
  columns: ChipColumn[];
  className?: string;
}) {
  return (
    <div className={cn('flex shrink-0 items-center justify-end gap-0.5 pr-1 -mr-1.5', className)}>
      {columns.map((c) => (
        <div key={c.key} className={cn('flex items-center justify-end', c.width)}>
          {c.node}
        </div>
      ))}
    </div>
  );
}
