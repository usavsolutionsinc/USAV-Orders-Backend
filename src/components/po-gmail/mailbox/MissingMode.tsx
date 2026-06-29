import { Loader2, Search } from '@/components/Icons';
import { Button } from '@/design-system/primitives';
import { MISSING_STATUS_TABS, type MissingResponse, type MissingStatus } from './po-mailbox-types';
import { StatusChip } from './mailbox-shared';

/** Missing-from-Zoho worklist: scan controls + status filter + actionable rows. */
export function MissingMode({
  missing, loading, statusFilter, onStatusFilter, onRefresh, onAct, actingId,
  onRunReconcile, scanQuery, setScanQuery, scanLimit, setScanLimit, scanLoading,
}: {
  missing: MissingResponse | null;
  loading: boolean;
  statusFilter: MissingStatus;
  onStatusFilter: (s: MissingStatus) => void;
  onRefresh: () => void;
  onAct: (id: string, status: MissingStatus) => void;
  actingId: string | null;
  onRunReconcile: () => void;
  scanQuery: string;
  setScanQuery: (s: string) => void;
  scanLimit: number;
  setScanLimit: (n: number) => void;
  scanLoading: boolean;
}) {
  return (
    <div className="space-y-3">
      {/* Scan controls — run a fresh reconcile to populate the worklist */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
        <label className="flex-1 min-w-[220px]">
          <span className="block text-caption font-medium text-gray-700">Gmail query</span>
          <input
            type="text"
            value={scanQuery}
            onChange={(e) => setScanQuery(e.target.value)}
            placeholder="is:unread"
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </label>
        <label>
          <span className="block text-caption font-medium text-gray-700">Limit</span>
          <input
            type="number"
            min={1}
            max={50}
            value={scanLimit}
            onChange={(e) => setScanLimit(Math.min(50, Math.max(1, Number(e.target.value) || 25)))}
            className="mt-1 w-20 rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </label>
        <Button
          variant="primary"
          size="sm"
          onClick={onRunReconcile}
          disabled={scanLoading}
          icon={scanLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        >
          Scan + reconcile
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          disabled={loading}
          className="text-gray-500 underline hover:text-gray-900"
        >
          Refresh list
        </Button>
      </div>

      {/* Status filter pills */}
      <div className="flex flex-wrap items-center gap-2 text-label">
        {MISSING_STATUS_TABS.map((t) => {
          const n = missing?.counts[t.id] ?? 0;
          const active = statusFilter === t.id;
          return (
            // ds-raw-button: segmented status-filter pill (conditional active fill + inline count), not a single-variant Button
            <button
              key={t.id}
              type="button"
              onClick={() => onStatusFilter(t.id)}
              className={`rounded-full border px-2.5 py-1 transition-colors ${
                active ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
              }`}
            >
              {t.label}
              <span className={`ml-1.5 tabular-nums ${active ? 'opacity-90' : 'opacity-70'}`}>{n}</span>
            </button>
          );
        })}
      </div>

      {/* List */}
      {loading && !missing ? (
        <div className="rounded-md border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-500">
          <Loader2 className="mx-auto h-5 w-5 animate-spin text-gray-400" />
        </div>
      ) : !missing || missing.items.length === 0 ? (
        <div className="rounded-md border border-dashed border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-500">
          {statusFilter === 'pending'
            ? 'Nothing missing — every scanned email matched a PO in Zoho.'
            : `No ${statusFilter} rows.`}
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-md border border-gray-200 bg-white">
          {missing.items.map((row) => {
            const acting = actingId === row.id;
            return (
              <li key={row.id} className="px-3 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                      <span className="truncate text-sm font-medium text-gray-900">{row.email_subject || '(no subject)'}</span>
                      <span className="truncate text-label text-gray-500">{row.email_from}</span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-gray-500">
                      <span>{new Date(row.scanned_at).toLocaleString()}</span>
                      <span aria-hidden>·</span>
                      <StatusChip status={row.status} />
                      {row.po_numbers.map((p) => (
                        <span key={p} className="rounded bg-amber-50 px-1.5 py-0.5 font-mono text-amber-700">{p}</span>
                      ))}
                    </div>
                    {row.notes && <p className="mt-1 text-[11.5px] italic text-gray-500">{row.notes}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {row.gmail_msg_id && (
                      <a
                        href={`https://mail.google.com/mail/u/0/#all/${row.gmail_msg_id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-md border border-gray-200 px-2 py-1 text-[11.5px] text-gray-600 hover:bg-gray-50"
                      >
                        Open ↗
                      </a>
                    )}
                    {row.status !== 'ignored' && (
                      <Button variant="secondary" size="sm" onClick={() => onAct(row.id, 'ignored')} disabled={acting}>
                        Ignore
                      </Button>
                    )}
                    {row.status === 'ignored' && (
                      <Button variant="secondary" size="sm" onClick={() => onAct(row.id, 'pending')} disabled={acting}>
                        Restore
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
