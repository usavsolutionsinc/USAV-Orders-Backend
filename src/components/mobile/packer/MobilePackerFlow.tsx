'use client';

import { useCallback, useReducer, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Package,
  ClipboardList,
  ShieldCheck,
  Loader2,
  ChevronLeft,
  MapPin,
} from '@/components/Icons';
import { TOKENS, SectionHeader } from '@/components/mobile/redesign/DesignSystem';
import { ScanInput } from '@/components/mobile/redesign/ScanInput';
import {
  OrderIdChip,
  TrackingChip,
  SerialChip,
  SkuScanRefChip,
  getLast4,
} from '@/components/ui/CopyChip';
import { conditionGradeTableLabel } from '@/components/station/receiving-constants';
import { resolveTestingScan } from '@/lib/testing/resolve-testing-scan';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';
import {
  packScanReducer,
  classifyPackScan,
  INITIAL_PACK_SCAN_STATE,
} from '@/lib/packer/pack-scan-machine';

/**
 * /m/pack — Mobile packer flow with scan-driven auto-progression (P1-MOB-01).
 *
 * A phone-legible packer workflow that auto-progresses on the two scan states:
 *
 *   scan 1 (order# / tracking)  →  ORDER DETAILS  (who/what/where to ship)
 *   scan 2 (product / SKU label) → WHAT TO PACK    (the pre-packed line for the SKU)
 *
 * The progression is driven by {@link packScanReducer} (two-step state machine)
 * + {@link classifyPackScan} (order-vs-product classifier composed from the
 * existing scan classifiers). The QR/manual scan surface is the canonical
 * {@link ScanInput} (StationScanBar + ZXing camera viewfinder). The "what to
 * pack" resolve REUSES the P1-PCK-01 read-only pre-pack lookup
 * `resolveTestingScan(value, { forcedType: 'sku' })` — it never mints or mutates
 * a serial. Order details come from the org-scoped `/api/orders/lookup/:id`
 * endpoint (same VM the mobile order-detail page uses).
 *
 * Viewable for BOTH packer and tech: gated only by the page's existing
 * `sku_stock.view` read permission (the lookup + resolve endpoints), so a tech
 * can pull up the same packing list on their phone.
 */

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
  shipByDate: string | null;
  serials: string[];
  trackingNumbers: string[];
}

function joinAddress(...parts: Array<string | null | undefined>): string | null {
  const a = parts.filter(Boolean).join(', ').trim();
  return a.length > 0 ? a : null;
}

type AsyncState = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

