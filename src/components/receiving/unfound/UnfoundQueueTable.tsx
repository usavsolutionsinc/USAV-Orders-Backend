'use client';

/**
 * Unfound queue table — the flat presentation surface for v_unfound_queue.
 *
 * Toolbar (filter pills, search, Refresh) lives in the sidebar via
 * UnfoundQueueSidebarToolbar. The table reads filter state from URL search
 * params so both components share one source of truth — no prop drilling,
 * no shared store. Back/forward in the browser respects the operator's
 * filter selection.
 *
 * Filter tabs map to server-side filters as follows:
 *   • all                  → kind=all,                 checked=false
 *   • unmatched_receiving  → kind=unmatched_receiving, checked=false
 *   • email_po             → kind=email_po,            checked=false
 *   • checked              → kind=all,                 checked=true
 *
 * Inline edit pattern: each editable cell debounces a PATCH against
 * /api/receiving/unfound-queue/[kind]/[id]. Optimistic update first;
 * revert just that row on failure.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useSearchParams } from 'next/navigation';
import { toast } from '@/lib/toast';
import { ExternalLink } from '@/components/Icons';
import { PoChip, TrackingChip, getLast4 } from '@/components/ui/CopyChip';
import { UnfoundQueueDetailsPanel } from './UnfoundQueueDetailsPanel';

// ─── Types ────────────────────────────────────────────────────────────────────

export type QueueKind =
  | 'all'
  | 'email_po'
  | 'unmatched_receiving'
  | 'station_exception'
  | 'checked';

/**
 * Station exceptions ('station_exception') were removed from the sidebar
 * filter — operators triage those directly from the affected stations.
 * The type union keeps it for back-compat with deep-linked URLs.
 *
 * 'checked' is a pseudo-kind: server-side it maps to kind=all + checked=true.
 */
export const ENABLED_KINDS: QueueKind[] = [
  'all',
  'unmatched_receiving',
  'email_po',
  'checked',
];

export const KIND_LABELS: Record<QueueKind, string> = {
  all: 'All',
  unmatched_receiving: 'Unmatched receiving',
  email_po: 'PO mailbox',
  station_exception: 'Station exceptions',
  checked: 'Checked',
};

