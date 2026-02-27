'use client';

import { ShippedTableBase, ShippedTableBaseProps } from './ShippedTableBase';

export type DashboardShippedTableProps = Omit<ShippedTableBaseProps, 'unshippedOnly'> & {
  unshippedOnly?: boolean;
};

export function DashboardShippedTable({
  unshippedOnly = true,
  ...props
}: DashboardShippedTableProps = {}) {
  return (
    <div className="flex-1 min-w-0 h-full overflow-hidden">
      <ShippedTableBase unshippedOnly={unshippedOnly} showWeekNavigation={false} {...props} />
    </div>
  );
}
