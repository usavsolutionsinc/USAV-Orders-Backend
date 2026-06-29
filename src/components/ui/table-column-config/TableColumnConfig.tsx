'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useStaffPreferences,
  STAFF_PREFERENCES_QUERY_KEY,
} from '@/hooks/useStaffPreferences';
import type { StaffPreferences } from '@/lib/neon/staff-preferences-queries';
import { tableColumnsFor, type TableColumnSpec, type TableId } from '@/lib/tables/table-columns';

/**
 * Per-staff column configuration for the shared list tables.
 *
 * `TableColumnConfigProvider` wraps a table (by {@link TableId}) and exposes:
 *   • {@link useIsColumnHidden} — a cheap predicate the BASE primitives
 *     (`ChipColumns`, `RowMetaColumns`) call to drop hidden columns. It is a
 *     no-op (`() => false`) when no provider is mounted, so the ~50 historical
 *     importers of those primitives keep their current behavior unchanged.
 *   • {@link useTableColumnConfig} — the full surface the `ColumnConfigButton`
 *     popover uses to list + toggle columns.
 *
 * Single source of truth = the React Query cache for `staff_preferences`. A
 * toggle writes the cache OPTIMISTICALLY once (instant, one re-render) and
 * persists in the background. `hidden` is memoized by CONTENT (sorted join),
 * and we never blindly echo the server response into the cache on success.
 * This combination prevents the previous "echo sets older snapshot" races
 * that made toggles flicker/flash the visible columns back and forth.
 * Selection is contextual to the signed-in staff id (prefs row keyed by org+staff),
 * durable + cross-device.
 */

interface TableColumnConfigValue {
  tableId: TableId;
  columns: TableColumnSpec[];
  hidden: ReadonlySet<string>;
  isHidden: (key: string) => boolean;
  toggle: (key: string) => void;
  reset: () => void;
}

const TableColumnConfigContext = createContext<TableColumnConfigValue | null>(null);

const EMPTY: string[] = [];

/** Stable content key for a hidden list (order-independent, for memo stability). */
function hiddenContentKey(arr: string[]): string {
  return [...arr].sort().join('|');
}

export function TableColumnConfigProvider({
  tableId,
  children,
}: {
  tableId: TableId;
  children: ReactNode;
}) {
  const { prefs } = useStaffPreferences();
  const queryClient = useQueryClient();
  const columns = useMemo(() => tableColumnsFor(tableId), [tableId]);

  // Derive the hidden set straight from the cache, memoized by CONTENT (the
  // sorted join key). We persist canonical (sorted) arrays so client/server
  // roundtrips and concurrent writes never produce a different key for the
  // same membership. This + skipping the success-echo setQueryData keeps
  // toggles from causing a second render pass / flash.
  const hiddenArr = prefs?.tableColumns?.[tableId]?.hidden ?? EMPTY;
  const hiddenKey = hiddenContentKey(hiddenArr);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on content, not the array identity
  const hidden = useMemo(() => new Set(hiddenArr), [hiddenKey]);

  // Persist by writing the cache optimistically, then PUT; roll back on failure.
  // Reads current prefs from the cache at call time (not via closure) so the
  // callback identity is stable across prefs changes.
  //
  // Long-term notes:
  // - We canonicalize (sort) the hidden list so array order never affects the
  //   content key or stored value. Overlapping toggles + prior response echoes
  //   used to install older snapshots and cause visibility to flash back/forth.
  // - On success we intentionally do *not* overwrite with the response body.
  //   The optimistic state is already exactly what the server accepted; echoing
  //   the response can regress a later optimistic from a rapid follow-up toggle.
  //   Only rollback on error. (No second setQueryData = no second render pass.)
  const writeHidden = useCallback(
    async (nextHidden: string[]) => {
      const prev = queryClient.getQueryData<StaffPreferences>(STAFF_PREFERENCES_QUERY_KEY) ?? {};
      // Canonical (sorted) so membership is order-independent.
      const canonical = [...nextHidden].sort();
      // Shallow JSONB merge at `tableColumns`, so carry the whole map forward.
      const nextTableColumns = { ...(prev.tableColumns ?? {}), [tableId]: { hidden: canonical } };
      const next: StaffPreferences = { ...prev, tableColumns: nextTableColumns };
      queryClient.setQueryData(STAFF_PREFERENCES_QUERY_KEY, next);
      try {
        const res = await fetch('/api/staff-preferences', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tableColumns: nextTableColumns }),
        });
        if (!res.ok) throw new Error(`staff-preferences PUT ${res.status}`);
        // Consume body but do NOT setQueryData from it — trust the optimistic.
        await res.json().catch(() => null);
      } catch {
        queryClient.setQueryData(STAFF_PREFERENCES_QUERY_KEY, prev); // rollback
      }
    },
    [queryClient, tableId],
  );

  const toggle = useCallback(
    (key: string) => {
      const cur = queryClient.getQueryData<StaffPreferences>(STAFF_PREFERENCES_QUERY_KEY) ?? {};
      const curHidden = cur.tableColumns?.[tableId]?.hidden ?? [];
      const next = curHidden.includes(key)
        ? curHidden.filter((k) => k !== key)
        : [...curHidden, key];
      void writeHidden(next);
    },
    [queryClient, tableId, writeHidden],
  );

  const reset = useCallback(() => void writeHidden([]), [writeHidden]);

  const isHidden = useCallback((key: string) => hidden.has(key), [hidden]);

  const value = useMemo<TableColumnConfigValue>(
    () => ({ tableId, columns, hidden, isHidden, toggle, reset }),
    [tableId, columns, hidden, isHidden, toggle, reset],
  );

  return (
    <TableColumnConfigContext.Provider value={value}>{children}</TableColumnConfigContext.Provider>
  );
}

/** Full config surface (for the popover). `null` when no provider is mounted. */
export function useTableColumnConfig(): TableColumnConfigValue | null {
  return useContext(TableColumnConfigContext);
}

/**
 * Cheap predicate for the base row primitives. Always safe to call: returns a
 * constant `() => false` when there is no surrounding provider, so unconfigured
 * tables (and every non-table consumer of ChipColumns/RowMetaColumns) behave
 * exactly as before.
 */
const NEVER_HIDDEN = (_key: string) => false;
export function useIsColumnHidden(): (key: string) => boolean {
  const ctx = useContext(TableColumnConfigContext);
  return ctx?.isHidden ?? NEVER_HIDDEN;
}