interface QueueRow {
  kind: Exclude<QueueKind, 'all' | 'checked'>;
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

// Match the trailing " · PO: A, B, C" suffix the email_po view branch appends
// to the context column (see v_unfound_queue migration). The PO numbers are
// pulled out so they can render as PoChips; the subject prefix stays plain.
//
// Format coverage:
//   • Multiple POs: "Subject · PO: 19-14668-49126, 18-14670-03483"
//   • Single PO:    "Subject · PO: 27-14557-39548"
const PO_SUFFIX_RE = / · PO:\s*(.+?)\s*$/;

function splitPoContext(context: string | null): {
  prefix: string;
  poNumbers: string[];
} {
  if (!context) return { prefix: '', poNumbers: [] };
  const match = context.match(PO_SUFFIX_RE);
  if (!match) return { prefix: context, poNumbers: [] };
  const prefix = context.slice(0, match.index).trim();
  const poNumbers = match[1]!
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return { prefix, poNumbers };
}

// ─── Filter-state helpers (URL search params are the source of truth) ─────────

function parseKind(raw: string | null): QueueKind {
  if (!raw) return 'all';
  return (ENABLED_KINDS as readonly string[]).includes(raw)
    ? (raw as QueueKind)
    : 'all';
}

// ─── Component ────────────────────────────────────────────────────────────────

export function UnfoundQueueTable() {
  const searchParams = useSearchParams();

  const kind = parseKind(searchParams.get('uf_kind'));
  const search = searchParams.get('uf_q') ?? '';

  const [rows, setRows] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pushing, setPushing] = useState<string | null>(null);
  // Per-row "Saved" pulse — keyed `${kind}:${source_id}`, shows for ~1.5s
  // after a successful note / zendesk-id PATCH so the operator gets
  // unmistakable confirmation. Check toggles refetch instead, so the row
  // simply leaves the current tab.
  const [savedKeys, setSavedKeys] = useState<Set<string>>(() => new Set());
  // Slide-in details panel — open by clicking a row's subject/title. Lives
  // here (vs. its own URL route) so closing returns the operator to their
  // place in the table with scroll preserved.
  const [openRow, setOpenRow] = useState<QueueRow | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Fetch ──────────────────────────────────────────────────────────────────
  const fetchRows = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);

    // 'checked' tab is a pseudo-kind: server-side it's kind=all + checked=true.
    // All other tabs hide checked rows so completed work disappears immediately.
    const serverKind = kind === 'checked' ? 'all' : kind;
    const serverChecked = kind === 'checked' ? 'true' : 'false';

    const url = new URL('/api/receiving/unfound-queue', window.location.origin);
    url.searchParams.set('kind', serverKind);
    url.searchParams.set('checked', serverChecked);
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
  }, [kind, search]);

  // Debounce only when the search term changed. Kind toggles fetch immediately
  // so the operator's pill click feels instant.
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
    const handler = () => {
      void fetchRows();
    };
    window.addEventListener(UNFOUND_QUEUE_REFRESH_EVENT, handler);
    return () => window.removeEventListener(UNFOUND_QUEUE_REFRESH_EVENT, handler);
  }, [fetchRows]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // ─── Mutations ──────────────────────────────────────────────────────────────
  const patchRow = useCallback(
    async (row: QueueRow, patch: PatchBody) => {
      const rowKey = `${row.kind}:${row.source_id}`;
      const optimisticRow: QueueRow = { ...row, ...patch };
      const isCheckToggle = patch.checked !== undefined;

      // Optimistic update so the row reflects the change immediately. For a
      // check toggle the row will disappear on the next refetch anyway, but
      // the optimistic state keeps the checkbox in sync between click and
      // refetch.
      setRows((prev) =>
        prev.map((r) =>
          r.kind === row.kind && r.source_id === row.source_id
            ? optimisticRow
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
          console.error('[unfound-queue PATCH] failed', { status: res.status, body });
          throw new Error(
            body.error ??
              body.detail ??
              `patch failed (${res.status}${body.code ? ` · ${body.code}` : ''})`,
          );
        }

        if (isCheckToggle) {
          // Check toggles change the row's tab membership — pull a fresh
          // server view so the row leaves (or, on the Checked tab, joins)
          // the current list.
          void fetchRows();
        } else {
          // Note / Zendesk-ID updates keep the row in place. Show a brief
          // "Saved" pulse so the operator sees the write landed.
          setSavedKeys((prev) => {
            const next = new Set(prev);
            next.add(rowKey);
            return next;
          });
          setTimeout(() => {
            setSavedKeys((prev) => {
              if (!prev.has(rowKey)) return prev;
              const next = new Set(prev);
              next.delete(rowKey);
              return next;
            });
          }, 1500);
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Update failed');
        setRows((prev) =>
          prev.map((r) =>
            r.kind === row.kind && r.source_id === row.source_id ? row : r,
          ),
        );
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

  const openSource = useCallback((row: QueueRow) => {
    // All kinds open into the slide-in details panel for inline review +
    // delete. Per-kind navigation (Open in Gmail / Open in workspace) lives
    // inside the panel as secondary actions.
    setOpenRow(row);
  }, []);

  const handleDeleted = useCallback((deletedRow: QueueRow) => {
    setRows((prev) =>
      prev.filter(
        (r) =>
          !(r.kind === deletedRow.kind && r.source_id === deletedRow.source_id),
      ),
    );
  }, []);

  const handlePushedToZendesk = useCallback(
    (pushedRow: QueueRow, ticketNumber: string) => {
      setRows((prev) =>
        prev.map((r) =>
          r.kind === pushedRow.kind && r.source_id === pushedRow.source_id
            ? { ...r, zendesk_ticket_id: ticketNumber }
            : r,
        ),
      );
    },
    [],
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

        <table className="w-full table-fixed text-sm">
          {/* Explicit widths keep columns stable across filter changes —
              without these, the table relayouts every time the content per
              column changes (e.g. tracking chips vs. PO chips vs. empty). */}
          <colgroup>
            <col style={{ width: '108px' }} />
            <col style={{ width: '32%' }} />
            <col style={{ width: '26%' }} />
            <col style={{ width: '26%' }} />
            <col style={{ width: '88px' }} />
            <col style={{ width: '96px' }} />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-white shadow-sm">
            <tr className="text-left text-micro font-bold uppercase tracking-wider text-gray-500">
              <th className="px-3 py-2">Zendesk</th>
              <th className="px-3 py-2">Product Title</th>
              <th className="px-3 py-2">USA Team Note</th>
              <th className="px-3 py-2">Vietnam Team Note</th>
              <th className="px-3 py-2 text-center">Check</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-label text-gray-500">
                  {error ? '—' : 'Nothing in the unfound queue. Nice.'}
                </td>
              </tr>
            )}
            {rows.map((row) => {
              const rowKey = `${row.kind}:${row.source_id}`;
              return (
                <QueueTableRow
                  key={rowKey}
                  row={row}
                  onPatch={patchRow}
                  onPush={pushToZendesk}
                  onOpen={openSource}
                  pushing={pushing === rowKey}
                  justSaved={savedKeys.has(rowKey)}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Slide-in details panel (one mount at a time, AnimatePresence for the
          slide-out transition). Lives at the table root so the backdrop sits
          above the table content but below any toaster. */}
      <AnimatePresence>
        {openRow && (
          <UnfoundQueueDetailsPanel
            key={`${openRow.kind}:${openRow.source_id}`}
            row={openRow}
            onClose={() => setOpenRow(null)}
            onDeleted={handleDeleted}
            onPushedToZendesk={handlePushedToZendesk}
          />
        )}
      </AnimatePresence>
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
  /** Show a brief "Saved" pulse next to the checkbox after a successful PATCH. */
  justSaved: boolean;
}

function QueueTableRow({
  row,
  onPatch,
  onPush,
  onOpen,
  pushing,
  justSaved,
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

  // Row-level handler: open the details panel for clicks anywhere in the
  // row EXCEPT on an inline control (text input, textarea, button, label).
  // This lets the operator click the empty padding around a "—" placeholder
  // and still get the panel — without us having to remember stopPropagation
  // on every interactive descendant.
  const handleRowClick = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, button, label')) return;
      onOpen(row);
    },
    [onOpen, row],
  );

  return (
    <tr
      onClick={handleRowClick}
      className={`cursor-pointer align-top transition-colors hover:bg-blue-50/40 ${
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
        {(() => {
          // Email-PO rows: subject as the title (top), chips as the
          // identifier below — same shape as tracking-chip rows below.
          if (row.kind === 'email_po') {
            const { prefix, poNumbers } = splitPoContext(row.context);
            return (
              <>
                <div className="text-left">
                  {prefix || row.product_title || '—'}
                </div>
                {poNumbers.length > 0 && (
                  // Chips render <button> internally — the row-level handler
                  // skips clicks that land inside a <button>, so copy still
                  // wins over opening the panel.
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    {poNumbers.map((po) => (
                      <PoChip key={po} value={po} display={getLast4(po)} />
                    ))}
                  </div>
                )}
              </>
            );
          }
          // Other kinds: product title on top, chip/text below.
          return (
            <>
              <div className="text-left">{row.product_title || '—'}</div>
              {row.context && (
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-micro font-normal text-gray-500">
                  {row.kind === 'unmatched_receiving' ? (
                    <TrackingChip
                      value={row.context}
                      display={getLast4(row.context)}
                    />
                  ) : (
                    <span className="truncate">{row.context}</span>
                  )}
                </div>
              )}
            </>
          );
        })()}
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
        <div className="flex items-center justify-center gap-1.5">
          <input
            type="checkbox"
            checked={row.checked}
            onChange={(e) => void onPatch(row, { checked: e.target.checked })}
            className="h-4 w-4"
          />
          {justSaved ? (
            <span className="text-micro font-bold uppercase tracking-wider text-emerald-600">
              Saved
            </span>
          ) : null}
        </div>
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
