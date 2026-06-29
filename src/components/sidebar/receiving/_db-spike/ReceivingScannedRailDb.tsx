'use client';

/**
 * TanStack DB SPIKE rail — the `view=scanned` feed rendered from a LIVE QUERY
 * over {@link receivingScannedCollection} instead of a React-Query cache + event
 * bus. Optimistic writes to the collection appear here synchronously (no
 * `receiving-line-updated` dispatch, no `invalidateReceivingFeeds` refetch).
 *
 * Deliberately a minimal list (not wrapped in SidebarRailShell) — the shell
 * fetches internally, which would defeat the point. This proves the live/optimistic
 * read path; the production graduation would teach SidebarRailShell to accept a
 * live-query row source. Rendered ONLY behind `?railEngine=db`.
 */

import { useMemo } from 'react';
import { useLiveQuery } from '@tanstack/react-db';
import { Loader2 } from '@/components/Icons';
import { dispatchSelectLine } from '@/components/station/receiving-lines-table-helpers';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';
import { receivingScannedCollection } from './receivingDbCollection';

function recencyMs(row: ReceivingLineRow): number {
  for (const c of [row.received_at, row.last_activity_at, row.scanned_at, row.created_at]) {
    if (!c) continue;
    const t = Date.parse(c);
    if (!Number.isNaN(t)) return t;
  }
  return 0;
}

export function ReceivingScannedRailDb({
  selectedLineId,
  filterText = '',
}: {
  selectedLineId: number | null;
  filterText?: string;
}) {
  // The live query: row-set is a query over the collection. Membership/sort are
  // client-side here; data re-renders on any optimistic write or sync reconcile.
  const { data, isLoading } = useLiveQuery((q) => q.from({ line: receivingScannedCollection }));

  const q = filterText.trim().toLowerCase();
  const rows = useMemo(() => {
    const arr = (data ?? []) as unknown as ReceivingLineRow[];
    return arr
      .filter(
        (r) =>
          !q ||
          (r.item_name ?? '').toLowerCase().includes(q) ||
          (r.sku ?? '').toLowerCase().includes(q) ||
          (r.tracking_number ?? '').toLowerCase().includes(q),
      )
      .slice()
      .sort((a, b) => recencyMs(b) - recencyMs(a));
  }, [data, q]);

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-eyebrow font-black uppercase tracking-widest text-gray-500">
          Scanned · {rows.length}
        </span>
        <span className="rounded bg-violet-50 px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-widest text-violet-700 ring-1 ring-inset ring-violet-200">
          DB spike
        </span>
      </div>

      {isLoading && rows.length === 0 ? (
        <p className="flex items-center justify-center gap-2 py-6 text-xs text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </p>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center text-xs text-gray-500">
          No scanned cartons.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {rows.map((row) => {
            const selected = row.id === selectedLineId;
            const title = row.item_name || row.sku || `Line #${row.id}`;
            const expected = row.quantity_expected;
            return (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => dispatchSelectLine(row)}
                  className={`ds-raw-button flex w-full flex-col items-start px-3 py-1.5 text-left transition-colors ${
                    selected
                      ? 'bg-blue-50 ring-1 ring-inset ring-blue-400'
                      : 'hover:bg-gray-50'
                  }`}
                >
                  <span className="truncate text-caption font-bold text-gray-900">{title}</span>
                  <span className="text-eyebrow font-semibold uppercase tracking-widest text-blue-600">
                    {expected ?? 1}/{expected ?? '?'}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default ReceivingScannedRailDb;
