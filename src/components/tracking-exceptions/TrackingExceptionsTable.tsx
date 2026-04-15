'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, RefreshCw, X } from '@/components/Icons';
import { TrackingChip, getLast4 } from '@/components/ui/CopyChip';

type StatusFilter = 'open' | 'resolved' | 'discarded' | 'all';

interface TrackingExceptionRow {
  id: number;
  tracking_number: string;
  domain: 'orders' | 'receiving';
  source_station: string;
  staff_id: number | null;
  staff_name: string | null;
  staff_display_name: string | null;
  exception_reason: string;
  notes: string | null;
  status: 'open' | 'resolved' | 'discarded';
  shipment_id: number | null;
  receiving_id: number | null;
  last_zoho_check_at: string | null;
  zoho_check_count: number;
  last_error: string | null;
  domain_metadata: Record<string, unknown> | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  receiving_source: string | null;
  receiving_zoho_po_id: string | null;
  receiving_carrier: string | null;
}

const STATUS_TABS: Array<{ id: StatusFilter; label: string }> = [
  { id: 'open', label: 'Open' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'discarded', label: 'Discarded' },
  { id: 'all', label: 'All' },
];

const STATUS_PILL: Record<TrackingExceptionRow['status'], string> = {
  open: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  resolved: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  discarded: 'bg-gray-100 text-gray-600 ring-1 ring-gray-200',
};

function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return iso;
  const diffMs = Date.now() - ts;
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function getCarrier(row: TrackingExceptionRow): string {
  const fromJoin = (row.receiving_carrier || '').trim();
  if (fromJoin && fromJoin.toUpperCase() !== 'UNKNOWN') return fromJoin;
  const meta = row.domain_metadata as Record<string, unknown> | null;
  const fromMeta = typeof meta?.carrier === 'string' ? (meta.carrier as string).trim() : '';
  if (fromMeta) return fromMeta;
  return 'Unknown';
}

