'use client';

import { useEffect, useState } from 'react';
import { ShipmentStatusBadge } from '@/components/shipping/ShipmentStatusBadge';
import { sectionLabel } from '@/design-system/tokens/typography/presets';

interface AiOrder {
  id: number;
  orderId: string;
  productTitle: string;
  sku: string | null;
  condition: string | null;
  outOfStock: string | null;
  isShipped: boolean;
  tracking: string | null;
  carrier: string | null;
  statusLabel: string | null;
  statusDescription: string | null;
  statusCategory: string | null;
  latestEventAt: string | null;
  hasException: boolean | null;
  isTerminal: boolean | null;
  deliveredAt: string | null;
  testerName: string | null;
  packerName: string | null;
  href: string;
}

/**
 * Renders order_ids parsed from an assistant answer as live, interactive rows:
 * real product title, shipment status badge, and packer/tester — each row links
 * into the dashboard. Returns null (so the caller falls back to prose) when no
 * referenced ID resolves to a real order.
 */
export default function AiOrderList({ orderIds }: { orderIds: string[] }) {
  const idsKey = orderIds.join(',');
  const [orders, setOrders] = useState<AiOrder[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch('/api/orders/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderIds }),
    })
      .then((r) => (r.ok ? r.json() : { orders: [] }))
      .then((d) => { if (alive) setOrders(Array.isArray(d.orders) ? d.orders : []); })
      .catch(() => { if (alive) setOrders([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  if (loading) {
    return (
      <div className="overflow-hidden rounded-xl border border-border-soft bg-surface-card">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3 border-b border-border-hairline px-3 py-2.5 last:border-b-0">
            <div className="h-3 w-16 animate-pulse rounded bg-surface-sunken" />
            <div className="h-3 flex-1 animate-pulse rounded bg-surface-sunken" />
            <div className="h-4 w-20 animate-pulse rounded bg-surface-sunken" />
          </div>
        ))}
      </div>
    );
  }

  if (!orders || orders.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-xl border border-border-soft bg-surface-card">
      <div className="flex items-center justify-between border-b border-border-hairline bg-surface-canvas/60 px-3 py-2">
        <span className={sectionLabel}>{orders.length} order{orders.length !== 1 ? 's' : ''}</span>
        <a
          href="/dashboard?shipped="
          className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-micro font-semibold text-blue-700 transition-colors hover:border-blue-300 hover:bg-blue-100"
        >
          Take me there
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </a>
      </div>
      <div className="divide-y divide-border-hairline">
        {orders.map((o) => (
          <a key={o.id} href={o.href} className="flex items-start gap-3 px-3 py-2.5 transition-colors hover:bg-surface-hover">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-caption font-semibold text-blue-700">#{o.orderId.slice(-8)}</span>
                {o.condition ? <span className="text-micro uppercase tracking-wide text-text-faint">{o.condition}</span> : null}
              </div>
              <p className="mt-0.5 truncate text-label text-text-default">{o.productTitle || 'Unknown product'}</p>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-micro text-text-soft">
                {o.packerName ? <span>Packed · {o.packerName}</span> : null}
                {o.testerName ? <span>Tested · {o.testerName}</span> : null}
                {o.outOfStock ? <span className="font-medium text-rose-600">Missing: {o.outOfStock}</span> : null}
              </div>
            </div>
            <div className="shrink-0 pt-0.5">
              {o.isShipped || o.statusCategory ? (
                <ShipmentStatusBadge
                  carrier={o.carrier}
                  category={o.statusCategory}
                  description={o.statusDescription}
                  latestEventAt={o.latestEventAt}
                  hasException={o.hasException}
                  isTerminal={o.isTerminal}
                />
              ) : (
                <span className="rounded bg-amber-50 px-1.5 py-0.5 text-micro font-medium text-amber-700">pending</span>
              )}
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
