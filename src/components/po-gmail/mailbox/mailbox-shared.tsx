import { AlertTriangle, Check, Loader2, Search, X } from '@/components/Icons';
import type { MissingStatus, ReconcileItem } from './po-mailbox-types';

export function ScanControls({
  query, setQuery, limit, setLimit, onRun, loading, actionLabel,
}: {
  query: string; setQuery: (s: string) => void;
  limit: number; setLimit: (n: number) => void;
  onRun: () => void; loading: boolean;
  actionLabel: string;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex-1 min-w-[220px]">
        <span className="block text-caption font-medium text-gray-700">Gmail query</span>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
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
          value={limit}
          onChange={(e) => setLimit(Math.min(50, Math.max(1, Number(e.target.value) || 25)))}
          className="mt-1 w-20 rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </label>
      <button
        type="button"
        onClick={onRun}
        disabled={loading}
        className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        {actionLabel}
      </button>
    </div>
  );
}

export function SummaryRow({ elapsedMs, counts, extra }: {
  elapsedMs: number; counts: { missing: number; in_zoho: number; received: number; no_match: number }; extra?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3 text-label text-gray-500">
      <span><span className="font-semibold text-amber-700">{counts.missing}</span> missing</span>
      <span aria-hidden>·</span>
      <span><span className="font-semibold text-blue-700">{counts.in_zoho}</span> in Zoho</span>
      <span aria-hidden>·</span>
      <span><span className="font-semibold text-emerald-700">{counts.received}</span> received</span>
      <span aria-hidden>·</span>
      <span><span className="font-semibold text-gray-500">{counts.no_match}</span> unmatched</span>
      <span aria-hidden>·</span>
      <span>{elapsedMs}ms</span>
      {extra && <span className="text-gray-400">{extra}</span>}
    </div>
  );
}

export function StatusChip({ status }: { status: MissingStatus }) {
  const cls =
    status === 'pending'
      ? 'bg-amber-50 text-amber-700'
      : status === 'ignored'
      ? 'bg-gray-100 text-gray-600'
      : 'bg-emerald-50 text-emerald-700';
  const Icon = status === 'pending' ? AlertTriangle : status === 'ignored' ? X : Check;
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 ${cls}`}>
      <Icon className="h-3 w-3" />
      {status}
    </span>
  );
}

export function ReconcileStatusChip({ status }: { status: ReconcileItem['status'] }) {
  const map: Record<ReconcileItem['status'], { cls: string; label: string }> = {
    missing:  { cls: 'bg-amber-50 text-amber-700',     label: 'missing' },
    in_zoho:  { cls: 'bg-blue-50 text-blue-700',       label: 'in Zoho' },
    received: { cls: 'bg-emerald-50 text-emerald-700', label: 'received' },
    no_match: { cls: 'bg-gray-100 text-gray-600',      label: 'no PO#' },
  };
  const m = map[status];
  return <span className={`rounded px-1.5 py-0.5 ${m.cls}`}>{m.label}</span>;
}
