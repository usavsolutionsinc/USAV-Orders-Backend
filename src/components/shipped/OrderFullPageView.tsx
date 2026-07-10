'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronLeft,
  Clock,
  Copy,
  Check,
  ExternalLink,
  FileText,
  User,
  Info,
  Boxes,
  Package,
  Loader2,
} from '@/components/Icons';
import { IconButton, Button } from '@/design-system/primitives';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import type { ShippedOrder } from '@/types/orders';
import { fetchDashboardOrderRowById } from '@/lib/dashboard-table-data';
import { getExternalUrlByItemNumber } from '@/hooks/useExternalItemUrl';
import { isFbaOrder } from '@/utils/order-platform';
import { ShippedDetailsPanelContent } from '@/components/shipped/ShippedDetailsPanelContent';
import { SectionCard } from '@/components/shipped/SectionCard';
import { OrderDocumentsSection } from '@/components/shipped/OrderDocumentsSection';
import { OrderTimelineSection } from '@/components/shipped/OrderTimelineSection';
import { CustomerDetailsTab } from '@/components/shipped/CustomerDetailsTab';
import { SerialJourneySection } from '@/components/serial/SerialJourneySection';
import {
  useShippedDetailState,
  useShippedCopyActions,
} from '@/components/shipped/details-panel/shipped-details-hooks';

/** Resolution outcome for a /o/[orderId] param. */
type Resolved =
  | { status: 'ok'; order: ShippedOrder }
  | { status: 'fba' }
  | { status: 'notfound' };

