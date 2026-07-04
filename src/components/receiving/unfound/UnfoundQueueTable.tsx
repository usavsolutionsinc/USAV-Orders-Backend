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
 *
 * Thin composition shell: data + mutations live in {@link useUnfoundQueueTable};
 * the inline-edit row is {@link QueueTableRow} under `./queue-table/`.
 */

import { AnimatePresence } from 'framer-motion';
import { UnfoundQueueDetailsPanel } from './UnfoundQueueDetailsPanel';
import { useUnfoundQueueTable } from './queue-table/useUnfoundQueueTable';
import { QueueTableRow } from './queue-table/QueueTableRow';

export {
  ENABLED_KINDS,
  KIND_LABELS,
  type QueueKind,
} from './queue-table/unfound-queue-shared';

export function UnfoundQueueTable() {
  const {
    rows, loading, error, pushing, savedKeys,
    openRow, setOpenRow,
    patchRow, pushToZendesk, openSource, handleDeleted, handlePushedToZendesk,
  } = useUnfoundQueueTable();

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-canvas">
      {/* Loading rail at the top — replaces the toolbar's spinner now that
          the toolbar lives in the sidebar. */}
      {loading && (
        <div className="h-0.5 w-full bg-surface-sunken">
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
          <thead className="sticky top-0 z-10 bg-surface-card shadow-sm">
            <tr className="text-left text-micro font-bold uppercase tracking-wider text-text-soft">
              <th className="px-3 py-2">Zendesk</th>
              <th className="px-3 py-2">Product Title</th>
              <th className="px-3 py-2">USA Team Note</th>
              <th className="px-3 py-2">Vietnam Team Note</th>
              <th className="px-3 py-2 text-center">Check</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border-hairline">
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-label text-text-soft">
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
