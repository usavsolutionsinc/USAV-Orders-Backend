'use client';

import { motion } from 'framer-motion';
import { framerPresence, framerTransition } from '@/design-system/foundations/motion-framer';
import { ListingResizePanel } from '@/components/listing/ListingResizePanel';
import { Barcode, MapPin, Package, Settings } from '@/components/Icons';
import {
  PaneHeader,
  PaneHeaderIconBadge,
  PaneHeaderLabel,
  PaneHeaderCloseButton,
} from '@/components/ui/pane-header';
import type {
  ActiveStationOrder,
  ResolvedProductManual,
} from '@/hooks/useStationTestingController';
import type { Order } from '@/components/station/upnext/upnext-types';
import { getExternalUrlByItemNumber } from '@/hooks/useExternalItemUrl';
import { isElectron } from '@/utils/isElectron';
import { looksLikeFnsku } from '@/lib/scan-resolver';
import { UpNextActionDock } from './UpNextActionDock';
import { OrderPreviewPanel } from './OrderPreviewPanel';
import { ActiveOrderBody } from './ActiveOrderBody';

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
   *  scanned yet. Header changes to "Preview" and the action dock mounts at
   *  the bottom so Start / Out of Stock are reachable here (they no longer
   *  live on the sidebar card).
   */
  mode?: 'active' | 'preview';
  /**
   * Original `Order` row backing the preview. Required in preview mode so
   * `UpNextActionDock` can dispatch action events with the right ids
   * (`ActiveStationOrder` doesn't carry the numeric row id).
   */
  previewOrder?: Order;
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
 * FBA → Amazon keyword search by FNSKU; Repair → external URL by SKU;
 * everything else → external URL by item number.
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
  previewOrder,
}: ActiveOrderWorkspaceProps) {
  const { Icon, tint, label } = getVariantIcon(activeOrder);
  const trackingDisplay = (activeOrder.tracking || '').trim() || '—';
  const orderIdDisplay = (activeOrder.orderId || '').trim() || trackingDisplay;
  const isPreview = mode === 'preview';
  const stateLabel = isPreview ? 'Preview' : 'Active';
  const listingUrl = getListingUrl(activeOrder);
  // <webview> only works in Electron; for the browser build we degrade to a
  // "open externally" affordance so the section still has value.
  const canEmbedListing = listingUrl != null && isElectron();

  // Listing iframe dimensions are controlled by the resize handle. The
  // listing pane itself manages its height + collapsed state; this parent
  // just decides whether to render the section.

  return (
    <motion.div
      key={activeOrder.tracking || activeOrder.orderId}
      initial={framerPresence.stationCard.initial}
      animate={framerPresence.stationCard.animate}
      exit={framerPresence.stationCard.exit}
      transition={framerTransition.stationCardMount}
      className={`flex h-full w-full flex-col ${isPreview ? 'bg-emerald-50/30' : 'bg-gray-50'}`}
    >
      {/* Sticky header — identifies the order, gives a way back to history. */}
      <PaneHeader
        className="border-gray-200 bg-white"
        rowClassName="px-4"
        leftSlot={
          <>
            <PaneHeaderIconBadge Icon={Icon} bg="bg-gray-50" tint={tint} size="sm" rounded="lg" />
            <PaneHeaderLabel
              eyebrow={`${label} · ${stateLabel}`}
              value={orderIdDisplay}
              valueTitle={orderIdDisplay}
              valueClassName="truncate text-sm font-black tracking-tight text-gray-900"
            />
          </>
        }
        rightSlot={
          <>
            {/* "Scan next" pill is misleading in preview (nothing has been
                scanned yet) — only show during active testing. */}
            {!isPreview && (
              <span className="hidden items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-1 text-eyebrow font-black uppercase tracking-widest text-emerald-600 ring-1 ring-inset ring-emerald-200 md:inline-flex">
                <Barcode className="h-3 w-3" />
                <span>Scan next</span>
              </span>
            )}
            <PaneHeaderCloseButton
              onClick={onClose}
              ariaLabel="Return to history"
              title="Return to history"
            />
          </>
        }
      />

      {/* ── Workspace body — split into two siblings so the detail panel
            scrolls independently above a pinned, resizable listing iframe.
            Click-and-hold the splitter to drag the iframe height. ── */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-2xl px-4 pt-5 pb-4">
            {isPreview && previewOrder ? (
              <OrderPreviewPanel order={previewOrder} />
            ) : (
              <ActiveOrderBody
                activeOrder={activeOrder}
                onRemoveSerial={onRemoveSerial}
              />
            )}
          </div>
        </div>

        {listingUrl ? (
          <ListingResizePanel
            url={listingUrl}
            canEmbed={canEmbedListing}
            storageNamespace="tech"
          />
        ) : null}
      </div>

      {/* ── Action dock — preview mode only. Hosts Start + Out of Stock so
            the sidebar card stays calm. The dock dispatches events that
            `UpNextOrder` routes to its existing handlers, preserving the
            sidebar-Start side-effects (clear active order, scan resolver). ── */}
      {isPreview && previewOrder ? (
        <UpNextActionDock order={previewOrder} />
      ) : null}
    </motion.div>
  );
}

