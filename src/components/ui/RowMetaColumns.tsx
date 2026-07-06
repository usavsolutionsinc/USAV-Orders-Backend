'use client';

import type { ReactNode } from 'react';
import { cn } from '@/utils/_cn';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { useIsColumnHidden } from '@/components/ui/table-column-config/TableColumnConfig';

/**
 * Dashboard / queue / receiving order-row title + meta subrow.
 *
 * The row's identity chips already lay out as fixed virtual columns on the right
 * via `ChipColumns` / `CHIP_COL` (see ui/ChipColumns). This is the LEFT-side
 * counterpart: the product title and the "qty · condition · rest" subrow beneath
 * it, factored out of the five tables that used to hand-roll (and drift) it —
 * DashboardShippedTable, OrdersQueueTable, TechTable, PackerTable,
 * ReceivingLinesTable.
 *
 * Layout contract:
 *   • The dot sits centered inside a fixed `dotTrack` (w-5 / w-7) so the title
 *     text begins at a known x.
 *   • RowMetaColumns indents by that SAME width (`indent`) so the subrow lines up
 *     under the title text — NOT under the dot — and then locks qty | condition |
 *     rest into FIXED virtual columns (a CSS grid), the left-side mirror of
 *     ChipColumns. Because the qty track is a fixed width, the condition starts at
 *     the same x on every row whether qty is "1" or "100/100" — so the columns
 *     never drift the way a content-width flow does.
 *
 * Typography matches the /design-demo "good example":
 *     title → text-[13px] font-bold text-text-default   (text-[12px] when `small`)
 *     meta  → text-[9px] font-bold uppercase tracking-widest text-text-soft
 *
 * INVARIANTS:
 *   • RowMetaColumns `indent` MUST equal the RowTitle `dotTrack` width
 *     (w-5 → 1.25rem, w-7 → 1.75rem).
 *   • A wide qty count ("0/1"…"100/100", receiving) needs the wider `qtyCol`
 *     (`qtyColWide`) so it doesn't clip — pair it with `indentWide`/`dotTrackWide`.
 *   Keep META_COL the single source for these paired widths.
 *
 * (Meta fields are low visual weight; chip reflow when toggling Configure columns
 * is animated in ChipColumns.)
 */
export const META_COL = {
  /** Default dot-track width AND meta indent — single-token counts (orders/shipped/tech/packer). */
  indent: '1.25rem',
  dotTrack: 'w-5',
  /** Wider variant for received/expected counts ("0/1" … "100/100") — receiving. */
  indentWide: '1.75rem',
  dotTrackWide: 'w-7',
  /** Fixed qty-column track — single/low counts ("1"…"999"). */
  qtyCol: '0.75rem',
  /** Fixed qty-column track — received/expected counts ("0/1"…"100/100"). */
  qtyColWide: '2.15rem',
  /** Fixed condition-column track — NEW / USED / N/A. */
  condCol: '2.5rem',
} as const;

export function RowTitle({
  dot,
  dotTitle,
  dotTooltip,
  title,
  dotTrack = META_COL.dotTrack,
  /** Smaller title (text-[12px]) instead of the default text-[13px]. */
  small,
  /** Optional leading slot rendered before the dot (e.g. a select-mode checkbox). */
  leading,
  titleClassName,
}: {
  /** Tailwind background class for the status dot. */
  dot: string;
  /** Hover/a11y label for the dot. */
  dotTitle?: string;
  /** When true, render `dotTitle` via the styled HoverTooltip instead of the native title attr. */
  dotTooltip?: boolean;
  title: ReactNode;
  dotTrack?: string;
  small?: boolean;
  leading?: ReactNode;
  titleClassName?: string;
}) {
  return (
    <div className="flex min-w-0 items-center">
      {leading != null ? (
        <span className="mr-2 flex shrink-0 items-center">{leading}</span>
      ) : null}
      {/* Dot centered inside the dot-track so the title text starts at a known x. */}
      <span className={cn('flex shrink-0 items-center justify-center', dotTrack)}>
        {dotTooltip && dotTitle ? (
          <HoverTooltip label={dotTitle} className="flex items-center">
            <span className={cn('h-2 w-2 rounded-full', dot)} />
          </HoverTooltip>
        ) : (
          /* ds-allow-title */
          <span className={cn('h-2 w-2 rounded-full', dot)} title={dotTitle} />
        )}
      </span>
      <div
        className={cn(
          'truncate font-bold text-text-default',
          small ? 'text-label' : 'text-[13px]',
          titleClassName,
        )}
      >
        {title}
      </div>
    </div>
  );
}

export function RowMetaColumns({
  qty,
  condition,
  rest,
  indent = META_COL.indent,
  qtyCol = META_COL.qtyCol,
  condCol = META_COL.condCol,
  className,
}: {
  qty: ReactNode;
  condition: ReactNode;
  /** Trailing slot after condition: staff initials, days-late / out-of-stock, delivery-state icon… */
  rest?: ReactNode;
  /** Left indent — pass the matching RowTitle `dotTrack` width so qty aligns under the title. */
  indent?: string;
  /** Fixed qty-column width — pass `META_COL.qtyColWide` for wide received/expected counts. */
  qtyCol?: string;
  /** Fixed condition-column width. */
  condCol?: string;
  className?: string;
}) {
  // Per-staff hidden slots (no-op outside a TableColumnConfigProvider). A hidden
  // slot drops its grid track + cell; chip side uses the same drop + layout animation.
  const isHidden = useIsColumnHidden();
  const showQty = !isHidden('qty');
  const showCondition = !isHidden('condition');
  const showRest = rest != null && !isHidden('rest');

  // Build the virtual-column template from only the visible slots.
  const tracks: string[] = [];
  if (showQty) tracks.push(qtyCol);
  if (showCondition) tracks.push(condCol);
  if (showRest) tracks.push('minmax(0,auto)');

  if (tracks.length === 0) return null;

  return (
    <div
      className={cn(
        'mt-0.5 grid min-w-0 items-center gap-x-1 text-eyebrow font-bold uppercase tracking-widest text-text-soft',
        className,
      )}
      style={{ paddingLeft: indent, gridTemplateColumns: tracks.join(' ') }}
    >
      {showQty ? <span data-col="qty" className="truncate">{qty}</span> : null}
      {showCondition ? <span data-col="condition" className="truncate">{condition}</span> : null}
      {showRest ? (
        <span data-col="rest" className="flex min-w-0 items-center gap-2 truncate">{rest}</span>
      ) : null}
    </div>
  );
}