function fmtDate(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value.includes('T') ? value : value.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtMoney(amount?: string | number | null, currency?: string | null): string | null {
  if (amount == null || amount === '') return null;
  const n = typeof amount === 'number' ? amount : Number(amount);
  if (Number.isNaN(n)) return null;
  try {
    return new Intl.NumberFormat([], { style: 'currency', currency: currency || 'USD' }).format(n);
  } catch {
    return `${currency || '$'}${n.toFixed(2)}`;
  }
}

/**
 * Resolve a /o/[orderId] param (numeric pk, or a scanned order_id string) to a
 * full ShippedOrder. FBA shipments live in a different workspace — detect them so
 * the page can route there instead of dead-ending on "not found" (fetchDashboard-
 * OrderRowById filters FBA out of the orders set).
 */
async function resolveOrder(orderId: string): Promise<Resolved> {
  const raw = decodeURIComponent(orderId || '').trim();
  if (!raw) return { status: 'notfound' };

  if (/^\d+$/.test(raw)) {
    const order = await fetchDashboardOrderRowById(Number(raw));
    if (order) return { status: 'ok', order };
    // Not in the (non-FBA) orders set — probe the raw record to tell an FBA
    // shipment apart from a genuinely missing order.
    try {
      const res = await fetch(`/api/orders/${raw}`, { credentials: 'include', cache: 'no-store' });
      if (res.ok) {
        const o = (await res.json())?.order;
        if (o && isFbaOrder(o.order_id, o.account_source)) return { status: 'fba' };
      }
    } catch {
      /* fall through to not-found */
    }
    return { status: 'notfound' };
  }

  // Scanned short-links carry the human order number — resolve to a DB id via the
  // lookup endpoint, then hydrate the full row through the canonical fetch.
  try {
    const res = await fetch(`/api/orders/lookup/${encodeURIComponent(raw)}`, {
      credentials: 'include',
      cache: 'no-store',
    });
    if (!res.ok) return { status: 'notfound' };
    const o = (await res.json())?.order;
    if (!o) return { status: 'notfound' };
    if (isFbaOrder(o.order_id, o.account_source)) return { status: 'fba' };
    if (typeof o.id === 'number') {
      const order = await fetchDashboardOrderRowById(o.id);
      if (order) return { status: 'ok', order };
    }
    return { status: 'notfound' };
  } catch {
    return { status: 'notfound' };
  }
}

/** Status-pill tone by carrier/lifecycle state — the house chip pattern (bg-x-50 / text-x-700 / ring-x-200). */
function statusChipClass(shipped: ShippedOrder): string {
  const cat = String(shipped.latest_status_category ?? '').toUpperCase();
  if (shipped.is_delivered || cat === 'DELIVERED') return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
  if (shipped.has_exception || cat === 'EXCEPTION' || cat === 'RETURNED') return 'bg-rose-50 text-rose-700 ring-rose-200';
  if (shipped.is_shipped || cat === 'IN_TRANSIT' || cat === 'OUT_FOR_DELIVERY' || cat === 'ACCEPTED')
    return 'bg-blue-50 text-blue-700 ring-blue-200';
  return 'bg-surface-canvas text-text-muted ring-border-soft';
}

function SectionHeader({ icon: Icon, title }: { icon: typeof Clock; title: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <Icon className="h-3.5 w-3.5 text-text-muted" />
      <h2 className="text-eyebrow font-black uppercase tracking-widest text-text-muted">{title}</h2>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-eyebrow font-semibold uppercase tracking-widest text-text-faint">{label}</span>
      <span className="min-w-0 truncate text-right text-caption font-bold text-text-default">{value}</span>
    </div>
  );
}

/** Shared chrome: sticky sub-header with a back button and optional right slot. */
function PageHeader({ onBack, children }: { onBack: () => void; children?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-panel flex shrink-0 items-center gap-3 border-b border-border-soft bg-surface-card/90 px-6 py-3 backdrop-blur-xl">
      <IconButton
        icon={<ChevronLeft className="h-4 w-4" />}
        onClick={onBack}
        ariaLabel="Go back"
        className="rounded-md p-1.5 hover:bg-surface-sunken"
      />
      {children}
    </header>
  );
}

export function OrderFullPageView({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [resolved, setResolved] = useState<Resolved | null>(null);

  const load = useCallback(async () => {
    setResolved(await resolveOrder(orderId));
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (resolved === null) {
    return (
      <div className="flex h-full min-h-0 flex-1 items-center justify-center bg-surface-canvas">
        <span className="flex items-center gap-2 text-caption font-bold text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading order…
        </span>
      </div>
    );
  }

  if (resolved.status === 'fba') {
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col bg-surface-canvas">
        <PageHeader onBack={() => router.back()} />
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="max-w-sm rounded-xl border border-dashed border-gray-200 bg-surface-canvas px-6 py-10 text-center">
            <Package className="mx-auto mb-3 h-8 w-8 text-text-faint" />
            <p className="text-caption font-bold text-text-default">This is an Amazon FBA shipment</p>
            <p className="mt-1 text-micro font-medium text-text-muted">
              FBA shipments are managed in the FBA workspace, not the order page.
            </p>
            <div className="mt-4 flex justify-center">
              <Button
                variant="primary"
                size="md"
                icon={<ExternalLink className="h-3.5 w-3.5" />}
                onClick={() => router.push('/fba')}
              >
                Open FBA workspace
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (resolved.status === 'notfound') {
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col bg-surface-canvas">
        <PageHeader onBack={() => router.back()} />
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="rounded-xl border border-dashed border-gray-200 bg-surface-canvas px-6 py-10 text-center">
            <Package className="mx-auto mb-3 h-8 w-8 text-text-faint" />
            <p className="text-caption font-bold text-text-default">Order not found</p>
            <p className="mt-1 text-micro font-medium text-text-muted">
              Couldn&apos;t load <span className="font-mono">{orderId}</span>.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return <OrderFullPageLoaded order={resolved.order} onReload={() => void load()} />;
}

/**
 * The loaded two-column page. Holds the working copy + inline-edit save actions
 * via {@link useShippedDetailState} — the same hook the slide-over uses — so
 * shipping-field and notes edits persist identically here.
 */
function OrderFullPageLoaded({ order, onReload }: { order: ShippedOrder; onReload: () => void }) {
  const router = useRouter();
  const st = useShippedDetailState(order, onReload);
  const copy = useShippedCopyActions(st.shipped, st.shipped.order_id || String(order.id));

  const serials = useMemo(
    () =>
      [
        ...new Set(
          String(st.shipped.serial_number || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        ),
      ],
    [st.shipped.serial_number],
  );

  const statusLabel = st.shipped.latest_status_label || st.shipped.shipment_status || null;
  const listingUrl = getExternalUrlByItemNumber(st.shipped.sku);
  const sale = fmtMoney(st.shipped.sale_amount, st.shipped.currency);

  // Inline-editable shipping fields — mirrors ShippedDetailsBody so the reused
  // ShippingInformationSection renders editable inputs that save on blur.
  const editableShippingFields = {
    orderNumber: st.orderNumber,
    itemNumber: st.itemNumber,
    trackingNumber: st.shippingTrackingNumber,
    shipByDate: st.shipByDate,
    isSaving: st.isSavingInlineFields,
    isSavingShipByDate: st.isSavingShipByDate,
    onOrderNumberChange: st.setOrderNumber,
    onItemNumberChange: st.setItemNumber,
    onTrackingNumberChange: st.setShippingTrackingNumber,
    onShipByDateChange: st.setShipByDate,
    onBlur: () => { void st.saveInlineFields(); },
    onShipByDateBlur: () => { void st.saveShipByDate(st.shipByDate); },
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-surface-canvas">
      <PageHeader onBack={() => router.back()}>
        <div className="min-w-0">
          <p className="text-eyebrow font-black uppercase tracking-widest text-text-faint">Order</p>
          <HoverTooltip label={copy.copiedOrderId ? 'Copied' : 'Click to copy'} asChild>
            {/* ds-raw-button: inline click-to-copy identity value, not a CTA */}
            <button
              type="button"
              onClick={copy.handleCopyOrderId}
              className="flex items-center gap-1.5 truncate text-left text-sm font-black tracking-tight text-text-default transition-colors hover:text-blue-700"
              aria-label={`Copy ${st.shipped.order_id}`}
            >
              <span className="truncate">{st.shipped.order_id}</span>
              {copy.copiedOrderId ? (
                <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
              ) : (
                <Copy className="h-3.5 w-3.5 shrink-0 text-text-faint" />
              )}
            </button>
          </HoverTooltip>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {statusLabel ? (
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-1 text-eyebrow font-black uppercase tracking-widest ring-1 ring-inset ${statusChipClass(st.shipped)}`}
            >
              {statusLabel}
            </span>
          ) : null}
          {listingUrl ? (
            <HoverTooltip label="Open listing" asChild>
              <IconButton
                icon={<ExternalLink className="h-4 w-4" />}
                onClick={() => window.open(listingUrl, '_blank', 'noopener,noreferrer')}
                ariaLabel="Open listing in a new tab"
                className="rounded-md p-1.5 hover:bg-surface-sunken"
              />
            </HoverTooltip>
          ) : null}
        </div>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1160px] px-4 py-8 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-8">
            {/* MAIN — reuses the dormant single-scroll mode, rendered as lifted bubbles */}
            <main className="min-w-0 space-y-5">
              <ShippedDetailsPanelContent
                variant="card"
                shipped={{
                  ...st.shipped,
                  order_id: st.orderNumber,
                  item_number: st.itemNumber,
                  shipping_tracking_number: st.shippingTrackingNumber,
                }}
                durationData={{}}
                copiedAll={copy.copiedAll}
                onCopyAll={copy.handleCopyAll}
                onUpdate={onReload}
                editableShippingFields={editableShippingFields}
              />

              {st.shipped.id ? (
                <SectionCard>
                  <SectionHeader icon={FileText} title="Documents" />
                  <OrderDocumentsSection
                    orderId={Number(st.shipped.id)}
                    orderRef={st.shipped.order_id || `order-${st.shipped.id}`}
                    readOnly
                  />
                </SectionCard>
              ) : null}

              {st.shipped.id ? (
                <SectionCard>
                  <SectionHeader icon={Clock} title="Timeline" />
                  <OrderTimelineSection orderId={Number(st.shipped.id)} />
                  {serials.map((sn) => (
                    <SerialJourneySection
                      key={sn}
                      serialNumber={sn}
                      title={serials.length > 1 ? `Serial journey · ${sn}` : 'Serial journey'}
                    />
                  ))}
                </SectionCard>
              ) : null}
            </main>

            {/* RIGHT RAIL — summary + customer + editable notes */}
            <aside className="space-y-5 lg:sticky lg:top-4 lg:self-start">
              <SectionCard>
                <SectionHeader icon={Boxes} title="Order summary" />
                <div className="divide-y divide-border-soft">
                  {st.shipped.account_source ? <SummaryRow label="Channel" value={st.shipped.account_source} /> : null}
                  <SummaryRow label="Created" value={fmtDate(st.shipped.created_at)} />
                  {st.shipped.ship_by_date ? <SummaryRow label="Ship by" value={fmtDate(st.shipped.ship_by_date)} /> : null}
                  {st.shipped.quantity ? <SummaryRow label="Quantity" value={st.shipped.quantity} /> : null}
                  {st.shipped.sku ? <SummaryRow label="SKU" value={<span className="font-mono">{st.shipped.sku}</span>} /> : null}
                  {sale ? <SummaryRow label="Sale" value={sale} /> : null}
                </div>
              </SectionCard>

              <SectionCard>
                <SectionHeader icon={User} title="Customer" />
                <CustomerDetailsTab customerId={st.shipped.customer_id ?? null} />
              </SectionCard>

              <SectionCard>
                <SectionHeader icon={Info} title="Notes" />
                <textarea
                  value={st.notes}
                  onChange={(e) => st.setNotes(e.target.value)}
                  onBlur={() => { void st.handleSaveNotes(); }}
                  rows={4}
                  placeholder="Add a note…"
                  className="w-full resize-y rounded-lg border border-border-soft bg-surface-canvas px-3 py-2 text-caption font-medium text-text-default placeholder:text-text-faint focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
                {st.isSavingNotes ? (
                  <p className="mt-1 flex items-center gap-1 text-micro font-bold uppercase tracking-wide text-blue-600">
                    <Loader2 className="h-3 w-3 animate-spin" /> Saving…
                  </p>
                ) : null}
              </SectionCard>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}
