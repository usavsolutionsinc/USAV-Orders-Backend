'use client';

/**
 * Unfound queue table — the flat presentation surface for v_unfound_queue.
 *
 * Toolbar (filter pills, "Show checked", search, Refresh) lives in the
 * sidebar via UnfoundQueueSidebarToolbar. The table reads filter state
 * from URL search params so both components share one source of truth
 * — no prop drilling, no shared store. Back/forward in the browser
 * respects the operator's filter selection.
 *
 * Inline edit pattern: each editable cell debounces a PATCH against
 * /api/receiving/unfound-queue/[kind]/[id]. Optimistic update first;
 * revert via re-fetch on failure.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from '@/lib/toast';
import { ExternalLink } from '@/components/Icons';

// ─── Types ────────────────────────────────────────────────────────────────────

export type QueueKind =
  | 'all'
  | 'email_po'
  | 'unmatched_receiving'
  | 'station_exception';

export const ENABLED_KINDS: QueueKind[] = [
  'all',
  'unmatched_receiving',
  'email_po',
  'station_exception',
];

export const KIND_LABELS: Record<QueueKind, string> = {
  all: 'All',
  unmatched_receiving: 'Unmatched receiving',
  email_po: 'PO mailbox',
  station_exception: 'Station exceptions',
};

interface QueueRow {
  kind: Exclude<QueueKind, 'all'>;
  source_id: string;
  organization_id: string;
  product_title: string | null;
  serial_numbers: string | null;
  context: string | null;
  created_at: string;
  zendesk_ticket_id: string | null;
  zendesk_synced_at: string | null;
  usa_team_note: string | null;
  vietnam_team_note: string | null;
  follow_up_at: string | null;
  checked: boolean;
  checked_at: string | null;
}

interface QueueResponse {
  success: boolean;
  rows?: QueueRow[];
  total?: number;
  error?: string;
}

interface PatchBody {
  zendesk_ticket_id?: string | null;
  usa_team_note?: string | null;
  vietnam_team_note?: string | null;
  checked?: boolean;
}

const DEBOUNCE_MS = 400;
const UNFOUND_QUEUE_REFRESH_EVENT = 'unfound-queue-refresh';

// ─── Filter-state helpers (URL search params are the source of truth) ─────────

function parseKind(raw: string | null): QueueKind {
  if (!raw) return 'all';
  return (ENABLED_KINDS as readonly string[]).includes(raw)
    ? (raw as QueueKind)
    : 'all';
}

// ─── Component ────────────────────────────────────────────────────────────────

export function UnfoundQueueTable() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const kind = parseKind(searchParams.get('uf_kind'));
  const showChecked = searchParams.get('uf_checked') === '1';
  const search = searchParams.get('uf_q') ?? '';

  const [rows, setRows] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pushing, setPushing] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Fetch ──────────────────────────────────────────────────────────────────
  const fetchRows = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);

    const url = new URL('/api/receiving/unfound-queue', window.location.origin);
    url.searchParams.set('kind', kind);
    url.searchParams.set('checked', showChecked ? 'all' : 'false');
    if (search.trim()) url.searchParams.set('q', search.trim());

    try {
      const res = await fetch(url.toString(), {
        signal: controller.signal,
        cache: 'no-store',
      });
      const body = (await res.json()) as QueueResponse;
      if (!res.ok || !body.success) {
        throw new Error(body.error ?? `fetch failed (${res.status})`);
      }
      setRows(body.rows ?? []);
    } catch (err: unknown) {
      if ((err as { name?: string })?.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'fetch failed');
      setRows([]);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [kind, showChecked, search]);

  // Debounce only when the search term changed. Kind/checked toggles fetch
  // immediately so the operator's pill click feels instant.
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(
      () => {
        void fetchRows();
      },
      search ? DEBOUNCE_MS : 0,
    );
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [fetchRows, search]);

  // Sidebar's Refresh button dispatches this so we don't need a shared ref.
  useEffect(() => {
    const handler = () => void fetchRows();
    window.addEventListener(UNFOUND_QUEUE_REFRESH_EVENT, handler);
    return () => window.removeEventListener(UNFOUND_QUEUE_REFRESH_EVENT, handler);
  }, [fetchRows]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // ─── Mutations ──────────────────────────────────────────────────────────────
  const patchRow = useCallback(
    async (row: QueueRow, patch: PatchBody) => {
      setRows((prev) =>
        prev.map((r) =>
          r.kind === row.kind && r.source_id === row.source_id
            ? { ...r, ...patch }
            : r,
        ),
      );
      try {
        const res = await fetch(
          `/api/receiving/unfound-queue/${row.kind}/${encodeURIComponent(row.source_id)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
          },
        );
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.success) {
          throw new Error(body.error ?? `patch failed (${res.status})`);
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Update failed');
        await fetchRows();
      }
    },
    [fetchRows],
  );

  const pushToZendesk = useCallback(
    async (row: QueueRow) => {
      const rowKey = `${row.kind}:${row.source_id}`;
      setPushing(rowKey);
      try {
        const res = await fetch(
          `/api/receiving/unfound-queue/${row.kind}/${encodeURIComponent(row.source_id)}/push-to-zendesk`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' } },
        );
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.success) {
          throw new Error(body.error ?? `push failed (${res.status})`);
        }
        toast.success(
          body.already_synced
            ? `Already on Zendesk ticket ${body.ticketNumber}`
            : `Zendesk ticket ${body.ticketNumber} created`,
        );
        await fetchRows();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Push to Zendesk failed');
      } finally {
        setPushing(null);
      }
    },
    [fetchRows],
  );

  const openSource = useCallback(
    (row: QueueRow) => {
      // station_exception has no rich detail surface — all actionable data
      // (tracking, station, notes) is already inline in the queue row.
      if (row.kind === 'station_exception') return;
      router.push(
        `/receiving/unfound/${row.kind}/${encodeURIComponent(row.source_id)}`,
      );
    },
    [router],
  );

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full min-h-0 flex-col bg-gray-50">
      {/* Loading rail at the top — replaces the toolbar's spinner now that
          the toolbar lives in the sidebar. */}
      {loading && (
        <div className="h-0.5 w-full bg-gray-100">
          <div className="recv-indet-bar h-full w-1/3 rounded-full bg-blue-500" />
        </div>
      )}

      {/* Table */}
      <div className="min-h-0 flex-1 overflow-auto">
        {error && (
          <div className="mx-4 mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-label text-red-700">
            {error}
          </div>
        )}

        <table className="min-w-full text-sm">
          <thead className="sticky top-0 z-10 bg-white shadow-sm">
            <tr className="text-left text-micro font-bold uppercase tracking-wider text-gray-500">
              <th className="px-3 py-2">Zendesk</th>
              <th className="px-3 py-2">Product Title</th>
              <th className="px-3 py-2">Serial numbers</th>
              <th className="px-3 py-2">USA Team Note</th>
              <th className="px-3 py-2">Vietnam Team Note</th>
              <th className="px-3 py-2 text-center">Check</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-label text-gray-500">
                  {error ? '—' : 'Nothing in the unfound queue. Nice.'}
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <QueueTableRow
                key={`${row.kind}:${row.source_id}`}
                row={row}
                onPatch={patchRow}
                onPush={pushToZendesk}
                onOpen={openSource}
                pushing={pushing === `${row.kind}:${row.source_id}`}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Row (module-scope per react-best-practices) ─────────────────────────────

