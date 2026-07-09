'use client';

import type { ReactNode } from 'react';
import { DateGroupHeader } from '@/components/ui/DateGroupHeader';
import type { RowGroup } from '@/lib/group-rows';
import type { ShippedOrder } from '@/lib/neon/orders-queries';
import { QueueGroupRow } from './QueueGroupRow';

export interface QueueDateSectionProps {
  date: string;
  /** Order groups for this day, in the canonical per-day sort order. */
  groups: RowGroup<ShippedOrder>[];
  isMobile: boolean;
  /** Render a single queue row at the given zebra-stripe index. */
  renderRow: (record: ShippedOrder, stripeIndex: number) => ReactNode;
}

/**
 * One date band: a {@link DateGroupHeader} plus its rows. Singleton orders
 * render as plain rows; multi-product orders fold into a {@link CollapsibleGroupRow}.
 * `stripeIndex` runs across the whole day (group children included) so zebra
 * striping stays consistent.
 */
export function QueueDateSection({ date, groups, isMobile, renderRow }: QueueDateSectionProps) {
  // groups preserve the per-day sort order (groupRowsBy), matching
  // displayedRecords so shift-range select lines up with the view. `stripeIndex`
  // runs across the whole day (group children included) via each group's base.
  let stripeIndex = 0;
  const dayTotal = groups.reduce((sum, g) => sum + g.rows.length, 0);

  return (
    <div className="flex flex-col">
      <DateGroupHeader date={date} total={dayTotal} />
      {groups.map((group) => {
        const baseStripeIndex = stripeIndex;
        stripeIndex += group.rows.length;
        return (
          <QueueGroupRow
            key={`order-${group.key}`}
            group={group}
            baseStripeIndex={baseStripeIndex}
            isMobile={isMobile}
            renderRow={renderRow}
          />
        );
      })}
    </div>
  );
}
