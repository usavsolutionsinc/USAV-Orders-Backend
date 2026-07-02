'use client';

import { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useMutation } from '@tanstack/react-query';
import { Truck, Check, Loader2, RefreshCw, Clock, AlertTriangle, Trash2 } from '@/components/Icons';
import { Button } from '@/design-system/primitives';
import { framerPresence, framerTransition } from '@/design-system/foundations/motion-framer';
import { useMotionPresence, useMotionTransition } from '@/design-system/foundations/motion-framer-hooks';
import type { ShippingRateOption } from '@/lib/shipping/shipstation/types';

interface RatesResponse {
  ok: boolean;
  rates?: ShippingRateOption[];
  invalidRates?: Array<{ carrierCode?: string | null; serviceCode?: string | null; message: string }>;
  error?: string;
  code?: string;
}

interface BuyResponse {
  ok: boolean;
  tracking?: string;
  carrier?: string;
  service?: string;
  cost?: number;
  currency?: string;
  labelId?: string;
  labelUrl?: string | null;
  shipmentId?: number | null;
  labelDocumentId?: number | null;
  warning?: string | null;
  idempotent?: boolean;
  error?: string;
}

function money(amount: number | undefined, currency = 'USD'): string {
  if (typeof amount !== 'number') return '—';
  const symbol = currency === 'USD' ? '$' : `${currency} `;
  return `${symbol}${amount.toFixed(2)}`;
}

