'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { getStaffName } from '@/utils/staff';
import { getStaffThemeById, stationThemeColors } from '@/utils/staff-colors';
import {
  dispatchSelectLine,
  type ReceivingLineRow,
} from '@/components/station/ReceivingLinesTable';

interface ApiResponse {
  success: boolean;
  receiving_lines: ReceivingLineRow[];
  total: number;
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return `${Math.floor(d / 7)}w`;
}

function getStatusDot(status: string | null | undefined): string {
  const v = String(status || '').trim().toUpperCase();
  if (v === 'EXPECTED') return 'bg-amber-400';
  if (v === 'ARRIVED' || v === 'MATCHED') return 'bg-blue-500';
  if (v === 'UNBOXED') return 'bg-indigo-500';
  if (v === 'AWAITING_TEST' || v === 'IN_TEST') return 'bg-violet-500';
  if (v === 'PASSED' || v === 'DONE') return 'bg-emerald-500';
  if (v.startsWith('FAILED') || v === 'SCRAP' || v === 'RTV') return 'bg-rose-500';
  return 'bg-gray-400';
}

interface Props {
  /** Currently selected line id — gets a highlight ring so the rail mirrors the workspace. */
  selectedLineId: number | null;
  /** Cap on rendered rows; the underlying query still pulls the full table page. */
  limit?: number;
}

/**
 * Sidebar "Recent activity" rail — shares the exact data source the History
 * table uses (`view=all`, queryKey `['receiving-lines-table', 'all']`) so
 * both surfaces stay in lockstep without a second fetch. Renders the first
 * `limit` rows of the same dataset; clicking a row dispatches
 * `receiving-select-line` → opens it in the workspace.
 *
 * Listens to `receiving-line-updated` for optimistic patches of an existing
 * row, plus `usav-refresh-data` / `receiving-entry-added` for invalidation
 * so it acts as an ambient feed while the operator works.
 */
export function ReceivingRecentRail({ selectedLineId, limit = 10 }: Props) {
  const queryClient = useQueryClient();
  // Match `ReceivingLinesTable`'s queryKey + queryFn exactly so react-query
  // dedupes the fetch — the rail rides on the table's cache.
  const queryKey = useMemo(() => ['receiving-lines-table', 'all'] as const, []);

  const { data, isLoading } = useQuery<ApiResponse>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '500', offset: '0' });
      params.set('include', 'serials');
      params.set('view', 'all');
      const res = await fetch(`/api/receiving-lines?${params.toString()}`);
      if (!res.ok) throw new Error('fetch failed');
      return res.json();
    },
    staleTime: 20_000,
    refetchOnWindowFocus: true,
  });

  // Local optimistic mirror — merges receiving-line-updated patches into the
  // cached list without a full refetch. This keeps the rail visibly live as
  // the operator works on a line in the workspace.
  const [localRows, setLocalRows] = useState<ReceivingLineRow[] | null>(null);
  useEffect(() => {
    if (data?.receiving_lines) setLocalRows(data.receiving_lines);
  }, [data]);

  useEffect(() => {
    const handlePatch = (event: Event) => {
      const updated = (event as CustomEvent<Partial<ReceivingLineRow>>).detail;
      if (!updated || typeof updated.id !== 'number') return;
      setLocalRows((rows) => {
        if (!rows) return rows;
        const idx = rows.findIndex((r) => r.id === updated.id);
        if (idx < 0) return rows;
        const next = rows.slice();
        next[idx] = { ...next[idx], ...updated } as ReceivingLineRow;
        return next;
      });
    };
    window.addEventListener('receiving-line-updated', handlePatch);
    return () => window.removeEventListener('receiving-line-updated', handlePatch);
  }, []);

  // Whole-list refresh triggers (new scan, returning tracking match). The
  // table already listens for the same events on the same queryKey, so a
  // single invalidation refreshes both surfaces.
  useEffect(() => {
    const handler = () => {
      queryClient.invalidateQueries({ queryKey: ['receiving-lines-table'] });
    };
    window.addEventListener('receiving-entry-added', handler);
    window.addEventListener('usav-refresh-data', handler);
    return () => {
      window.removeEventListener('receiving-entry-added', handler);
      window.removeEventListener('usav-refresh-data', handler);
    };
  }, [queryClient]);

  // The rail shows the top `limit` rows of the same dataset the History
  // table renders. They're already sorted server-side (view=all sorts by
  // most-recent activity), so slicing gives a chronological feed.
  const allRows = localRows ?? [];
  const rows = allRows.slice(0, limit);

  return (
    <section className="border-t border-gray-100 bg-white">
      <div className="flex items-center justify-between px-3 pt-2 pb-1">
        <p className="text-[9px] font-black uppercase tracking-widest text-gray-500">
          Recent · {rows.length}
          {allRows.length > rows.length ? (
            <span className="ml-1 font-bold text-gray-300">/ {allRows.length}</span>
          ) : null}
        </p>
        <p className="text-[8.5px] font-bold uppercase tracking-widest text-gray-300">
          Same as History
        </p>
      </div>
      {isLoading && rows.length === 0 ? (
        <div className="space-y-1 px-3 py-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-9 w-full animate-pulse rounded-md bg-gray-100" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="px-3 py-3 text-[10px] font-semibold text-gray-400">
          No recent activity yet.
        </p>
      ) : (
        <ul className="px-2 py-1">
          <AnimatePresence initial={false}>
            {rows.map((row) => (
              <RailRow
                key={row.id}
                row={row}
                isSelected={row.id === selectedLineId}
                onClick={() => dispatchSelectLine(row)}
              />
            ))}
          </AnimatePresence>
        </ul>
      )}
    </section>
  );
}

function RailRow({
  row,
  isSelected,
  onClick,
}: {
  row: ReceivingLineRow;
  isSelected: boolean;
  onClick: () => void;
}) {
  const title = row.item_name || row.sku || row.zoho_item_id || `Line #${row.id}`;
  const qty = `${row.quantity_received}/${row.quantity_expected ?? '?'}`;
  const isComplete =
    row.quantity_expected != null && row.quantity_received >= row.quantity_expected;
  const techId = row.assigned_tech_id ?? null;
  const techColor = techId
    ? stationThemeColors[getStaffThemeById(techId)].text
    : 'text-gray-400';

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: -2 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
    >
      <button
        type="button"
        onClick={onClick}
        className={`relative flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
          isSelected
            ? 'bg-blue-50/80 ring-1 ring-inset ring-blue-200'
            : 'hover:bg-gray-50'
        }`}
      >
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${getStatusDot(row.workflow_status)}`}
          aria-hidden
          title={row.workflow_status || undefined}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-bold text-gray-900" title={title}>
            {title}
          </p>
          <p className="truncate text-[9px] font-semibold uppercase tracking-widest text-gray-500">
            <span className={isComplete ? 'text-emerald-600' : 'text-gray-600'}>
              {qty}
            </span>
            {techId ? (
              <span className={`ml-1 ${techColor}`}>
                · {getStaffName(techId)}
              </span>
            ) : null}
          </p>
        </div>
        <span className="shrink-0 tabular-nums text-[9px] font-bold text-gray-400">
          {relativeTime(row.created_at)}
        </span>
      </button>
    </motion.li>
  );
}
