'use client';

/**
 * /warehouse/rma — RMA authorization queue.
 *
 * Supervisor surface for Phase A5. Lists open RMAs, lets staff issue a new
 * authorization (customer return or vendor RTV), and moves each one through
 * AUTHORIZED → RECEIVED → DISPOSITIONED → CLOSED.
 *
 * Per-unit dispositions live on the disposition station (/warehouse/rma/
 * disposition, linked below) — a scan-driven bench, not a row action here:
 * this index covers the lifecycle transitions a supervisor needs at-a-glance.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { formatDistanceToNowStrict } from 'date-fns';
import { NetworkChip } from '@/components/mobile/NetworkChip';
import { Button } from '@/design-system/primitives';
import { Barcode, ChevronRight, Clock } from '@/components/Icons';
import { rmaStatusBadgeClass } from '@/lib/rma-status';
import { conditionLabel } from '@/lib/conditions';

type RmaDirection = 'INBOUND_FROM_CUSTOMER' | 'OUTBOUND_TO_VENDOR';
type RmaStatus =
  | 'AUTHORIZED'
  | 'RECEIVED'
  | 'DISPOSITIONED'
  | 'CLOSED'
  | 'EXPIRED'
  | 'CANCELED';

interface RmaRow {
  id: number;
  rmaNumber: string;
  direction: RmaDirection;
  orderId: number | null;
  customerId: number | null;
  authorizedAt: string;
  expiresAt: string | null;
  expectedCarrier: string | null;
  status: RmaStatus;
  notes: string | null;
}

const DIRECTION_LABEL: Record<RmaDirection, string> = {
  INBOUND_FROM_CUSTOMER: 'Customer return',
  OUTBOUND_TO_VENDOR:    'Vendor return (RTV)',
};

type DirectionFilter = 'all' | RmaDirection;

interface DispositionBacklogRow {
  serialUnitId: number;
  serialNumber: string;
  sku: string | null;
  conditionGrade: string | null;
  currentStatus: string;
  updatedAt: string;
}

export default function RmaPage() {
  const [rmas, setRmas] = useState<RmaRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [filter, setFilter] = useState<DirectionFilter>('all');
  const [backlog, setBacklog] = useState<DispositionBacklogRow[] | null>(null);

  const fetchRmas = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/rma', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setRmas(data.rmas);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'load failed';
      setError(message);
    }
  }, []);

  const fetchBacklog = useCallback(async () => {
    try {
      const res = await fetch('/api/rma/backlog?limit=25', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setBacklog(data.backlog);
    } catch {
      // Non-critical sub-resource — degrade to hidden, never fail the whole page.
      setBacklog(null);
    }
  }, []);

  useEffect(() => {
    void fetchRmas();
    void fetchBacklog();
  }, [fetchRmas, fetchBacklog]);

  const filtered = useMemo(() => {
    if (!rmas) return [];
    return filter === 'all' ? rmas : rmas.filter((r) => r.direction === filter);
  }, [rmas, filter]);

  const markReceived = async (id: number) => {
    setWorking(id);
    try {
      const res = await fetch(`/api/rma/${id}/mark-received`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      await fetchRmas();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'mark-received failed');
    } finally {
      setWorking(null);
    }
  };

  const closeRma = async (id: number) => {
    if (!window.confirm('Close this RMA? No further dispositions can be recorded against it.')) return;
    setWorking(id);
    try {
      const res = await fetch(`/api/rma/${id}/close`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      await fetchRmas();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'close failed');
    } finally {
      setWorking(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Warehouse</p>
          <h1 className="text-2xl font-bold text-slate-900">RMA queue</h1>
          <p className="mt-1 text-sm text-slate-500">
            Issued return authorizations awaiting receipt, inspection, or closure.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <NetworkChip />
          <Link href="/warehouse/rma/disposition">
            <Button variant="secondary" size="sm">
              <Barcode className="h-3.5 w-3.5" />
              Disposition station
            </Button>
          </Link>
          <Button variant="secondary" size="sm" onClick={() => void fetchRmas()}>
            Refresh
          </Button>
          <Button variant="brand" size="sm" onClick={() => setCreateOpen((v) => !v)}>
            {createOpen ? 'Cancel' : 'Issue RMA'}
          </Button>
        </div>
      </header>

      {createOpen && <CreateRmaForm onCreated={async () => { setCreateOpen(false); await fetchRmas(); }} onError={setError} />}

      {error && (
        <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {backlog != null && backlog.length > 0 && <DispositionBacklogSection rows={backlog} />}

      <div className="mb-4 inline-flex rounded-xl border border-slate-200 bg-white p-1 text-xs font-semibold">
        {(['all', 'INBOUND_FROM_CUSTOMER', 'OUTBOUND_TO_VENDOR'] as const).map((opt) => (
          // ds-raw-button: segmented direction-filter toggle (conditional active fill), not a single DS variant
          <button
            key={opt}
            type="button"
            onClick={() => setFilter(opt)}
            className={`rounded-lg px-3 py-1.5 transition-colors ${
              filter === opt ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            {opt === 'all' ? 'All' : DIRECTION_LABEL[opt]}
          </button>
        ))}
      </div>

      {rmas == null ? (
        <LoadingRow />
      ) : filtered.length === 0 ? (
        <EmptyState />
      ) : (
        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <ul className="divide-y divide-slate-100">
            {filtered.map((rma) => (
              <li key={rma.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-bold text-slate-900">{rma.rmaNumber}</span>
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${rmaStatusBadgeClass(rma.status)}`}>
                      {rma.status}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                      {DIRECTION_LABEL[rma.direction]}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-700">
                    <span>
                      <span className="text-slate-400">Authorized</span>{' '}
                      <span>{new Date(rma.authorizedAt).toLocaleString()}</span>
                    </span>
                    {rma.expectedCarrier && (
                      <span>
                        <span className="text-slate-400">Carrier</span>{' '}
                        <span className="font-semibold">{rma.expectedCarrier}</span>
                      </span>
                    )}
                    {rma.orderId && (
                      <span>
                        <span className="text-slate-400">Order</span>{' '}
                        <span className="font-mono font-semibold">#{rma.orderId}</span>
                      </span>
                    )}
                    {rma.expiresAt && (
                      <span>
                        <span className="text-slate-400">Expires</span>{' '}
                        <span>{new Date(rma.expiresAt).toLocaleDateString()}</span>
                      </span>
                    )}
                  </div>
                  {rma.notes && <p className="mt-1 max-w-2xl text-xs text-slate-500">{rma.notes}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {rma.status === 'AUTHORIZED' && (
                    <Button
                      variant="primary"
                      disabled={working === rma.id}
                      onClick={() => void markReceived(rma.id)}
                    >
                      {working === rma.id ? 'Working…' : 'Mark received'}
                    </Button>
                  )}
                  {(rma.status === 'RECEIVED' || rma.status === 'DISPOSITIONED') && (
                    <Button
                      variant="primary"
                      disabled={working === rma.id}
                      onClick={() => void closeRma(rma.id)}
                      className="bg-emerald-700 shadow-emerald-600/25 hover:bg-emerald-600 active:bg-emerald-800"
                    >
                      {working === rma.id ? 'Working…' : 'Close'}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ─── Create RMA form ─────────────────────────────────────────────────────────

interface CreateFormProps {
  onCreated: () => void | Promise<void>;
  onError: (message: string) => void;
}

function CreateRmaForm({ onCreated, onError }: CreateFormProps) {
  const [direction, setDirection] = useState<RmaDirection>('INBOUND_FROM_CUSTOMER');
  const [orderId, setOrderId] = useState('');
  const [carrier, setCarrier] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = { direction };
      const parsedOrderId = Number(orderId);
      if (Number.isFinite(parsedOrderId) && parsedOrderId > 0) body.order_id = parsedOrderId;
      if (carrier.trim()) body.expected_carrier = carrier.trim();
      if (notes.trim()) body.notes = notes.trim();

      const res = await fetch('/api/rma', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setOrderId('');
      setCarrier('');
      setNotes('');
      await onCreated();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'create failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="mb-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <p className="text-sm font-semibold text-slate-900">Issue RMA</p>
      <p className="mt-0.5 text-xs text-slate-500">Generates the next RMA-YYYY-NNNNN automatically.</p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">Direction</span>
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value as RmaDirection)}
            className="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"
          >
            <option value="INBOUND_FROM_CUSTOMER">Customer return</option>
            <option value="OUTBOUND_TO_VENDOR">Vendor return (RTV)</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">Order # (optional)</span>
          <input
            value={orderId}
            onChange={(e) => setOrderId(e.target.value.replace(/[^0-9]/g, ''))}
            inputMode="numeric"
            placeholder="18472"
            className="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">Expected carrier</span>
          <input
            value={carrier}
            onChange={(e) => setCarrier(e.target.value)}
            placeholder="UPS / USPS / FedEx"
            className="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">Notes</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Reason, context, special instructions…"
            className="w-full resize-none rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
          />
        </label>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button type="submit" variant="brand" disabled={submitting}>
          {submitting ? 'Issuing…' : 'Issue RMA'}
        </Button>
      </div>
    </form>
  );
}

// ─── Disposition backlog ─────────────────────────────────────────────────────

/**
 * Worklist of RETURNED units that have never received a disposition — the
 * Workbench half of the returns-unification Stage 4 pairing: this list is
 * pointer-driven (browse, pick), each row deep-links into the scan-driven
 * Disposition Station (`?serial=`) rather than growing an edit affordance
 * here, so the two archetypes stay split per region instead of blending.
 */
