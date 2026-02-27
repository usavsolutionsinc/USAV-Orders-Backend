'use client';

import { ShippedTableBase, ShippedTableBaseProps } from '@/components/shipped/ShippedTableBase';

export type UnshippedTableProps = ShippedTableBaseProps;

export function UnshippedTable(props: UnshippedTableProps = {}) {
  return <ShippedTableBase ordersOnly showWeekNavigation={false} {...props} />;
}
