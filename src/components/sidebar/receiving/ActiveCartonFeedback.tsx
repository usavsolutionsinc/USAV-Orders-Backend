'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { Barcode, Package, RotateCcw, Settings, ShoppingCart } from '@/components/Icons';
import type { ReceivingLineRow } from '@/components/station/ReceivingLinesTable';
import type { PoContext } from './receiving-sidebar-shared';

type Variant = 'po' | 'return' | 'repair' | 'pickup';

function inferVariant(line: ReceivingLineRow | null): Variant {
  const t = String(line?.receiving_type || 'PO').trim().toUpperCase();
  if (t === 'RETURN') return 'return';
  if (t === 'TRADE_IN' || t === 'REWORK' || t === 'REPAIR') return 'repair';
  if (t === 'PICKUP') return 'pickup';
  return 'po';
}

const VARIANTS: Record<
  Variant,
  { Icon: typeof Package; label: string; tint: string; ring: string; bar: string }
> = {
  po:     { Icon: Package,      label: 'PO',     tint: 'text-blue-600',   ring: 'ring-blue-200/70',   bar: 'bg-blue-500' },
  return: { Icon: RotateCcw,    label: 'Return', tint: 'text-rose-600',   ring: 'ring-rose-200/70',   bar: 'bg-rose-500' },
  repair: { Icon: Settings,     label: 'Repair', tint: 'text-amber-600',  ring: 'ring-amber-200/70',  bar: 'bg-amber-500' },
  pickup: { Icon: ShoppingCart, label: 'Pickup', tint: 'text-purple-600', ring: 'ring-purple-200/70', bar: 'bg-purple-500' },
};

function last4(s: string | null | undefined): string {
  const raw = String(s || '').trim();
  return raw ? raw.slice(-4) : '—';
}

interface Props {
  /** Active carton context — null collapses the strip entirely. */
  poContext: PoContext | null;
  /** Selected line within the carton — drives "Line N of M" and qty progress. */
  selectedLine: ReceivingLineRow | null;
  /**
   * The most-recent serial number scanned for the active carton. Briefly
   * flashed in the last row; parent clears after ~1.8s via setTimeout.
   */
  lastSerialFlash: string | null;
}

/**
 * Slim sidebar strip — the "your scan landed" affordance for the receiving
 * page. The rich workspace lives in the right pane; this gives the operator
 * carton identity + qty progress + last-serial confirmation next to the scan
 * input so their eyes don't have to leave the scanner.
 *
 * Mirrors `ActiveOrderScanFeedback` from the tech page so both surfaces share
 * the same spatial language.
 */
export function ActiveCartonFeedback({ poContext, selectedLine, lastSerialFlash }: Props) {
  return (
    <AnimatePresence initial={false}>
      {poContext ? (
        <motion.div
          key={poContext.receiving_id}
          initial={{ opacity: 0, y: -6, height: 0 }}
          animate={{ opacity: 1, y: 0, height: 'auto' }}
          exit={{ opacity: 0, y: -4, height: 0 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          className="overflow-hidden"
        >
          <FeedbackBody
            poContext={poContext}
            selectedLine={selectedLine}
            lastSerialFlash={lastSerialFlash}
          />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function FeedbackBody({ poContext, selectedLine, lastSerialFlash }: Props) {
  if (!poContext) return null;
  const variant = inferVariant(selectedLine);
  const { Icon, label, tint, ring, bar } = VARIANTS[variant];

  // Carton identity: prefer the selected line's tracking; fall back to RCV-id.
  const tracking = String(selectedLine?.tracking_number || '').trim();
  const cartonId = tracking ? last4(tracking) : `${poContext.receiving_id}`;

  // Line N of M — only meaningful when poContext has resolved sibling lines.
  const total = poContext.lines.length;
  const currentIdx = selectedLine
    ? poContext.lines.findIndex((l) => l.id === selectedLine.id)
    : -1;
  const lineNofM = selectedLine && currentIdx >= 0 && total > 1
    ? `Line ${currentIdx + 1} of ${total}`
    : null;

  // Qty progress — receiver perspective: receivd / expected on the selected line.
  // Falls back to summing all carton lines when no specific line is selected
  // so the strip still shows useful progress immediately after a tracking scan.
  const received = selectedLine
    ? selectedLine.quantity_received
    : poContext.lines.reduce((sum, l) => sum + (l.quantity_received || 0), 0);
  const expected = selectedLine
    ? selectedLine.quantity_expected ?? 0
    : poContext.lines.reduce((sum, l) => sum + (l.quantity_expected ?? 0), 0);
  const pct = expected > 0 ? Math.min(100, Math.round((received / expected) * 100)) : 0;
  const remaining = Math.max(0, expected - received);

  return (
    <div className={`rounded-xl bg-white px-2.5 py-2 ring-1 ${ring}`}>
      {/* Row 1 — identity + state pill */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Icon className={`h-3.5 w-3.5 shrink-0 ${tint}`} />
          <span className="text-eyebrow font-black uppercase tracking-widest text-gray-400">
            PACKAGE · {label}
          </span>
          <span className="truncate text-caption font-black tracking-tight text-gray-900">
            #{cartonId}
          </span>
        </div>
        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[8.5px] font-black uppercase tracking-widest text-emerald-600 ring-1 ring-inset ring-emerald-200">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Active
        </span>
      </div>

      {/* Row 2 — Line N of M (when relevant) + progress */}
      {lineNofM ? (
        <p className="mt-1 text-eyebrow font-black uppercase tracking-widest text-gray-500">
          {lineNofM}
        </p>
      ) : null}
      <div className="mt-1.5 flex items-center gap-2">
        <div className="flex-1 h-1 rounded-full bg-gray-100 overflow-hidden">
          <motion.div
            className={`h-full ${bar}`}
            initial={false}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
          />
        </div>
        <span className="shrink-0 text-micro font-black tabular-nums text-gray-700">
          {received}/{expected || '?'}
          {expected > 0 && remaining > 0 ? (
            <span className="ml-1 font-bold text-gray-400">· {remaining} left</span>
          ) : expected > 0 && remaining === 0 ? (
            <span className="ml-1 font-bold text-emerald-600">· complete</span>
          ) : null}
        </span>
      </div>

      {/* Row 3 — last serial flash */}
      <AnimatePresence initial={false}>
        {lastSerialFlash ? (
          <motion.div
            key={lastSerialFlash}
            initial={{ opacity: 0, y: -2, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="mt-1.5 flex items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-1 ring-1 ring-inset ring-emerald-200">
              <Barcode className="h-3 w-3 text-emerald-600" />
              <span className="text-eyebrow font-black uppercase tracking-widest text-emerald-600">Last</span>
              <span className="truncate font-mono text-micro font-bold text-emerald-900">{lastSerialFlash}</span>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
