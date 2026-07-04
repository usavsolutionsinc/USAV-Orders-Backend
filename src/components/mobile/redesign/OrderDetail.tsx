'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Package,
  Clock,
  Check,
  Clipboard,
  Copy,
  X,
  ExternalLink,
} from '@/components/Icons';
import {
  MobileCard,
  TOKENS,
  BentoItem,
  SectionHeader,
  GlassButton,
} from '@/components/mobile/redesign/DesignSystem';
import { OrderIdChip, getLast4 } from '@/components/ui/CopyChip';
import { IconButton } from '@/design-system/primitives';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { getExternalUrlByItemNumber } from '@/hooks/useExternalItemUrl';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

interface ActivityEntry {
  event_at: string | null;
  work_type: string | null;
  status: string | null;
  actor_name: string | null;
}

interface OrderVM {
  id: number;
  orderId: string;
  status: string | null;
  product: string;
  sku: string | null;
  quantity: number;
  source: string | null;
  customerName: string | null;
  address: string | null;
  createdAt: string | null;
  shipByDate: string | null;
  serials: string[];
  activity: ActivityEntry[];
}

function fmtDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value.includes('T') ? value : value.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateTime(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value.includes('T') ? value : value.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} • ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function joinAddress(...parts: Array<string | null | undefined>): string | null {
  const a = parts.filter(Boolean).join(', ').trim();
  return a.length > 0 ? a : null;
}

