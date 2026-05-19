'use client';

import { motion } from 'framer-motion';
import {
  Info,
  MapPin,
  Package,
  RotateCcw,
  Settings,
  ShoppingCart,
} from '@/components/Icons';
import { LineEditPanel } from './LineEditPanel';
import { ReceivingProgressStepper } from './ReceivingProgressStepper';
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

// Header chip styling — text + icon tone per receiving variant. Matches the
// chip colors used by ReceivingContextCard's RECEIVING_VARIANT_THEME so the
// sticky header and the in-body context card read as one design system.
const VARIANTS: Record<
  Variant,
  { Icon: typeof Package; label: string; tint: string; chipBg: string }
> = {
  po:     { Icon: MapPin,       label: 'PO',     tint: 'text-blue-600',   chipBg: 'bg-blue-50' },
  return: { Icon: RotateCcw,    label: 'Return', tint: 'text-rose-600',   chipBg: 'bg-rose-50' },
  repair: { Icon: Settings,     label: 'Repair', tint: 'text-amber-600',  chipBg: 'bg-amber-50' },
  pickup: { Icon: ShoppingCart, label: 'Pickup', tint: 'text-purple-600', chipBg: 'bg-purple-50' },
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
  const { Icon, label, tint, chipBg } = VARIANTS[inferVariant(row)];
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
      {/* ── Sticky header ──────────────────────────────────────────────────
          Single row: variant chip + identity on the left, Info button on
          the right. The X close button is removed — the operator returns
          to history via the mode pill in the sidebar (or by clicking a
          different row), keeping the workspace persistent. */}
      <div className="z-20 shrink-0 border-b border-gray-200 bg-white shadow-[0_1px_0_rgba(15,23,42,0.04)]">
        <div className="flex min-w-0 items-center gap-2 px-4 py-2 sm:px-6">
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${chipBg} ${tint}`}>
            <Icon className="h-4 w-4" />
          </span>
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="text-[9px] font-black uppercase tracking-widest text-gray-400">
              {label}
              {lineNofM ? <span className="ml-1 text-gray-500">· {lineNofM}</span> : null}
            </span>
            <span className="truncate text-[14px] font-black tracking-tight text-gray-900" title={identity}>
              {identity}
            </span>
          </div>
          <div className="flex-1" />
          {row.receiving_id != null ? (
            <button
              type="button"
              onClick={() => dispatchReceivingDetailsOverlay(row.receiving_id as number)}
              aria-label="Open receiving details"
              title="Receiving details"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-blue-50 hover:text-blue-600 active:scale-95"
            >
              <Info className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>

      {/* Step-by-step progress stepper — derived from the row, not stored.
          Sits below the sticky header and scrolls with the page (room is
          tight on small viewports; the header carries the sticky weight). */}
      <ReceivingProgressStepper
        row={row}
        photoCount={Math.max(0, Number(row.photo_count ?? 0))}
        serialCount={Array.isArray(row.serials) ? row.serials.length : 0}
        isComplete={
          String(row.workflow_status || '').toUpperCase() === 'DONE' ||
          String(row.workflow_status || '').toUpperCase() === 'PASSED'
        }
      />

      {/* ── Body — LineEditPanel owns its own scroll + sticky action bar
          for the modern hero-column layout. We just give it min-h-0 to
          play nice with the flex column. */}
      <div className="min-h-0 flex-1 overflow-hidden">
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
