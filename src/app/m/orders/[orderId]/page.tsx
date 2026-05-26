'use client';

/**
 * /m/orders/[orderId] — mobile order detail.
 *
 * The destination of a successful scan from `/m/scan`. Built around the
 * single primary use case of the mobile app:
 *
 *     Scan Data Matrix / QR → land on this page → edit via bottom sheet.
 *
 * Single scroll column with a sticky "Actions" button at the bottom that
 * opens {@link OrderActionSheet}. No table, no multi-column layout — every
 * pixel is sized for one-thumb operation.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { useAuth } from '@/contexts/AuthContext';
import { OrderActionSheet } from '@/components/mobile/orders/OrderActionSheet';

interface OrderDetailApi {
  id: number;
  order_id: string;
  product_title: string | null;
  sku: string | null;
  condition: string | null;
  status: string | null;
  status_history: unknown;
  quantity: string | null;
  notes: string | null;
  account_source: string | null;
  order_date: string | null;
  created_at: string | null;
  item_number: string | null;
  shipment_id: number | null;
  customer_id: number | null;
  customer_name: string | null;
  ship_to_city: string | null;
  ship_to_state: string | null;
  ship_to_postal_code: string | null;
  ship_by_date: string | null;
  tester_id: number | null;
  packer_id: number | null;
  tracking_numbers: string[];
  serials: string[];
}

interface ActivityRow {
  event_at: string;
  work_type: string;
  status: string;
  actor_id: number | null;
  actor_name: string | null;
}

interface LookupResponse {
  ok: true;
  order: OrderDetailApi;
  activity: ActivityRow[];
}

export default function MobileOrderDetailPage() {
  const params = useParams<{ orderId: string }>();
  const router = useRouter();
  const { isLoaded, user } = useAuth();
  const orderId = params?.orderId ? decodeURIComponent(params.orderId) : '';

  const [order, setOrder] = useState<OrderDetailApi | null>(null);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'not_found' | 'error'>('loading');
  const [sheetOpen, setSheetOpen] = useState(false);

  const loadOrder = useCallback(async () => {
    if (!orderId) return;
    try {
      setLoadState('loading');
      const res = await fetch(`/api/orders/lookup/${encodeURIComponent(orderId)}`, {
        credentials: 'same-origin',
      });
      if (res.status === 404) {
        setLoadState('not_found');
        return;
      }
      if (!res.ok) {
        setLoadState('error');
        return;
      }
      const data: LookupResponse = await res.json();
      setOrder(data.order);
      setActivity(data.activity ?? []);
      setLoadState('ready');
    } catch (err) {
      console.error('[m/orders] load failed', err);
      setLoadState('error');
    }
  }, [orderId]);

  useEffect(() => {
    if (!isLoaded) return;
    if (!user) {
      router.replace(`/signin?next=/m/orders/${encodeURIComponent(orderId)}`);
      return;
    }
    void loadOrder();
  }, [isLoaded, user, orderId, router, loadOrder]);

  const shipTo = useMemo(() => {
    if (!order) return null;
    const parts = [order.ship_to_city, order.ship_to_state, order.ship_to_postal_code].filter(Boolean);
    return parts.length ? parts.join(', ') : null;
  }, [order]);

  const copyOrderId = () => {
    if (!order) return;
    navigator.clipboard?.writeText(order.order_id).then(
      () => toast.success('Order # copied'),
      () => toast.error('Copy failed'),
    );
  };

  if (!isLoaded || !user) return null;

  if (loadState === 'loading') {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center bg-white p-6 text-center">
        <p className="text-sm font-bold uppercase tracking-widest text-gray-400">Loading order…</p>
      </div>
    );
  }

  if (loadState === 'not_found') {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center bg-white p-6 text-center gap-3">
        <p className="text-base font-bold text-gray-900">Order {orderId} not found.</p>
        <p className="text-sm text-gray-500">It may have been deleted or the barcode is wrong.</p>
        <button
          type="button"
          onClick={() => router.replace('/m/scan')}
          className="mt-2 rounded-full bg-blue-600 px-5 py-2 text-sm font-bold uppercase tracking-wider text-white"
        >
          Scan again
        </button>
      </div>
    );
  }

  if (loadState === 'error' || !order) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center bg-white p-6 text-center gap-3">
        <p className="text-base font-bold text-gray-900">Couldn’t load order.</p>
        <button
          type="button"
          onClick={() => void loadOrder()}
          className="rounded-full bg-blue-600 px-5 py-2 text-sm font-bold uppercase tracking-wider text-white"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-gray-50 pb-28">
      {/* Header card */}
      <div className="bg-white px-4 pt-6 pb-4 border-b border-gray-200">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <button
              type="button"
              onClick={copyOrderId}
              className="block text-left font-mono text-xl font-black tracking-tight text-gray-900 active:opacity-60"
            >
              {order.order_id}
            </button>
            {order.product_title && (
              <p className="mt-1 text-sm font-semibold text-gray-700 line-clamp-2">{order.product_title}</p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            {order.status && <Pill tone="status">{order.status}</Pill>}
            {order.condition && <Pill tone="condition">{order.condition}</Pill>}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {order.account_source && <Badge>{order.account_source}</Badge>}
          {order.ship_by_date && <Badge>Ship by {formatDate(order.ship_by_date)}</Badge>}
          {order.sku && <Badge mono>{order.sku}</Badge>}
          {order.quantity && <Badge>Qty {order.quantity}</Badge>}
        </div>
      </div>

      {/* Customer block */}
      {(order.customer_name || shipTo) && (
        <Section title="Customer">
          {order.customer_name && (
            <p className="text-sm font-semibold text-gray-900">{order.customer_name}</p>
          )}
          {shipTo && <p className="text-sm text-gray-600">{shipTo}</p>}
        </Section>
      )}

      {/* Line item card */}
      <Section title="Item">
        <div className="space-y-1.5">
          <Row label="SKU" value={order.sku ?? '—'} mono />
          <Row label="Item #" value={order.item_number ?? '—'} mono />
          <Row label="Qty" value={order.quantity ?? '1'} />
          {order.serials.length > 0 && (
            <div>
              <p className="mt-1 text-eyebrow font-black uppercase tracking-[0.14em] text-gray-400">Serials</p>
              <ul className="mt-1 space-y-0.5">
                {order.serials.map((s) => (
                  <li key={s} className="font-mono text-xs text-gray-800">{s}</li>
                ))}
              </ul>
            </div>
          )}
          {order.tracking_numbers.length > 0 && (
            <div>
              <p className="mt-2 text-eyebrow font-black uppercase tracking-[0.14em] text-gray-400">Tracking</p>
              <ul className="mt-1 space-y-0.5">
                {order.tracking_numbers.map((t) => (
                  <li key={t} className="font-mono text-xs text-gray-800">{t}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Section>

      {order.notes && (
        <Section title="Notes">
          <p className="whitespace-pre-wrap text-sm text-gray-700">{order.notes}</p>
        </Section>
      )}

      {/* Activity strip */}
      {activity.length > 0 && (
        <Section title="Recent activity">
          <ul className="space-y-1.5">
            {activity.map((ev, i) => (
              <li key={i} className="flex items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-gray-700">{ev.work_type} · {ev.status}</span>
                <span className="text-gray-400">
                  {ev.actor_name ? `${ev.actor_name} · ` : ''}{formatDate(ev.event_at)}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Sticky action bar */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white/95 px-4 py-3 backdrop-blur-md"
           style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className="flex h-12 w-full items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 text-sm font-black uppercase tracking-wider text-white shadow-md shadow-blue-600/30 transition-transform active:scale-[0.98]"
        >
          Actions
        </button>
      </div>

      <OrderActionSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        order={{
          orderId: order.order_id,
          status: order.status,
          hasShipment: order.shipment_id != null,
          hasSerial: order.serials.length > 0,
        }}
        onMutated={() => { void loadOrder(); }}
      />
    </div>
  );
}

// ─── Tiny UI primitives ──────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-3 bg-white">
      <div className="px-4 pt-3 pb-1">
        <h3 className="text-eyebrow font-black uppercase tracking-[0.14em] text-gray-400">{title}</h3>
      </div>
      <div className="px-4 pb-4">{children}</div>
    </section>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className={`font-semibold text-gray-900 ${mono ? 'font-mono text-xs' : ''}`}>{value}</span>
    </div>
  );
}

function Pill({ tone, children }: { tone: 'status' | 'condition'; children: React.ReactNode }) {
  const cls = tone === 'status'
    ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200'
    : 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${cls}`}>
      {children}
    </span>
  );
}

function Badge({ children, mono = false }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <span className={`inline-flex items-center rounded-md bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-700 ${mono ? 'font-mono' : ''}`}>
      {children}
    </span>
  );
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return '—';
  }
}