function eta(rate: ShippingRateOption): string {
  if (typeof rate.deliveryDays === 'number' && rate.deliveryDays > 0) {
    return `${rate.deliveryDays} day${rate.deliveryDays > 1 ? 's' : ''}`;
  }
  if (rate.carrierDeliveryDays) return `${rate.carrierDeliveryDays} days`;
  if (rate.estimatedDeliveryDate) {
    const d = new Date(rate.estimatedDeliveryDate);
    if (!Number.isNaN(d.getTime())) return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  return '—';
}

interface BuyLabelSectionProps {
  orderId: number;
  orderRef: string;
  /** Called after a purchase or void so the parent refreshes the document tray. */
  onChange: () => void;
}

/**
 * Buy Label — the ShipStation rate-shop → purchase → print flow for the Outbound
 * · Labels order panel. Fetches live rates on demand, lets the operator pick one
 * (cheapest first), confirms the charge, and buys the label; the purchased label
 * + generated packing slip flow into the existing document tray + print view via
 * `onChange`. Includes an immediate void/refund on the success card.
 */
export function BuyLabelSection({ orderId, orderRef, onChange }: BuyLabelSectionProps) {
  const [selectedRateId, setSelectedRateId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [notifyCustomer, setNotifyCustomer] = useState(true);
  const [bought, setBought] = useState<BuyResponse | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidOpen, setVoidOpen] = useState(false);
  // One idempotency key per rate-shop session — a retried purchase is a no-op.
  const clientEventIdRef = useRef<string>('');

  const paneMotion = {
    ...useMotionPresence(framerPresence.workbenchPane),
    transition: useMotionTransition(framerTransition.workbenchPaneMount),
  };

  const ratesMutation = useMutation<RatesResponse, Error, void>({
    mutationFn: async () => {
      const res = await fetch('/api/outbound/rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      });
      const data = (await res.json()) as RatesResponse;
      if (!res.ok || !data.ok) throw new Error(data.error || 'Could not fetch rates.');
      return data;
    },
    onSuccess: (data) => {
      setSelectedRateId(data.rates?.[0]?.rateId ?? null);
      setConfirming(false);
      clientEventIdRef.current = crypto.randomUUID();
    },
  });

  const buyMutation = useMutation<BuyResponse, Error, ShippingRateOption>({
    mutationFn: async (rate) => {
      const res = await fetch('/api/outbound/labels/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId,
          rateId: rate.rateId,
          clientEventId: clientEventIdRef.current,
          notifyCustomer,
        }),
      });
      const data = (await res.json()) as BuyResponse;
      if (!res.ok || !data.ok) throw new Error(data.error || 'Purchase failed.');
      return data;
    },
    onSuccess: (data) => {
      setBought(data);
      setConfirming(false);
      onChange();
    },
  });

  const voidMutation = useMutation<unknown, Error, void>({
    mutationFn: async () => {
      if (!bought?.labelId) throw new Error('No label to void.');
      const res = await fetch('/api/outbound/labels/void', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId,
          labelId: bought.labelId,
          reason: voidReason.trim(),
          shipmentId: bought.shipmentId ?? undefined,
          documentId: bought.labelDocumentId ?? undefined,
        }),
      });
      const data = (await res.json()) as { ok: boolean; approved?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || 'Void declined.');
      return data;
    },
    onSuccess: () => {
      setBought(null);
      setVoidOpen(false);
      setVoidReason('');
      setSelectedRateId(null);
      ratesMutation.reset();
      onChange();
    },
  });

  const rates = ratesMutation.data?.rates ?? [];
  const invalidRates = ratesMutation.data?.invalidRates ?? [];
  const selectedRate = rates.find((r) => r.rateId === selectedRateId) ?? null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-eyebrow font-black uppercase tracking-widest text-gray-500">Buy Label</h3>
        {rates.length > 0 && !bought ? (
          <button /* ds-raw-button: custom rate-shop control (selectable rate card / micro eyebrow action) */
            type="button"
            onClick={() => ratesMutation.mutate()}
            disabled={ratesMutation.isPending}
            className="-my-0.5 flex items-center gap-1 rounded px-1.5 py-0.5 text-eyebrow font-bold uppercase tracking-widest text-gray-400 hover:bg-gray-50 hover:text-violet-600 disabled:opacity-40"
          >
            {ratesMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Refresh
          </button>
        ) : null}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {/* ── Success ───────────────────────────────────────────────────── */}
        {bought ? (
          <motion.div key="bought" {...paneMotion} className="space-y-2">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-emerald-700">
                <Check className="h-4 w-4" />
                <span className="text-caption font-bold">
                  {bought.idempotent ? 'Label already purchased' : 'Label purchased'}
                </span>
              </div>
              <dl className="mt-2 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-eyebrow font-bold uppercase tracking-widest text-emerald-700/70">Tracking</dt>
                  <dd className="truncate font-mono text-caption font-semibold text-gray-900">{bought.tracking}</dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-eyebrow font-bold uppercase tracking-widest text-emerald-700/70">Carrier</dt>
                  <dd className="text-caption font-semibold uppercase text-gray-900">{bought.carrier}</dd>
                </div>
                {typeof bought.cost === 'number' ? (
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-eyebrow font-bold uppercase tracking-widest text-emerald-700/70">Cost</dt>
                    <dd className="text-caption font-bold text-gray-900">{money(bought.cost, bought.currency)}</dd>
                  </div>
                ) : null}
              </dl>
            </div>

            {bought.warning ? (
              <div className="flex items-start gap-1.5 rounded-lg border border-dashed border-amber-200 bg-amber-50 px-3 py-2 text-eyebrow text-amber-700">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{bought.warning}</span>
              </div>
            ) : (
              <p className="text-eyebrow text-gray-400">Label + packing slip are ready — print them from the main panel.</p>
            )}

            {/* Void / refund */}
            {voidOpen ? (
              <div className="space-y-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5">
                <label className="block text-eyebrow font-black uppercase tracking-widest text-rose-700">Reason to void</label>
                <input
                  value={voidReason}
                  onChange={(e) => setVoidReason(e.target.value)}
                  placeholder="e.g. wrong service selected"
                  className="w-full rounded-lg border border-rose-200 bg-white px-2.5 py-1.5 text-caption text-gray-900 outline-none focus:border-rose-400"
                />
                {voidMutation.isError ? (
                  <p className="text-eyebrow font-bold text-rose-600">{voidMutation.error.message}</p>
                ) : null}
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => { setVoidOpen(false); setVoidReason(''); }}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    disabled={!voidReason.trim() || voidMutation.isPending}
                    icon={voidMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    onClick={() => voidMutation.mutate()}
                    className="flex-1"
                  >
                    Void label
                  </Button>
                </div>
              </div>
            ) : (
              <button /* ds-raw-button: custom rate-shop control (selectable rate card / micro eyebrow action) */
                type="button"
                onClick={() => setVoidOpen(true)}
                className="flex items-center gap-1 text-eyebrow font-bold uppercase tracking-widest text-gray-400 hover:text-rose-600"
              >
                <Trash2 className="h-3 w-3" /> Void / refund this label
              </button>
            )}
          </motion.div>
        ) : ratesMutation.isPending ? (
          /* ── Loading ────────────────────────────────────────────────── */
          <motion.div key="loading" {...paneMotion} className="flex items-center gap-2 px-1 py-3 text-caption text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin text-violet-600" /> Fetching live rates…
          </motion.div>
        ) : ratesMutation.isError ? (
          /* ── Error ──────────────────────────────────────────────────── */
          <motion.div key="error" {...paneMotion}>
            <div className="rounded-xl border border-dashed border-rose-200 bg-rose-50 px-4 py-4 text-center">
              <p className="text-caption font-semibold text-rose-700">{ratesMutation.error.message}</p>
              <button /* ds-raw-button: custom rate-shop control (selectable rate card / micro eyebrow action) */
                type="button"
                onClick={() => ratesMutation.mutate()}
                className="mt-1 text-eyebrow font-bold uppercase tracking-widest text-rose-700 hover:underline"
              >
                Try again
              </button>
            </div>
          </motion.div>
        ) : rates.length > 0 || invalidRates.length > 0 ? (
          /* ── Rate list ──────────────────────────────────────────────── */
          <motion.div key="rates" {...paneMotion} className="space-y-2">
            {rates.length === 0 ? (
              <p className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-4 text-center text-caption text-gray-500">
                No rates returned for this parcel.
              </p>
            ) : (
              <ul className="space-y-1">
                {rates.map((rate, i) => {
                  const selected = rate.rateId === selectedRateId;
                  return (
                    <li key={rate.rateId}>
                      <button /* ds-raw-button: custom rate-shop control (selectable rate card / micro eyebrow action) */
                        type="button"
                        onClick={() => setSelectedRateId(rate.rateId)}
                        className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors ${
                          selected ? 'bg-blue-50 ring-1 ring-inset ring-blue-400' : 'hover:bg-gray-50'
                        }`}
                      >
                        <Truck className={`h-4 w-4 shrink-0 ${selected ? 'text-blue-600' : 'text-gray-400'}`} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-caption font-bold text-gray-900">{rate.carrierName}</p>
                          <p className="truncate text-eyebrow font-semibold uppercase tracking-widest text-gray-500">
                            {rate.serviceName}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-caption font-black tabular-nums text-gray-900">{money(rate.amount, rate.currency)}</p>
                          <p className="flex items-center justify-end gap-0.5 text-eyebrow font-semibold text-gray-400">
                            <Clock className="h-2.5 w-2.5" /> {eta(rate)}
                          </p>
                        </div>
                        {i === 0 ? (
                          <span className="ml-1 shrink-0 rounded bg-emerald-50 px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-widest text-emerald-700 ring-1 ring-inset ring-emerald-200 leading-none">
                            Best
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {invalidRates.length > 0 ? (
              <p className="px-1 text-eyebrow text-gray-400">
                {invalidRates.length} carrier{invalidRates.length > 1 ? 's' : ''} couldn’t rate this parcel.
              </p>
            ) : null}

            {/* Buy / confirm bar */}
            {selectedRate ? (
              confirming ? (
                <div className="space-y-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2.5">
                  <p className="text-caption font-semibold text-gray-800">
                    Purchase this <span className="font-bold">{money(selectedRate.amount, selectedRate.currency)}</span>{' '}
                    {selectedRate.carrierName} {selectedRate.serviceName} label?
                  </p>
                  <label className="flex items-center gap-1.5 text-eyebrow font-semibold text-gray-600">
                    <input
                      type="checkbox"
                      checked={notifyCustomer}
                      onChange={(e) => setNotifyCustomer(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-gray-300 text-violet-600"
                    />
                    Email the customer a tracking notification
                  </label>
                  {buyMutation.isError ? (
                    <p className="text-eyebrow font-bold text-rose-600">{buyMutation.error.message}</p>
                  ) : null}
                  <div className="flex items-center gap-1.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirming(false)}
                      disabled={buyMutation.isPending}
                      className="flex-1"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      icon={buyMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      disabled={buyMutation.isPending}
                      onClick={() => selectedRate && buyMutation.mutate(selectedRate)}
                      className="flex-1 bg-violet-600 text-white hover:bg-violet-700"
                    >
                      Confirm & buy
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="primary"
                  icon={<Truck className="h-4 w-4" />}
                  onClick={() => setConfirming(true)}
                  className="w-full bg-violet-600 text-white hover:bg-violet-700"
                >
                  Buy {money(selectedRate.amount, selectedRate.currency)} label
                </Button>
              )
            ) : null}
          </motion.div>
        ) : (
          /* ── Idle ───────────────────────────────────────────────────── */
          <motion.div key="idle" {...paneMotion}>
            <Button
              type="button"
              variant="secondary"
              icon={<Truck className="h-4 w-4" />}
              onClick={() => ratesMutation.mutate()}
              className="w-full"
            >
              Get shipping rates
            </Button>
            <p className="mt-1 px-1 text-eyebrow text-gray-400">Rate-shop live carrier prices for {orderRef}.</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