export function MobilePackerFlow() {
  const [machine, dispatchMachine] = useReducer(packScanReducer, INITIAL_PACK_SCAN_STATE);
  const inFlight = useRef(false);

  // Scan 1 → order details VM.
  const [order, setOrder] = useState<OrderVM | null>(null);
  const [orderState, setOrderState] = useState<AsyncState>('idle');

  // Scan 2 → what-to-pack receiving line(s) (pre-pack resolve, read-only).
  const [packLines, setPackLines] = useState<ReceivingLineRow[]>([]);
  const [packState, setPackState] = useState<AsyncState>('idle');
  const [lastNotFound, setLastNotFound] = useState<string | null>(null);

  // ── scan 1: resolve an order identity → order details ──────────────────────
  const loadOrder = useCallback(async (ref: string) => {
    setOrderState('loading');
    setOrder(null);
    try {
      const res = await fetch(`/api/orders/lookup/${encodeURIComponent(ref)}`, {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!res.ok) {
        setOrderState(res.status === 404 ? 'empty' : 'error');
        return;
      }
      const data = await res.json();
      const o = data.order;
      setOrder({
        id: o.id,
        orderId: o.order_id,
        status: o.status,
        product: o.product_title || 'Untitled product',
        sku: o.sku,
        quantity: Number(o.quantity) || 0,
        source: o.account_source,
        customerName: o.customer_name,
        address: joinAddress(o.ship_to_address_1, o.ship_to_city, o.ship_to_state, o.ship_to_postal_code),
        shipByDate: o.ship_by_date,
        serials: Array.isArray(o.serials) ? o.serials : [],
        trackingNumbers: Array.isArray(o.tracking_numbers) ? o.tracking_numbers : [],
      });
      setOrderState('ready');
    } catch {
      setOrderState('error');
    }
  }, []);

  // ── scan 2: resolve a product SKU/label → its pre-packed receiving line(s) ──
  // REUSE of the P1-PCK-01 read-only pre-pack resolve. `forcedType: 'sku'` makes
  // it search ONLY the product-SKU path and never mint/mutate a serial.
  const loadPack = useCallback(async (ref: string) => {
    setPackState('loading');
    setLastNotFound(null);
    try {
      const result = await resolveTestingScan(ref, { forcedType: 'sku' });
      if (result.kind === 'line') {
        setPackLines([result.row]);
        setPackState('ready');
      } else if (result.kind === 'multi') {
        setPackLines(result.rows);
        setPackState('ready');
      } else if (result.kind === 'not_found') {
        setPackLines([]);
        setLastNotFound(result.query);
        setPackState('empty');
      } else {
        setPackLines([]);
        setPackState('error');
      }
    } catch {
      setPackLines([]);
      setPackState('error');
    }
  }, []);

  // ── dispatch a scan → classify → advance the machine → fire the loader ─────
  const onScan = useCallback(
    (raw: string) => {
      const value = raw.trim();
      if (!value || inFlight.current) return;
      const kind = classifyPackScan(value, machine.name);
      if (kind === 'unknown') return;

      dispatchMachine({ type: 'SCAN', raw: value, kind });

      inFlight.current = true;
      try {
        if (kind === 'order') {
          // A fresh order resets the pack step.
          setPackLines([]);
          setPackState('idle');
          void loadOrder(value);
        } else if (kind === 'product') {
          // Only meaningful once an order is anchored (machine guards this too).
          if (machine.context.orderRef != null) void loadPack(value);
        }
      } finally {
        inFlight.current = false;
      }
    },
    [machine.name, machine.context.orderRef, loadOrder, loadPack],
  );

  const goBack = useCallback(() => {
    dispatchMachine({ type: 'BACK' });
    setPackLines([]);
    setPackState('idle');
  }, []);

  const placeholder =
    machine.name === 'idle' || machine.name === 'order_details'
      ? machine.name === 'idle'
        ? 'Scan order # or tracking'
        : 'Now scan the product / SKU label'
      : 'Scan another order to start over';

  return (
    <div className={`flex h-full flex-col ${TOKENS.colors.background}`}>
      {/* Step indicator — makes the two-scan progression legible on the phone. */}
      <div className="px-4 pb-1 pt-2">
        <StepRail step={machine.name} />
      </div>

      {/* Scan surface — canonical mobile ScanInput (manual + QR camera). */}
      <div className="px-4 pb-2">
        <ScanInput onDecode={onScan} placeholder={placeholder} autoFocus />
      </div>

      {/* Progressing result area. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-24">
        <AnimatePresence mode="wait" initial={false}>
          {machine.name === 'idle' ? (
            <motion.div
              key="idle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-16 text-center opacity-50"
            >
              <ClipboardList className="mb-3 h-10 w-10 text-blue-200" />
              <p className="text-xs font-black uppercase tracking-widest text-blue-300">
                Scan an order to begin packing
              </p>
            </motion.div>
          ) : (
            <motion.div
              key="flow"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex flex-col gap-4 pt-1"
            >
              <OrderDetailsCard state={orderState} order={order} orderRef={machine.context.orderRef} />

              {machine.name === 'what_to_pack' && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2 px-1">
                    <button
                      type="button"
                      onClick={goBack}
                      aria-label="Back to order details"
                      className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-blue-500 shadow-sm ring-1 ring-blue-100 active:scale-90"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <SectionHeader title="What to pack" />
                  </div>
                  <WhatToPackCard state={packState} lines={packLines} notFound={lastNotFound} />
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/** Two-dot step rail reflecting the machine's current state. */
function StepRail({ step }: { step: 'idle' | 'order_details' | 'what_to_pack' }) {
  const orderActive = step === 'order_details' || step === 'what_to_pack';
  const packActive = step === 'what_to_pack';
  return (
    <div className="flex items-center gap-2">
      <StepPill active={orderActive} icon={ClipboardList} label="1 · Order" />
      <div className={`h-px flex-1 ${packActive ? 'bg-blue-300' : 'bg-blue-100'}`} />
      <StepPill active={packActive} icon={Package} label="2 · Pack" />
    </div>
  );
}

function StepPill({
  active,
  icon: Icon,
  label,
}: {
  active: boolean;
  icon: (p: { className?: string }) => JSX.Element;
  label: string;
}) {
  return (
    <span
      className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] transition-colors ${
        active
          ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/20'
          : 'bg-blue-50 text-blue-300'
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

/** Scan-1 result — the order to ship (customer, address, ship-by, serials). */
function OrderDetailsCard({
  state,
  order,
  orderRef,
}: {
  state: AsyncState;
  order: OrderVM | null;
  orderRef: string | null;
}) {
  if (state === 'loading') {
    return (
      <div className="flex items-center justify-center rounded-2xl bg-white py-10 shadow-sm ring-1 ring-blue-100/60">
        <Loader2 className="h-6 w-6 animate-spin text-blue-300" />
      </div>
    );
  }
  if (state === 'empty' || state === 'error' || !order) {
    return (
      <div className="rounded-2xl bg-white px-4 py-8 text-center shadow-sm ring-1 ring-rose-100">
        <p className="text-xs font-black uppercase tracking-widest text-rose-400">
          {state === 'empty' ? 'No order found for that scan' : 'Order lookup failed'}
        </p>
        {orderRef && (
          <p className="mt-1 font-mono text-[11px] text-rose-300">{orderRef}</p>
        )}
      </div>
    );
  }

  const tracking = order.trackingNumbers[0] ?? '';
  return (
    <div className="rounded-2xl bg-white p-4 shadow-[0_8px_24px_-12px_rgba(15,23,42,0.18)] ring-1 ring-blue-100/60">
      <div className="flex items-start gap-2">
        <ClipboardList className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
        <div className="min-w-0 flex-1">
          <p className="text-base font-black leading-snug tracking-tight text-blue-950">
            {order.product}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <OrderIdChip value={order.orderId} display={getLast4(order.orderId)} />
            {tracking && <TrackingChip value={tracking} display={getLast4(tracking)} />}
            {order.status && (
              <span className="rounded-lg border border-blue-100 bg-blue-50 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-blue-600">
                {order.status}
              </span>
            )}
          </div>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-blue-50 pt-3">
        <Field label="Qty" value={`${order.quantity}`} />
        <Field label="SKU" value={order.sku ?? '—'} mono />
        <Field label="Ship to" value={order.customerName ?? '—'} className="col-span-2" />
        {order.address && (
          <Field label="Address" value={order.address} className="col-span-2" icon={<MapPin className="h-3 w-3" />} />
        )}
        {order.serials.length > 0 && (
          <Field label="Serials" value={order.serials.join(', ')} mono className="col-span-2" />
        )}
      </dl>
    </div>
  );
}

/** Scan-2 result — the pre-packed receiving line(s) for the scanned SKU. */
function WhatToPackCard({
  state,
  lines,
  notFound,
}: {
  state: AsyncState;
  lines: ReceivingLineRow[];
  notFound: string | null;
}) {
  if (state === 'idle') {
    return (
      <div className="rounded-2xl bg-white px-4 py-8 text-center opacity-60 shadow-sm ring-1 ring-blue-100/60">
        <Package className="mx-auto mb-2 h-9 w-9 text-blue-200" />
        <p className="text-xs font-black uppercase tracking-widest text-blue-300">
          Scan the product label to pack
        </p>
      </div>
    );
  }
  if (state === 'loading') {
    return (
      <div className="flex items-center justify-center rounded-2xl bg-white py-10 shadow-sm ring-1 ring-blue-100/60">
        <Loader2 className="h-6 w-6 animate-spin text-blue-300" />
      </div>
    );
  }
  if (state === 'empty' || state === 'error') {
    return (
      <div className="rounded-2xl bg-white px-4 py-8 text-center shadow-sm ring-1 ring-amber-100">
        <p className="text-xs font-black uppercase tracking-widest text-amber-500">
          {state === 'empty' ? 'No pre-packed stock for that SKU' : 'Pack lookup failed'}
        </p>
        {notFound && <p className="mt-1 font-mono text-[11px] text-amber-300">{notFound}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {lines.map((line) => {
        const title =
          line.catalog_product_title || line.item_name || line.sku || `Line #${line.id}`;
        const sku = (line.sku || '').trim();
        const qty = `${line.quantity_received}/${line.quantity_expected ?? '?'}`;
        const cond = conditionGradeTableLabel(line.condition_grade);
        const serials = (line.serials ?? [])
          .map((s) => s.serial_number)
          .filter(Boolean)
          .join(', ');
        return (
          <div
            key={line.id}
            className="rounded-2xl border border-blue-100 bg-white p-4 shadow-[0_8px_24px_-12px_rgba(15,23,42,0.18)]"
          >
            <div className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
              <p className="min-w-0 flex-1 text-base font-black leading-snug tracking-tight text-blue-950">
                {title}
              </p>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 pl-6">
              <span className="text-caption font-black uppercase tracking-widest text-gray-500">
                <span className="text-gray-900">{qty}</span>
                <span className="px-1 text-gray-400">·</span>
                <span>{cond}</span>
              </span>
              {sku && <SkuScanRefChip value={sku} display={getLast4(sku)} />}
              {serials && <SerialChip value={serials} width="w-auto" />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Field({
  label,
  value,
  mono = false,
  className = '',
  icon,
}: {
  label: string;
  value: string;
  mono?: boolean;
  className?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className={className}>
      <dt className="text-[9px] font-black uppercase tracking-[0.15em] text-blue-300">{label}</dt>
      <dd
        className={`mt-0.5 flex items-center gap-1 text-sm font-bold text-blue-950 ${
          mono ? 'font-mono text-xs' : ''
        }`}
      >
        {icon}
        <span className="min-w-0 break-words">{value}</span>
      </dd>
    </div>
  );
}