export function TrackingExceptionsTable() {
  const [rows, setRows] = useState<TrackingExceptionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusTab, setStatusTab] = useState<StatusFilter>('open');
  const [search, setSearch] = useState('');
  const [refreshingIds, setRefreshingIds] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<TrackingExceptionRow | null>(null);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('domain', 'receiving');
      params.set('status', statusTab);
      params.set('limit', '200');
      if (search.trim()) params.set('q', search.trim());
      const res = await fetch(`/api/tracking-exceptions?${params.toString()}`, {
        cache: 'no-store',
      });
      const data = await res.json();
      if (!data?.success) throw new Error(data?.error || 'Failed to load');
      setRows((data.rows || []) as TrackingExceptionRow[]);
      setTotal(typeof data.total === 'number' ? data.total : (data.rows?.length || 0));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [statusTab, search]);

  useEffect(() => {
    void fetchRows();
  }, [fetchRows]);

  const handleRefreshRow = useCallback(
    async (row: TrackingExceptionRow) => {
      setRefreshingIds((prev) => {
        const next = new Set(prev);
        next.add(row.id);
        return next;
      });
      try {
        const res = await fetch(`/api/tracking-exceptions/${row.id}/refresh`, {
          method: 'POST',
        });
        const data = await res.json();
        if (!data?.success) {
          throw new Error(data?.error || 'Refresh failed');
        }
        await fetchRows();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Refresh failed');
      } finally {
        setRefreshingIds((prev) => {
          const next = new Set(prev);
          next.delete(row.id);
          return next;
        });
      }
    },
    [fetchRows],
  );

  const handleSaveEdit = useCallback(
    async (row: TrackingExceptionRow, patch: Partial<TrackingExceptionRow>) => {
      const res = await fetch(`/api/tracking-exceptions/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!data?.success) throw new Error(data?.error || 'Save failed');
      setEditing(null);
      await fetchRows();
    },
    [fetchRows],
  );

  const handleDelete = useCallback(
    async (row: TrackingExceptionRow) => {
      const res = await fetch(`/api/tracking-exceptions/${row.id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!data?.success) throw new Error(data?.error || 'Delete failed');
      setEditing(null);
      await fetchRows();
    },
    [fetchRows],
  );

  const hasRows = rows.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Filter bar */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-gray-200 bg-white px-6 py-3">
        <div className="flex items-center gap-1">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusTab(tab.id)}
              className={`rounded-md px-2.5 py-1 text-[10px] font-black uppercase tracking-widest transition-colors ${
                statusTab === tab.id
                  ? 'bg-gray-900 text-white'
                  : 'bg-white text-gray-600 ring-1 ring-gray-200 hover:text-gray-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search tracking…"
          className="ml-auto w-64 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-gray-900 placeholder:text-gray-400 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500/10"
        />
        <button
          type="button"
          onClick={() => void fetchRows()}
          disabled={loading}
          className="rounded-md bg-gray-900 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-white hover:bg-gray-800 disabled:opacity-50"
          aria-label="Reload list"
        >
          {loading ? 'Loading…' : 'Reload'}
        </button>
        <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
          {total} {total === 1 ? 'row' : 'rows'}
        </span>
      </div>

      {error && (
        <div className="border-b border-red-200 bg-red-50 px-6 py-2 text-[12px] font-bold text-red-700">
          {error}
        </div>
      )}

      {/* Rows */}
      <div className="min-h-0 flex-1 overflow-auto">
        {!loading && !hasRows && (
          <div className="flex flex-col items-center justify-center px-6 py-24 text-center">
            <p className="text-[13px] font-bold text-gray-700">No exceptions in this view.</p>
            <p className="mt-1 text-[11px] font-semibold text-gray-500">
              Unmatched receiving scans are logged here automatically.
            </p>
          </div>
        )}

        <table className="w-full border-collapse text-left text-[12px]">
          <thead className="sticky top-0 bg-gray-50 text-[9px] font-black uppercase tracking-widest text-gray-500">
            <tr>
              <th className="px-4 py-2">Tracking</th>
              <th className="px-4 py-2">Carrier</th>
              <th className="px-4 py-2">Source</th>
              <th className="px-4 py-2">Staff</th>
              <th className="px-4 py-2">Reason</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Retries</th>
              <th className="px-4 py-2">Last check</th>
              <th className="px-4 py-2">Created</th>
              <th className="px-4 py-2">Notes</th>
              <th className="px-4 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {rows.map((row) => {
              const refreshing = refreshingIds.has(row.id);
              return (
                <tr key={row.id} className="hover:bg-gray-50/60">
                  <td className="px-4 py-2">
                    <TrackingChip
                      value={row.tracking_number}
                      display={getLast4(row.tracking_number) || row.tracking_number.slice(-4)}
                    />
                  </td>
                  <td className="px-4 py-2 font-semibold text-gray-700">{getCarrier(row)}</td>
                  <td className="px-4 py-2 text-gray-700">{row.source_station}</td>
                  <td className="px-4 py-2 text-gray-700">
                    {row.staff_display_name || row.staff_name || '—'}
                  </td>
                  <td className="px-4 py-2 font-semibold text-gray-700">
                    {row.exception_reason}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${STATUS_PILL[row.status]}`}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 font-mono text-gray-700">{row.zoho_check_count}</td>
                  <td className="px-4 py-2 text-gray-600">{formatRelative(row.last_zoho_check_at)}</td>
                  <td className="px-4 py-2 text-gray-600">{formatRelative(row.created_at)}</td>
                  <td className="px-4 py-2 max-w-[260px] truncate text-gray-600" title={row.notes ?? ''}>
                    {row.notes || '—'}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => void handleRefreshRow(row)}
                        disabled={refreshing || row.status !== 'open'}
                        aria-label="Refresh from Zoho"
                        title={
                          row.status === 'open'
                            ? 'Refresh: re-query Zoho with this tracking number'
                            : 'Only open exceptions can be refreshed'
                        }
                        className="rounded-md p-1.5 text-gray-500 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing(row)}
                        aria-label="Edit exception"
                        title="Edit — opens a dialog where you can update or delete this row"
                        className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editing && (
        <TrackingExceptionEditDialog
          row={editing}
          onClose={() => setEditing(null)}
          onSave={handleSaveEdit}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}

