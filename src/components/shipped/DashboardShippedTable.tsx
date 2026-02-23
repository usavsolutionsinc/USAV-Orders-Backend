'use client';

import { ShippedTableBase, ShippedTableBaseProps } from './ShippedTableBase';

export type DashboardShippedTableProps = Omit<ShippedTableBaseProps, 'unshippedOnly'> & {
  unshippedOnly?: boolean;
};

export function DashboardShippedTable({
  unshippedOnly = true,
  ...props
}: DashboardShippedTableProps = {}) {
  return <ShippedTableBase unshippedOnly={unshippedOnly} showWeekNavigation={false} {...props} />;
}
