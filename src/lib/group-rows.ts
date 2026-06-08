/**
 * Group a flat list of rows by a derived key, preserving first-seen order of
 * both the groups and the rows within each group. The left-side mirror of the
 * day-grouping the receiving/queue tables already do — factored out so any
 * table that wants "one summary row per PO / shipment / order, expand to reveal
 * the lines" can reuse it (see {@link CollapsibleGroupRow}).
 *
 * Rows that should never merge (no PO yet, unmatched placeholders) just get a
 * unique key from the caller's keyFn so they land in their own singleton group
 * and render as a plain row.
 */
export interface RowGroup<T> {
  key: string;
  rows: T[];
}

export function groupRowsBy<T>(rows: T[], keyFn: (row: T) => string): RowGroup<T>[] {
  const order: string[] = [];
  const byKey = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyFn(row);
    let bucket = byKey.get(key);
    if (!bucket) {
      bucket = [];
      byKey.set(key, bucket);
      order.push(key);
    }
    bucket.push(row);
  }
  return order.map((key) => ({ key, rows: byKey.get(key)! }));
}
