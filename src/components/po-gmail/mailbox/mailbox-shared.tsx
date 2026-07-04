import { AlertTriangle, Check, Search, X } from '@/components/Icons';
import { Button } from '@/design-system/primitives';
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
        <span className="block text-caption font-medium text-text-muted">Gmail query</span>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="is:unread"
          className="mt-1 w-full rounded-md border border-border-default px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </label>
      <label>
        <span className="block text-caption font-medium text-text-muted">Limit</span>
        <input
          type="number"
          min={1}
          max={50}
          value={limit}
          onChange={(e) => setLimit(Math.min(50, Math.max(1, Number(e.target.value) || 25)))}
          className="mt-1 w-20 rounded-md border border-border-default px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </label>
      <Button
        type="button"
        variant="primary"
        size="sm"
        icon={<Search />}
        loading={loading}
        onClick={onRun}
      >
        {actionLabel}
      </Button>
    </div>
  );
}

export function SummaryRow({ elapsedMs, counts, extra }: {
  elapsedMs: number; counts: { missing: number; in_zoho: number; received: number; no_match: number }; extra?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border-hairline pt-3 text-label text-text-soft">
      <span><span className="font-semibold text-amber-700">{counts.missing}</span> missing</span>
      <span aria-hidden>·</span>
      <span><span className="font-semibold text-blue-700">{counts.in_zoho}</span> in Zoho</span>
      <span aria-hidden>·</span>
      <span><span className="font-semibold text-emerald-700">{counts.received}</span> received</span>
      <span aria-hidden>·</span>
      <span><span className="font-semibold text-text-soft">{counts.no_match}</span> unmatched</span>
      <span aria-hidden>·</span>
      <span>{elapsedMs}ms</span>
      {extra && <span className="text-text-faint">{extra}</span>}
    </div>
  );
}

export function StatusChip({ status }: { status: MissingStatus }) {
  const cls =
    status === 'pending'
      ? 'bg-amber-50 text-amber-700'
      : status === 'ignored'
      ? 'bg-surface-sunken text-text-muted'
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
    no_match: { cls: 'bg-surface-sunken text-text-muted',      label: 'no PO#' },
  };
  const m = map[status];
  return <span className={`rounded px-1.5 py-0.5 ${m.cls}`}>{m.label}</span>;
}
