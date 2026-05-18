'use client';

import { motion } from 'framer-motion';
import { framerPresence, framerTransition } from '@/design-system/foundations/motion-framer';
import ActiveStationOrderCard from '@/components/station/ActiveStationOrderCard';
import EmbeddedBrowser from '@/components/EmbeddedBrowser';
import { Barcode, ExternalLink, MapPin, Package, Settings, X } from '@/components/Icons';
import type {
  ActiveStationOrder,
  ResolvedProductManual,
} from '@/hooks/useStationTestingController';
import { stationThemeColors, getStaffThemeById } from '@/utils/staff-colors';
import { getExternalUrlByItemNumber } from '@/hooks/useExternalItemUrl';
import { isElectron } from '@/utils/isElectron';
import { looksLikeFnsku } from '@/lib/scan-resolver';

interface ActiveOrderWorkspaceProps {
  activeOrder: ActiveStationOrder;
  manuals: ResolvedProductManual[];
  isManualLoading: boolean;
  techId: string;
  onClose: () => void;
  onViewManual?: () => void;
  onRemoveSerial?: (serial: string, index: number) => Promise<void> | void;
  /**
   * `active` — order has been scanned and is in progress (default).
   * `preview` — user clicked an Up Next card to inspect it; nothing has been
   *  scanned yet. Header changes to "Preview" and the hint strip prompts the
   *  tech to scan to start.
   */
  mode?: 'active' | 'preview';
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
 * Mirrors `externalListingUrl` from {@link ActiveStationOrderCard}: FBA → Amazon
 * keyword search, Repair → external URL by SKU, otherwise → external URL by
 * item number.
 */
function getListingUrl(activeOrder: ActiveStationOrder): string | null {
  const source = activeOrder.sourceType;
  if (
    source === 'fba' ||
    String(activeOrder.orderId || '').toUpperCase() === 'FNSKU' ||
    looksLikeFnsku(String(activeOrder.fnsku || ''))
  ) {
    const fnsku = String(activeOrder.fnsku || '').trim();
    if (fnsku) return `https://www.amazon.com/s?k=${encodeURIComponent(fnsku)}`;
    return null;
  }
  if (source === 'repair' || /^RS-/i.test(String(activeOrder.orderId || ''))) {
    return getExternalUrlByItemNumber(activeOrder.sku);
  }
  return getExternalUrlByItemNumber(activeOrder.itemNumber);
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
  mode = 'active',
}: ActiveOrderWorkspaceProps) {
  const { Icon, tint, label } = getVariantIcon(activeOrder);
  const activeColorText = stationThemeColors[getStaffThemeById(parseInt(techId, 10))].text;
  const trackingDisplay = (activeOrder.tracking || '').trim() || '—';
  const orderIdDisplay = (activeOrder.orderId || '').trim() || trackingDisplay;
  const isPreview = mode === 'preview';
  const stateLabel = isPreview ? 'Preview' : 'Active';
  const listingUrl = getListingUrl(activeOrder);
  // <webview> only works in Electron; for the browser build we degrade to a
  // "open externally" affordance so the section still has value.
  const canEmbedListing = listingUrl != null && isElectron();

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
              {label} · {stateLabel}
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

      {/* ── Workspace body — card column on top, embedded listing fills the
            remaining vertical space below. On Electron the listing is a live
            <webview>; on web we fall back to an external-open card. ── */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mx-auto w-full max-w-2xl space-y-3 px-4 pt-4 pb-3">
          <ActiveStationOrderCard
            activeOrder={activeOrder}
            activeColorTextClass={activeColorText}
            resolvedManuals={manuals}
            isManualLoading={isManualLoading}
            onViewManual={onViewManual}
            onRemoveSerial={onRemoveSerial}
          />

          {/* ── Hint strip — different ask depending on workspace state ── */}
          <div className="rounded-2xl border border-dashed border-gray-200 bg-white/60 p-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
              Next step
            </p>
            <p className="mt-1 text-[12px] font-semibold text-gray-600 leading-snug">
              {isPreview
                ? 'Scan the tracking label or click Start on the sidebar card to begin testing this order.'
                : 'Scan a serial number from the sidebar. Each scan lands here as it’s recorded — the workspace closes automatically once the order is complete.'}
            </p>
          </div>
        </div>

        {/* ── Embedded listing — fills the remaining height. The tech can
              browse the marketplace page inline without leaving the workspace. ── */}
        {listingUrl ? (
          <div className="flex min-h-0 flex-1 flex-col border-t border-gray-200 bg-white">
            <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-4 py-2">
              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-500">
                <ExternalLink className="h-3.5 w-3.5 text-blue-500" />
                Listing
              </div>
              <button
                type="button"
                onClick={() => window.open(listingUrl, '_blank', 'noopener,noreferrer')}
                className="text-[10px] font-black uppercase tracking-widest text-blue-600 hover:text-blue-800"
              >
                Open externally
              </button>
            </div>
            {canEmbedListing ? (
              <div className="min-h-0 flex-1">
                <EmbeddedBrowser url={listingUrl} />
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center px-6 py-10 text-center">
                <p className="text-[12px] font-semibold text-gray-500">
                  Listing preview is only available in the desktop app. Use{' '}
                  <button
                    type="button"
                    onClick={() => window.open(listingUrl, '_blank', 'noopener,noreferrer')}
                    className="text-blue-600 underline-offset-2 hover:underline"
                  >
                    Open externally
                  </button>{' '}
                  to view the page in a browser tab.
                </p>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </motion.div>
  );
}
