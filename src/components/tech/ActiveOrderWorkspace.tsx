'use client';

import { motion } from 'framer-motion';
import { framerPresence, framerTransition } from '@/design-system/foundations/motion-framer';
import ActiveStationOrderCard from '@/components/station/ActiveStationOrderCard';
import { Barcode, MapPin, Package, Settings, X } from '@/components/Icons';
import type {
  ActiveStationOrder,
  ResolvedProductManual,
} from '@/hooks/useStationTestingController';
import { stationThemeColors, getStaffThemeById } from '@/utils/staff-colors';

interface ActiveOrderWorkspaceProps {
  activeOrder: ActiveStationOrder;
  manuals: ResolvedProductManual[];
  isManualLoading: boolean;
  techId: string;
  onClose: () => void;
  onViewManual?: () => void;
  onRemoveSerial?: (serial: string, index: number) => Promise<void> | void;
}

function getVariantIcon(activeOrder: ActiveStationOrder) {
  const source = activeOrder.sourceType;
  if (source === 'fba') return { Icon: Package, tint: 'text-purple-600', label: 'FBA' };
  if (source === 'repair') return { Icon: Settings, tint: 'text-amber-600', label: 'Repair' };
  if ((activeOrder.tracking || '').toUpperCase().startsWith('RS-')) {
    return { Icon: Settings, tint: 'text-amber-600', label: 'Repair' };
  }
  return { Icon: MapPin, tint: 'text-blue-600', label: 'Order' };
}

/**
 * Focused work-item view rendered in the `/tech` right pane while an order is
 * active. Crossfades in over the global `TechTable` history (see TechDashboard)
 * — this is the master-detail "detail" surface for the tech station.
 *
 * The scan bar lives in the sidebar and stays focused; this surface should not
 * steal focus. Closing returns the pane to the history view.
 */
export function ActiveOrderWorkspace({
  activeOrder,
  manuals,
  isManualLoading,
  techId,
  onClose,
  onViewManual,
  onRemoveSerial,
}: ActiveOrderWorkspaceProps) {
  const { Icon, tint, label } = getVariantIcon(activeOrder);
  const activeColorText = stationThemeColors[getStaffThemeById(parseInt(techId, 10))].text;
  const trackingDisplay = (activeOrder.tracking || '').trim() || '—';
  const orderIdDisplay = (activeOrder.orderId || '').trim() || trackingDisplay;

  return (
    <motion.div
      key={activeOrder.tracking || activeOrder.orderId}
      initial={framerPresence.stationCard.initial}
      animate={framerPresence.stationCard.animate}
      exit={framerPresence.stationCard.exit}
      transition={framerTransition.stationCardMount}
      className="flex h-full w-full flex-col bg-gray-50"
    >
      {/* ── Sticky header — identifies the order, gives a way back to history ── */}
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gray-50 ${tint}`}>
            <Icon className="h-4 w-4" />
          </span>
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="text-[9px] font-black uppercase tracking-widest text-gray-400">
              {label} · Active
            </span>
            <span className="truncate text-[13px] font-black tracking-tight text-gray-900" title={orderIdDisplay}>
              {orderIdDisplay}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-emerald-600 ring-1 ring-inset ring-emerald-200 md:inline-flex">
            <Barcode className="h-3 w-3" />
            <span>Scan next</span>
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Return to history"
            title="Return to history"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 active:scale-95"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ── Scrollable workspace body ── */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl space-y-3 px-4 py-4">
          <ActiveStationOrderCard
            activeOrder={activeOrder}
            activeColorTextClass={activeColorText}
            resolvedManuals={manuals}
            isManualLoading={isManualLoading}
            onViewManual={onViewManual}
            onRemoveSerial={onRemoveSerial}
          />

          {/* ── Hint strip — keyboard / scanner guidance ── */}
          <div className="rounded-2xl border border-dashed border-gray-200 bg-white/60 p-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
              Next step
            </p>
            <p className="mt-1 text-[12px] font-semibold text-gray-600 leading-snug">
              Scan a serial number from the sidebar. Each scan lands here as it&rsquo;s
              recorded — the workspace closes automatically once the order is complete.
            </p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
