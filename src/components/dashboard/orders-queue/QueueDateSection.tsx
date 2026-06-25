'use client';

import type { ReactNode } from 'react';
import { CollapsibleGroupRow } from '@/components/ui/CollapsibleGroupRow';
import { DateGroupHeader } from '@/components/ui/DateGroupHeader';
import type { RowGroup } from '@/lib/group-rows';
import type { ShippedOrder } from '@/lib/neon/orders-queries';
import { OrderGroupSummary } from './OrderGroupSummary';

export interface QueueDateSectionProps {
  date: string;
  /** Order groups for this day, in the canonical per-day sort order. */
  groups: RowGroup<ShippedOrder>[];
  isMobile: boolean;
  /** Render a single queue row at the given zebra-stripe index. */
  renderRow: (record: ShippedOrder, stripeIndex: number) => ReactNode;
  /** Day-header style — `band` (default) or the slim `chip` used by the board. */
  dateHeaderVariant?: 'band' | 'chip';
}

/**
 * One date band: a {@link DateGroupHeader} plus its rows. Singleton orders
 * render as plain rows; multi-product orders fold into a {@link CollapsibleGroupRow}.
 * `stripeIndex` runs across the whole day (group children included) so zebra
 * striping stays consistent.
 */
export function QueueDateSection({ date, groups, isMobile, renderRow, dateHeaderVariant = 'band' }: QueueDateSectionProps) {
  // groups preserve the per-day sort order (groupRowsBy), matching
  // displayedRecords so shift-range select lines up with the view.
  let stripeIndex = 0;
  const dayTotal = groups.reduce((sum, g) => sum + g.rows.length, 0);

  return (
    <div className="flex flex-col">
      <DateGroupHeader date={date} total={dayTotal} variant={dateHeaderVariant} />
      {groups.map((group) => {
        // Singleton order → a plain row (the common case).
        if (group.rows.length === 1) {
          const node = renderRow(group.rows[0], stripeIndex);
          stripeIndex += 1;
          return node;
        }
        // Multi-product order → one collapsed header, expand to reveal each
        // product line. Different products, same order#.
        const headerIndex = stripeIndex;
        const children = group.rows.map((row) => {
          const node = renderRow(row, stripeIndex);
          stripeIndex += 1;
          return node;
        });
        return (
          <CollapsibleGroupRow
            key={`order-${group.key}`}
            index={headerIndex}
            showChevron={false}
            summary={<OrderGroupSummary rows={group.rows} isMobile={isMobile} />}
          >
            {children}
          </CollapsibleGroupRow>
        );
      })}
    </div>
  );
}