function DispositionBacklogSection({ rows }: { rows: DispositionBacklogRow[] }) {
  return (
    <section className="mb-4 overflow-hidden rounded-3xl border border-amber-200 bg-amber-50/60">
      <div className="flex items-center justify-between gap-2 px-5 py-3">
        <div className="flex items-center gap-2">
          <Clock className="h-3.5 w-3.5 text-amber-700" />
          <p className="text-xs font-black uppercase tracking-widest text-amber-800">
            Disposition backlog · {rows.length}
          </p>
        </div>
        <p className="text-xs text-amber-700/80">Returned, never dispositioned — oldest first</p>
      </div>
      <ul className="divide-y divide-amber-100 bg-white">
        {rows.map((row) => (
          <li key={row.serialUnitId}>
            <Link
              href={`/warehouse/rma/disposition?serial=${encodeURIComponent(row.serialNumber)}`}
              className="flex items-center justify-between gap-3 px-5 py-2.5 hover:bg-amber-50/50"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-mono text-sm font-bold text-slate-900">{row.serialNumber}</span>
                  {row.conditionGrade && (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-slate-600">
                      {conditionLabel(row.conditionGrade, 'compact')}
                    </span>
                  )}
                </div>
                {row.sku && <p className="truncate font-mono text-xs text-slate-400">{row.sku}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-2 text-xs text-slate-500">
                <span>{formatDistanceToNowStrict(new Date(row.updatedAt), { addSuffix: true })}</span>
                <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="grid place-items-center rounded-3xl border border-emerald-200 bg-emerald-50 px-6 py-12 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-full bg-emerald-600 text-white">
        <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <p className="mt-3 text-base font-bold text-emerald-900">No open RMAs</p>
      <p className="mt-1 text-sm text-emerald-800/80">Use "Issue RMA" above to authorize a new return.</p>
    </div>
  );
}

function LoadingRow() {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
      <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600 align-middle" />
      <span className="ml-2 align-middle">Loading RMAs…</span>
    </div>
  );
}
