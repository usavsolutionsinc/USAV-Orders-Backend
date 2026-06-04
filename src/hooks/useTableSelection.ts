'use client';

import { useEffect, useState } from 'react';
import { onSelectionTotal, selectionEventName } from '@/lib/selection/table-selection';

/**
 * Collect the current selection for a table `scope`.
 *
 * Generalized from {@link useFbaBoardSelection}: instead of a hard-coded FBA
 * event, it listens on `selection:{scope}` (see table-selection.ts) so any
 * table can feed a shared `<SelectionActionBar>`.
 *
 *   const rows = useTableSelection<Order>('orders');
 *   <SelectionActionBar scope="orders" rows={rows} actions={…} />
 *
 * @param scope    Unique key shared by the table and its action bar.
 * @param getKey   Optional row → stable key for de-duping. Defaults to the row
 *                 itself (reference identity).
 */
export function useTableSelection<T>(
  scope: string,
  getKey?: (row: T) => string | number,
): T[] {
  const [rows, setRows] = useState<T[]>([]);

  useEffect(() => {
    const handler = (e: Event) => {
      const incoming = (e as CustomEvent<T[]>).detail;
      const list = Array.isArray(incoming) ? incoming : [];
      if (!getKey) {
        setRows(list);
        return;
      }
      const byKey = new Map<string | number, T>();
      for (const row of list) byKey.set(getKey(row), row);
      setRows(Array.from(byKey.values()));
    };
    const name = selectionEventName(scope);
    window.addEventListener(name, handler);
    return () => window.removeEventListener(name, handler);
  }, [scope, getKey]);

  return rows;
}

/**
 * Track the count of currently-selectable (visible) rows a table publishes via
 * `emitSelectionTotal(scope, …)`. Lets a `<ContextualSelectionBar>` know when
 * everything is selected so its select-all ring can fill. Defaults to `0` until
 * the table broadcasts.
 */
export function useTableSelectionTotal(scope: string): number {
  const [total, setTotal] = useState(0);

  useEffect(() => onSelectionTotal(scope, setTotal), [scope]);

  return total;
}
