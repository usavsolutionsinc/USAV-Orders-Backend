'use client';

import { ShippedTableBase, ShippedTableBaseProps } from './ShippedTableBase';

export type DashboardShippedTableProps = ShippedTableBaseProps;

export function DashboardShippedTable({
  ordersOnly = true,
  ...props
}: DashboardShippedTableProps = {}) {
  return (
    <div className="flex-1 min-w-0 h-full overflow-hidden">
      <ShippedTableBase ordersOnly={ordersOnly} showWeekNavigation={false} {...props} />
    </div>
  );
}
