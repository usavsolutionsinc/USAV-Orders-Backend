'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Barcode, MapPin, Package, Settings } from '@/components/Icons';
import type { ActiveStationOrder } from '@/hooks/useStationTestingController';
import { getOrderIdLast4 } from '@/hooks/useStationTestingController';
import { looksLikeFnsku } from '@/lib/scan-resolver';

type Variant = 'order' | 'fba' | 'repair';

function inferVariant(order: ActiveStationOrder): Variant {
  const src = order.sourceType;
  if (
    src === 'fba' ||
    String(order.orderId || '').toUpperCase() === 'FNSKU' ||
    looksLikeFnsku(String(order.fnsku || ''))
  ) return 'fba';
  if (src === 'repair' || /^RS-/i.test(String(order.orderId || ''))) return 'repair';
  return 'order';
}

const VARIANTS: Record<Variant, { Icon: typeof MapPin; label: string; tint: string; ring: string; bar: string }> = {
  order:  { Icon: MapPin,   label: 'Order',  tint: 'text-blue-600',   ring: 'ring-blue-200/70',   bar: 'bg-blue-500' },
  fba:    { Icon: Package,  label: 'FBA',    tint: 'text-purple-600', ring: 'ring-purple-200/70', bar: 'bg-purple-500' },
  repair: { Icon: Settings, label: 'Repair', tint: 'text-amber-600',  ring: 'ring-amber-200/70',  bar: 'bg-amber-500' },
};

interface Props {
  activeOrder: ActiveStationOrder | null;
}

/**
 * Slim sidebar strip — gives the tech "your scan landed" feedback right next
 * to the scan input so their eyes don't have to travel to the right pane to
 * confirm. The full workspace still lives in the right pane; this is just the
 * 0.5s-after-beep affordance.
 */
export function ActiveOrderScanFeedback({ activeOrder }: Props) {
  const [lastSerial, setLastSerial] = useState<string | null>(null);
  const prevTrackingRef = useRef<string | null>(null);
  const prevCountRef = useRef(0);

  useEffect(() => {
    if (!activeOrder) {
      prevTrackingRef.current = null;
      prevCountRef.current = 0;
      setLastSerial(null);
      return;
    }
    const tracking = activeOrder.tracking || activeOrder.orderId;
    // New order = reset, no flash.
    if (prevTrackingRef.current !== tracking) {
      prevTrackingRef.current = tracking;
      prevCountRef.current = activeOrder.serialNumbers.length;
      setLastSerial(null);
      return;
    }
    // Same order, count grew → flash the new serial.
    const next = activeOrder.serialNumbers.length;
    if (next > prevCountRef.current) {
      setLastSerial(activeOrder.serialNumbers[next - 1]);
      const t = window.setTimeout(() => setLastSerial(null), 1800);
      prevCountRef.current = next;
      return () => window.clearTimeout(t);
    }
    prevCountRef.current = next;
  }, [activeOrder]);

  return (
    <AnimatePresence initial={false}>
      {activeOrder ? (
        <motion.div
          key={activeOrder.tracking || activeOrder.orderId}
          initial={{ opacity: 0, y: -6, height: 0 }}
          animate={{ opacity: 1, y: 0, height: 'auto' }}
          exit={{ opacity: 0, y: -4, height: 0 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          className="overflow-hidden"
        >
          <FeedbackBody activeOrder={activeOrder} lastSerial={lastSerial} />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function FeedbackBody({ activeOrder, lastSerial }: { activeOrder: ActiveStationOrder; lastSerial: string | null }) {
  const variant = inferVariant(activeOrder);
  const { Icon, label, tint, ring, bar } = VARIANTS[variant];
  const qty = Math.max(1, Number(activeOrder.quantity) || 1);
  const scanned = activeOrder.serialNumbers.length;
  const remaining = Math.max(0, qty - scanned);
  const identifier =
    variant === 'fba'
      ? (activeOrder.fnsku || activeOrder.tracking || '').slice(-4) || '—'
      : getOrderIdLast4(activeOrder.orderId);
  const progressPct = Math.min(100, Math.round((scanned / qty) * 100));

  return (
    <div className={`rounded-xl bg-white px-2.5 py-2 ring-1 ${ring}`}>
      {/* Row 1 — identity + state pill */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Icon className={`h-3.5 w-3.5 shrink-0 ${tint}`} />
          <span className="text-eyebrow font-black uppercase tracking-widest text-gray-400">
            {label}
          </span>
          <span className="truncate text-caption font-black tracking-tight text-gray-900">
            #{identifier}
          </span>
        </div>
        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[8.5px] font-black uppercase tracking-widest text-emerald-600 ring-1 ring-inset ring-emerald-200">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Active
        </span>
      </div>

      {/* Row 2 — progress + remaining */}
      <div className="mt-1.5 flex items-center gap-2">
        <div className="flex-1 h-1 rounded-full bg-gray-100 overflow-hidden">
          <motion.div
            className={`h-full ${bar}`}
            initial={false}
            animate={{ width: `${progressPct}%` }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
          />
        </div>
        <span className="shrink-0 text-micro font-black tabular-nums text-gray-700">
          {scanned}/{qty}
          {remaining > 0 ? (
            <span className="ml-1 font-bold text-gray-400">· {remaining} left</span>
          ) : (
            <span className="ml-1 font-bold text-emerald-600">· complete</span>
          )}
        </span>
      </div>

      {/* Row 3 — last serial flash (only while fresh) */}
      <AnimatePresence initial={false}>
        {lastSerial ? (
          <motion.div
            key={lastSerial}
            initial={{ opacity: 0, y: -2, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="mt-1.5 flex items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-1 ring-1 ring-inset ring-emerald-200">
              <Barcode className="h-3 w-3 text-emerald-600" />
              <span className="text-eyebrow font-black uppercase tracking-widest text-emerald-600">Last</span>
              <span className="truncate font-mono text-micro font-bold text-emerald-900">{lastSerial}</span>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