interface QueueTableRowProps {
  row: QueueRow;
  onPatch: (row: QueueRow, patch: PatchBody) => Promise<void>;
  onPush: (row: QueueRow) => Promise<void>;
  onOpen: (row: QueueRow) => void;
  pushing: boolean;
}

function QueueTableRow({
  row,
  onPatch,
  onPush,
  onOpen,
  pushing,
}: QueueTableRowProps) {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debouncedPatch = useCallback(
    (patch: PatchBody) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void onPatch(row, patch);
      }, DEBOUNCE_MS);
    },
    [onPatch, row],
  );

  return (
    <tr
      className={`align-top transition-colors hover:bg-blue-50/40 ${
        row.checked ? 'bg-gray-50/60 text-gray-500' : 'text-gray-900'
      }`}
    >
      <td className="px-3 py-2 font-mono text-label">
        <input
          type="text"
          defaultValue={row.zendesk_ticket_id ?? ''}
          onBlur={(e) => {
            const next = e.target.value.trim() || null;
            if (next !== (row.zendesk_ticket_id ?? null)) {
              void onPatch(row, { zendesk_ticket_id: next });
            }
          }}
          placeholder="—"
          className="w-20 border-b border-transparent bg-transparent px-1 py-0.5 outline-none focus:border-blue-500"
        />
      </td>
      <td className="px-3 py-2 font-semibold">
        <button
          type="button"
          onClick={() => onOpen(row)}
          className="text-left hover:text-blue-600"
        >
          {row.product_title || '—'}
        </button>
        {row.context && (
          <div className="mt-0.5 truncate text-micro font-normal text-gray-500">
            {row.context}
          </div>
        )}
      </td>
      <td className="max-w-[280px] truncate px-3 py-2 font-mono text-caption text-gray-600">
        {row.serial_numbers || '—'}
      </td>
      <td className="px-3 py-2">
        <textarea
          rows={1}
          defaultValue={row.usa_team_note ?? ''}
          onChange={(e) =>
            debouncedPatch({ usa_team_note: e.target.value || null })
          }
          placeholder="—"
          className="w-full resize-none border-b border-transparent bg-transparent px-1 py-0.5 text-label outline-none focus:border-blue-500"
        />
      </td>
      <td className="px-3 py-2">
        <textarea
          rows={1}
          defaultValue={row.vietnam_team_note ?? ''}
          onChange={(e) =>
            debouncedPatch({ vietnam_team_note: e.target.value || null })
          }
          placeholder="—"
          className="w-full resize-none border-b border-transparent bg-transparent px-1 py-0.5 text-label outline-none focus:border-blue-500"
        />
      </td>
      <td className="px-3 py-2 text-center">
        <input
          type="checkbox"
          checked={row.checked}
          onChange={(e) => void onPatch(row, { checked: e.target.checked })}
          className="h-4 w-4"
        />
      </td>
      <td className="px-3 py-2 text-right">
        {row.zendesk_ticket_id ? (
          <span className="text-micro font-bold uppercase tracking-wider text-emerald-600">
            Synced
          </span>
        ) : (
          <button
            type="button"
            onClick={() => void onPush(row)}
            disabled={pushing}
            title="Create a Zendesk ticket from this row"
            className="flex items-center gap-1 rounded-md border border-blue-200 px-2 py-1 text-micro font-bold uppercase tracking-wider text-blue-600 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ExternalLink className="h-3 w-3" />
            {pushing ? '…' : 'Push'}
          </button>
        )}
      </td>
    </tr>
  );
}
