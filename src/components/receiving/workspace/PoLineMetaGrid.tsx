'use client';

import type { ReactNode } from 'react';
import { cn } from '@/utils/_cn';
import { META_COL } from '@/components/ui/RowMetaColumns';

/**
 * Fixed-column meta grid for PO line accordion rows.
 * Order: qty | SKU | condition | serial | price (price last — variable width).
 */
export function PoLineMetaGrid({
  qty,
  sku,
  condition,
  serial,
  price,
  indent = META_COL.indentWide,
  className,
}: {
  qty: ReactNode;
  sku?: ReactNode;
  condition: ReactNode;
  serial?: ReactNode;
  price?: ReactNode;
  indent?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'mt-0.5 grid min-w-0 items-center gap-x-1.5 text-eyebrow font-bold uppercase tracking-widest',
        className,
      )}
      style={{
        paddingLeft: indent,
        gridTemplateColumns: [
          META_COL.qtyColWide,
          META_COL.skuCol,
          // Fixed track sized to the longest condition chip ("PARTS" / "L-NEW").
          // A fixed width (not `max-content`) keeps the condition chip starting at
          // the same x on every row so the columns line up vertically; the shared
          // 2.5rem condCol is too narrow (clips "PARTS"), hence the dedicated token.
          META_COL.poCondCol,
          META_COL.serialCol,
          META_COL.priceCol,
        ].join(' '),
      }}
    >
      <span data-col="qty" className="truncate tabular-nums">
        {qty}
      </span>
      <span data-col="sku" className="min-w-0 truncate">
        {sku ?? <span className="text-text-faint/40">—</span>}
      </span>
      <span data-col="condition" className="truncate">
        {condition}
      </span>
      <span data-col="serial" className="flex min-w-0 items-center gap-1 truncate">
        {serial ?? <span className="text-text-faint/40">—</span>}
      </span>
      <span data-col="price" className="flex justify-self-end items-center text-right tabular-nums">
        {price ?? null}
      </span>
    </div>
  );
}