interface EditDialogProps {
  row: TrackingExceptionRow;
  onClose: () => void;
  onSave: (row: TrackingExceptionRow, patch: Partial<TrackingExceptionRow>) => Promise<void>;
  onDelete: (row: TrackingExceptionRow) => Promise<void>;
}

function TrackingExceptionEditDialog({ row, onClose, onSave, onDelete }: EditDialogProps) {
  const [trackingNumber, setTrackingNumber] = useState(row.tracking_number);
  const [notes, setNotes] = useState(row.notes ?? '');
  const [reason, setReason] = useState(row.exception_reason);
  const [status, setStatus] = useState<TrackingExceptionRow['status']>(row.status);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const dirty = useMemo(
    () =>
      trackingNumber !== row.tracking_number ||
      (notes || '') !== (row.notes || '') ||
      reason !== row.exception_reason ||
      status !== row.status,
    [trackingNumber, notes, reason, status, row],
  );

  const handleSave = async () => {
    setSaving(true);
    setErr(null);
    try {
      await onSave(row, {
        tracking_number: trackingNumber.trim(),
        notes: notes.trim() || null,
        exception_reason: reason.trim() || 'not_found',
        status,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setSaving(true);
    setErr(null);
    try {
      await onDelete(row);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Delete failed');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <h2 className="text-[12px] font-black uppercase tracking-widest text-gray-900">
            Edit exception #{row.id}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 px-5 py-4">
          <label className="block">
            <span className="text-[9px] font-black uppercase tracking-widest text-gray-500">
              Tracking number
            </span>
            <input
              type="text"
              value={trackingNumber}
              onChange={(e) => setTrackingNumber(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-200 px-2 py-1.5 text-[12px] font-mono text-gray-900 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500/10"
            />
          </label>
          <label className="block">
            <span className="text-[9px] font-black uppercase tracking-widest text-gray-500">
              Reason
            </span>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-200 px-2 py-1.5 text-[12px] font-semibold text-gray-900 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500/10"
            />
          </label>
          <label className="block">
            <span className="text-[9px] font-black uppercase tracking-widest text-gray-500">
              Status
            </span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as TrackingExceptionRow['status'])}
              className="mt-1 w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[12px] font-bold text-gray-900 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500/10"
            >
              <option value="open">Open</option>
              <option value="resolved">Resolved</option>
              <option value="discarded">Discarded</option>
            </select>
          </label>
          <label className="block">
            <span className="text-[9px] font-black uppercase tracking-widest text-gray-500">
              Notes
            </span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-md border border-gray-200 px-2 py-1.5 text-[12px] font-semibold text-gray-900 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500/10"
            />
          </label>

          {err && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-[11px] font-bold text-red-700">{err}</p>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-gray-200 px-5 py-3">
          {!confirmingDelete ? (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              disabled={saving}
              className="rounded-md px-2.5 py-1.5 text-[10px] font-black uppercase tracking-widest text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              Delete
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-red-700">
                Confirm delete?
              </span>
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={saving}
                className="rounded-md bg-red-600 px-2.5 py-1.5 text-[10px] font-black uppercase tracking-widest text-white hover:bg-red-700 disabled:opacity-50"
              >
                Yes, delete
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                disabled={saving}
                className="rounded-md px-2.5 py-1.5 text-[10px] font-black uppercase tracking-widest text-gray-600 hover:bg-gray-100"
              >
                Cancel
              </button>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-md px-2.5 py-1.5 text-[10px] font-black uppercase tracking-widest text-gray-600 hover:bg-gray-100 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || !dirty}
              className="rounded-md bg-gray-900 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
