'use client';

import { ShippedTableBase, ShippedTableBaseProps } from './ShippedTableBase';

export type ShippedTableProps = ShippedTableBaseProps;

export function ShippedTable(props: ShippedTableProps = {}) {
  // ShippedTableBase now receives ship_by_date as a derived field sourced
  // from work_assignments.deadline_at, preserving the existing UI contract.
  return <ShippedTableBase {...props} />;
}
