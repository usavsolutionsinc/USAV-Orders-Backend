'use client';

import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Info, MapPin, Package, RotateCcw, Settings, ShoppingCart, X } from '@/components/Icons';
import { LineEditPanel } from './LineEditPanel';
import { dispatchReceivingDetailsOverlay } from '@/utils/events';
import type { ReceivingLineRow } from '@/components/station/ReceivingLinesTable';

type Variant = 'po' | 'return' | 'repair' | 'pickup';

function inferVariant(row: ReceivingLineRow): Variant {
  const t = String(row.receiving_type || 'PO').trim().toUpperCase();
  if (t === 'RETURN') return 'return';
  if (t === 'TRADE_IN' || t === 'REWORK' || t === 'REPAIR') return 'repair';
  if (t === 'PICKUP') return 'pickup';
  return 'po';
}

const VARIANTS: Record<
  Variant,
  { Icon: typeof Package; label: string; tint: string }
> = {
  po:     { Icon: MapPin,       label: 'PO',     tint: 'text-blue-600' },
  return: { Icon: RotateCcw,    label: 'Return', tint: 'text-rose-600' },
  repair: { Icon: Settings,     label: 'Repair', tint: 'text-amber-600' },
  pickup: { Icon: ShoppingCart, label: 'Pickup', tint: 'text-purple-600' },
};

interface NavState {
  currentIndex: number;
  total: number;
  canPrev: boolean;
  canNext: boolean;
}

interface Props {
  row: ReceivingLineRow;
  staffId: string;
  accordionBootstrap: 'default' | 'all';
  scanDriven: boolean;
  /** Nav state mirrored from the sidebar via `receiving-workspace-nav-state`. */
  nav: NavState | null;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}

/**
 * Right-pane focused work-item view for a single receiving line. Mirrors the
 * pattern in `ActiveOrderWorkspace` on `/tech`: sticky header (variant icon +
 * carton/line identity + prev/next + info + close) over the moved
 * `LineEditPanel` body. State (current edits, accordion toggles, audit modal)
 * lives entirely inside the panel — the workspace is the container shell.
 *
 * Closing dispatches `receiving-workspace-close`; the sidebar reacts by
 * clearing its `selectedLine`/`scanMatchedRows`/`poContext` so both panes
 * converge on an empty state.
 */
export function ReceivingLineWorkspace({
  row,
  staffId,
  accordionBootstrap,
  scanDriven,
  nav,
  onPrev,
  onNext,
  onClose,
}: Props) {
  const { Icon, label, tint } = VARIANTS[inferVariant(row)];
  const tracking = String(row.tracking_number || '').trim();
  const identity = tracking || String(row.id);
  const lineNofM =
    nav && nav.total > 1
      ? `Line ${nav.currentIndex + 1} of ${nav.total}`
      : null;

  return (
    <motion.div
      key={row.id}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="flex h-full w-full flex-col bg-gray-50"
    >
      {/* ── Sticky header — variant + identity + nav + info + close ── */}
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gray-50 ${tint}`}>
            <Icon className="h-4 w-4" />
          </span>
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="text-[9px] font-black uppercase tracking-widest text-gray-400">
              {label}
              {lineNofM ? <span className="ml-1 text-gray-500">· {lineNofM}</span> : null}
            </span>
            <span className="truncate text-[13px] font-black tracking-tight text-gray-900" title={identity}>
              {identity}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {/* Prev/next — only show when there's something to navigate to. */}
          {nav && nav.total > 1 ? (
            <>
              <button
                type="button"
                onClick={onPrev}
                disabled={!nav.canPrev}
                aria-label="Previous line"
                title="Previous line"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent active:scale-95"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={onNext}
                disabled={!nav.canNext}
                aria-label="Next line"
                title="Next line"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent active:scale-95"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <span className="mx-1 h-5 w-px bg-gray-200" aria-hidden />
            </>
          ) : null}
          {/* Info — opens the existing ReceivingDetailsStack overlay on demand. */}
          {row.receiving_id != null ? (
            <button
              type="button"
              onClick={() => dispatchReceivingDetailsOverlay(row.receiving_id as number)}
              aria-label="Open receiving details"
              title="Receiving details"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-blue-50 hover:text-blue-600 active:scale-95"
            >
              <Info className="h-4 w-4" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close workspace"
            title="Return to history"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 active:scale-95"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ── Body — LineEditPanel renders its full editor stack here ── */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <LineEditPanel
          row={row}
          staffId={staffId}
          compact={scanDriven}
          accordionBootstrap={accordionBootstrap}
          onPrev={onPrev}
          onNext={onNext}
          canPrev={nav?.canPrev ?? false}
          canNext={nav?.canNext ?? false}
          itemIndex={nav?.currentIndex}
          itemTotal={nav?.total}
          onClose={onClose}
        />
      </div>
    </motion.div>
  );
}
