'use client';

import { ShippedTableBase, ShippedTableBaseProps } from './ShippedTableBase';

export type RepairShippedTableProps = ShippedTableBaseProps;

export function RepairShippedTable(props: RepairShippedTableProps = {}) {
  return <ShippedTableBase {...props} />;
}
