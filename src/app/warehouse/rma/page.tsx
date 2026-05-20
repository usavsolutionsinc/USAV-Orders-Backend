'use client';

/**
 * /warehouse/rma — RMA authorization queue.
 *
 * Supervisor surface for Phase A5. Lists open RMAs, lets staff issue a new
 * authorization (customer return or vendor RTV), and moves each one through
 * AUTHORIZED → RECEIVED → DISPOSITIONED → CLOSED.
 *
 * Per-unit dispositions live on a future detail page; this index covers the
 * lifecycle transitions a supervisor needs at-a-glance.
 *
 * Gated server-side by INVENTORY_V2_RMA — when off the API returns 503 and
 * this page shows an explanation banner.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFeedback } from '@/hooks/useFeedback';
import { NetworkChip } from '@/components/mobile/NetworkChip';

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

const STATUS_TONE: Record<RmaStatus, string> = {
  AUTHORIZED:    'bg-amber-100   text-amber-800  border-amber-200',
  RECEIVED:      'bg-blue-100    text-blue-800   border-blue-200',
  DISPOSITIONED: 'bg-purple-100  text-purple-800 border-purple-200',
  CLOSED:        'bg-emerald-100 text-emerald-800 border-emerald-200',
  EXPIRED:       'bg-slate-200   text-slate-700  border-slate-300',
  CANCELED:      'bg-slate-100   text-slate-600  border-slate-200',
};

const DIRECTION_LABEL: Record<RmaDirection, string> = {
  INBOUND_FROM_CUSTOMER: 'Customer return',
  OUTBOUND_TO_VENDOR:    'Vendor return (RTV)',
};

type DirectionFilter = 'all' | RmaDirection;

export default function RmaPage() {
  const feedback = useFeedback();
  const [rmas, setRmas] = useState<RmaRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flagOff, setFlagOff] = useState(false);
  const [working, setWorking] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [filter, setFilter] = useState<DirectionFilter>('all');

  const fetchRmas = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/rma', { cache: 'no-store' });
      if (res.status === 503) {
        setFlagOff(true);
        setRmas([]);
        return;
      }
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setRmas(data.rmas);
      setFlagOff(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'load failed';
      setError(message);
      feedback('error');
    }
  }, [feedback]);

  useEffect(() => {
    void fetchRmas();
  }, [fetchRmas]);

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
      feedback('confirm');
      await fetchRmas();
    } catch (err) {
      feedback('error');
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
      feedback('success');
      await fetchRmas();
    } catch (err) {
      feedback('error');
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
          <button
            type="button"
            onClick={() => void fetchRmas()}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setCreateOpen((v) => !v)}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
          >
            {createOpen ? 'Cancel' : 'Issue RMA'}
          </button>
        </div>
      </header>

      {createOpen && <CreateRmaForm onCreated={async () => { setCreateOpen(false); await fetchRmas(); }} onError={setError} />}

      {flagOff && (
        <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">RMA flow is disabled.</p>
          <p className="mt-1 text-amber-800/80">
            Set <code className="font-mono">INVENTORY_V2_RMA=true</code> on the server to enable issuance and lifecycle.
          </p>
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="mb-4 inline-flex rounded-xl border border-slate-200 bg-white p-1 text-xs font-semibold">
        {(['all', 'INBOUND_FROM_CUSTOMER', 'OUTBOUND_TO_VENDOR'] as const).map((opt) => (
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
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${STATUS_TONE[rma.status]}`}>
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
                    <button
                      type="button"
                      disabled={working === rma.id}
                      onClick={() => void markReceived(rma.id)}
                      className="rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white active:bg-blue-700 disabled:opacity-50"
                    >
                      {working === rma.id ? 'Working…' : 'Mark received'}
                    </button>
                  )}
                  {(rma.status === 'RECEIVED' || rma.status === 'DISPOSITIONED') && (
                    <button
                      type="button"
                      disabled={working === rma.id}
                      onClick={() => void closeRma(rma.id)}
                      className="rounded-2xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white active:bg-emerald-800 disabled:opacity-50"
                    >
                      {working === rma.id ? 'Working…' : 'Close'}
                    </button>
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
  const feedback = useFeedback();
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
      feedback('confirm');
      setOrderId('');
      setCarrier('');
      setNotes('');
      await onCreated();
    } catch (err) {
      feedback('error');
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
        <button
          type="submit"
          disabled={submitting}
          className="rounded-2xl bg-slate-900 px-5 py-2 text-sm font-semibold text-white active:bg-slate-800 disabled:opacity-50"
        >
          {submitting ? 'Issuing…' : 'Issue RMA'}
        </button>
      </div>
    </form>
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