export default function RedesignedMobileOrderDetail({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [order, setOrder] = useState<OrderVM | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  const load = useCallback(async () => {
    setState('loading');
    try {
      // The mobile detail endpoint keys on the string order_id and returns the
      // richest shape (customer, address, activity). Scan deep-links use it
      // directly; pick-queue passes the numeric pk, so fall back to the record
      // route when the string lookup misses.
      let vm: OrderVM | null = null;

      const lookupRes = await fetch(`/api/orders/lookup/${encodeURIComponent(orderId)}`, {
        credentials: 'include',
        cache: 'no-store',
      });
      if (lookupRes.ok) {
        const data = await lookupRes.json();
        const o = data.order;
        vm = {
          id: o.id,
          orderId: o.order_id,
          status: o.status,
          product: o.product_title || 'Untitled product',
          sku: o.sku,
          quantity: Number(o.quantity) || 0,
          source: o.account_source,
          customerName: o.customer_name,
          address: joinAddress(o.ship_to_city, o.ship_to_state, o.ship_to_postal_code),
          createdAt: o.created_at || o.order_date,
          shipByDate: o.ship_by_date,
          serials: Array.isArray(o.serials) ? o.serials : [],
          activity: Array.isArray(data.activity) ? data.activity : [],
        };
      } else if (/^\d+$/.test(orderId)) {
        const recRes = await fetch(`/api/orders/${orderId}`, { credentials: 'include', cache: 'no-store' });
        if (recRes.ok) {
          const data = await recRes.json();
          const o = data.order;
          if (o) {
            vm = {
              id: o.id,
              orderId: o.order_id,
              status: o.status,
              product: o.product_title || 'Untitled product',
              sku: o.sku,
              quantity: Number(o.quantity) || 0,
              source: o.account_source,
              customerName: null,
              address: null,
              createdAt: o.created_at,
              shipByDate: null,
              serials: [],
              activity: [],
            };
          }
        }
      }

      if (vm) {
        setOrder(vm);
        setState('ready');
      } else {
        setState('error');
      }
    } catch {
      setState('error');
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  const copyId = useCallback(() => {
    const id = order?.orderId || orderId;
    navigator.clipboard?.writeText(id).then(
      () => toast.success(`Copied ${id}`),
      () => toast.error('Copy failed'),
    );
  }, [order, orderId]);

  if (state === 'loading') {
    return (
      <div className={`min-h-screen ${TOKENS.colors.background} flex items-center justify-center`}>
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-100 border-t-blue-600" />
      </div>
    );
  }

  if (state === 'error' || !order) {
    return (
      <div className={`min-h-screen ${TOKENS.colors.background} px-4 pt-2`}>
        <div className="flex items-center justify-between py-2 px-1">
          <IconButton
            icon={<X className="h-5 w-5 text-blue-400" />}
            onClick={() => router.back()}
            ariaLabel="Go back"
            className="h-10 w-10 rounded-full bg-surface-card border border-blue-100 flex items-center justify-center shadow-sm"
          />
        </div>
        <MobileCard className="mt-10 py-12 text-center">
          <Package className="mx-auto mb-3 h-10 w-10 text-blue-200" />
          <p className="text-sm font-black text-blue-950">Order not found</p>
          <p className="mt-1 text-xs font-medium text-blue-700/50">
            Couldn&apos;t load <span className="font-mono">{orderId}</span>.
          </p>
        </MobileCard>
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${TOKENS.colors.background} px-4 pb-40 pt-2`}>
      {/* Header */}
      <div className="flex items-center justify-between py-2 px-1">
        <IconButton
          icon={<X className="h-5 w-5 text-blue-400" />}
          onClick={() => router.back()}
          ariaLabel="Go back"
          className="h-10 w-10 rounded-full bg-surface-card border border-blue-100 flex items-center justify-center shadow-sm"
        />
        <div className="flex items-center gap-2">
          {order.status && (
            <div className="bg-blue-50 text-blue-700 px-3 py-1.5 rounded-full text-eyebrow font-black uppercase tracking-[0.1em] border border-blue-100 shadow-sm">
              {order.status}
            </div>
          )}
          <IconButton
            icon={<Copy className="h-5 w-5 text-blue-600" />}
            onClick={copyId}
            ariaLabel="Copy order number"
            className="h-10 w-10 rounded-full bg-surface-card border border-blue-100 flex items-center justify-center shadow-sm"
          />
        </div>
      </div>

      <header className="px-1 pt-1 pb-3">
        <div className="flex items-center gap-1.5">
          <OrderIdChip value={order.orderId} display={getLast4(order.orderId)} />
          {(() => {
            const extUrl = getExternalUrlByItemNumber(order.sku);
            return (
              <HoverTooltip label={extUrl ? 'Open listing' : 'No listing link'} asChild>
                <IconButton
                  icon={<ExternalLink className="h-4 w-4 text-blue-500" />}
                  disabled={!extUrl}
                  onClick={() => extUrl && window.open(extUrl, '_blank', 'noopener,noreferrer')}
                  ariaLabel="Open listing in new tab"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-blue-50"
                />
              </HoverTooltip>
            );
          })()}
        </div>
        <p className="mt-1.5 text-sm font-medium text-blue-700/60">
          {`${order.source ? `Channel: ${order.source} • ` : ''}Created ${fmtDate(order.createdAt)}`}
        </p>
      </header>

      <div className="grid grid-cols-2 gap-4 mt-2">
        {/* Product Card */}
        <BentoItem title="Product" icon={Package} className="col-span-2" variant="glass">
          <p className="text-base font-black text-blue-950 leading-snug tracking-tight">{order.product}</p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {order.sku && (
              <span className="text-micro font-black uppercase tracking-wider bg-blue-50 text-blue-600 px-2.5 py-1 rounded-lg border border-blue-100 font-mono">
                {order.sku}
              </span>
            )}
            <span className="text-micro font-black uppercase tracking-wider bg-emerald-50 text-emerald-600 px-2.5 py-1 rounded-lg border border-emerald-100">
              {order.quantity} Unit{order.quantity === 1 ? '' : 's'}
            </span>
            {order.serials.length > 0 && (
              <span className="text-micro font-black uppercase tracking-wider bg-surface-canvas text-text-muted px-2.5 py-1 rounded-lg border border-border-soft">
                {order.serials.length} Serial{order.serials.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
        </BentoItem>

        {/* Timeline */}
        <div className="col-span-2 mt-4">
          <SectionHeader title="Activity Timeline" />
          <MobileCard className="py-5">
            {order.activity.length === 0 ? (
              <p className="py-2 text-center text-caption font-bold uppercase tracking-widest text-blue-200">
                No recorded activity yet
              </p>
            ) : (
              <div className="space-y-6">
                {order.activity.map((ev, i) => (
                  <div key={i} className="flex gap-4 items-start pl-1 relative">
                    {i < order.activity.length - 1 && (
                      <div className="absolute left-[10px] top-6 bottom-[-24px] w-px bg-blue-50" />
                    )}
                    <div className="relative mt-1 shrink-0">
                      <div className={`h-2.5 w-2.5 rounded-full ${i === 0 ? 'bg-blue-600' : 'bg-blue-100'} z-10 relative`} />
                      {i === 0 && <div className="absolute -inset-1.5 bg-blue-400/20 rounded-full animate-ping" />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-black text-blue-950 uppercase tracking-tight">
                        {[ev.work_type, ev.status].filter(Boolean).join(' · ') || 'Update'}
                      </p>
                      <p className="text-micro font-bold text-blue-300 uppercase tracking-widest mt-1 flex items-center gap-1.5">
                        <Clock className="h-3 w-3" />
                        {fmtDateTime(ev.event_at)}
                        {ev.actor_name ? ` • ${ev.actor_name}` : ''}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </MobileCard>
        </div>
      </div>

      {/* Sticky Bottom Actions — nav moved to the left drawer, so these sit on the
          bottom edge (just clearing the home-indicator safe area). */}
      <div className="fixed inset-x-0 bottom-[env(safe-area-inset-bottom)] z-sticky px-6 pb-3 pt-16 bg-gradient-to-t from-slate-50 via-slate-50/95 to-transparent pointer-events-none">
        <div className="flex gap-3 pointer-events-auto">
          <GlassButton
            variant="secondary"
            className="w-14 px-0 shadow-lg border-blue-100"
            onClick={copyId}
            icon={Clipboard}
          >
            {null}
          </GlassButton>
          <GlassButton
            variant="primary"
            className="flex-1 shadow-2xl shadow-blue-600/20"
            onClick={() => router.back()}
            icon={Check}
          >
            Done
          </GlassButton>
        </div>
      </div>
    </div>
  );
}
