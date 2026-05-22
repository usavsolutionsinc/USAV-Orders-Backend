'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { framerPresence, framerTransition } from '@/design-system/foundations/motion-framer';
import ActiveStationOrderCard from '@/components/station/ActiveStationOrderCard';
import EmbeddedBrowser from '@/components/EmbeddedBrowser';
import { Barcode, ChevronDown, ExternalLink, MapPin, Package, Settings } from '@/components/Icons';
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
import { stationThemeColors, getStaffThemeById } from '@/utils/staff-colors';
import { getExternalUrlByItemNumber } from '@/hooks/useExternalItemUrl';
import { isElectron } from '@/utils/isElectron';
import { looksLikeFnsku } from '@/lib/scan-resolver';
import { UpNextActionDock } from './UpNextActionDock';
import { OrderPreviewPanel } from './OrderPreviewPanel';

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
  previewOrder,
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

  // Listing iframe is expanded by default in both preview and active modes —
  // the marketplace page is the primary context for the tech, so loading it
  // up front beats hiding it behind an extra click.
  const [showListing, setShowListing] = useState(true);

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
        rowClassName="px-4 py-2.5"
        leftSlot={
          <>
            <PaneHeaderIconBadge Icon={Icon} bg="bg-gray-50" tint={tint} size="sm" rounded="lg" />
            <PaneHeaderLabel
              eyebrow={`${label} · ${stateLabel}`}
              value={orderIdDisplay}
              valueTitle={orderIdDisplay}
              valueClassName="truncate text-[13px] font-black tracking-tight text-gray-900"
            />
          </>
        }
        rightSlot={
          <>
            {/* "Scan next" pill is misleading in preview (nothing has been
                scanned yet) — only show during active testing. */}
            {!isPreview && (
              <span className="hidden items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-emerald-600 ring-1 ring-inset ring-emerald-200 md:inline-flex">
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

      {/* ── Workspace body — preview mode uses the new focused OrderPreviewPanel
            (built for the "should I start this?" decision). Active mode keeps
            the existing testing-flow card. ── */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-4 pt-5 pb-4">
          {isPreview && previewOrder ? (
            <OrderPreviewPanel order={previewOrder} />
          ) : (
            <ActiveStationOrderCard
              activeOrder={activeOrder}
              activeColorTextClass={activeColorText}
              resolvedManuals={manuals}
              isManualLoading={isManualLoading}
              onViewManual={onViewManual}
              onRemoveSerial={onRemoveSerial}
            />
          )}
        </div>

        {/* ── Embedded listing — collapsed by default in preview (toggle
              below); expanded by default in active mode where the
              marketplace page is part of the testing flow. ── */}
        {listingUrl ? (
          <div className={`flex min-h-0 flex-col border-t border-gray-200 bg-white ${
            showListing ? 'flex-1' : 'flex-none'
          }`}>
            <button
              type="button"
              onClick={() => setShowListing((v) => !v)}
              aria-expanded={showListing}
              className="flex items-center justify-between gap-2 border-b border-gray-100 px-4 py-2.5 text-left transition-colors hover:bg-gray-50"
            >
              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-500">
                <ExternalLink className="h-3.5 w-3.5 text-blue-500" />
                Listing preview
              </div>
              <div className="flex items-center gap-3">
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    window.open(listingUrl, '_blank', 'noopener,noreferrer');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      window.open(listingUrl, '_blank', 'noopener,noreferrer');
                    }
                  }}
                  className="text-[10px] font-black uppercase tracking-widest text-blue-600 hover:text-blue-800"
                >
                  Open externally
                </span>
                <ChevronDown
                  className={`h-4 w-4 text-gray-400 transition-transform ${showListing ? 'rotate-180' : ''}`}
                />
              </div>
            </button>
            <AnimatePresence initial={false}>
              {showListing && (
                <motion.div
                  key="listing-body"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                  className="overflow-hidden"
                >
                  {canEmbedListing ? (
                    <div className="h-[55vh] min-h-[320px]">
                      <EmbeddedBrowser url={listingUrl} />
                    </div>
                  ) : (
                    <div className="flex items-center justify-center px-6 py-10 text-center">
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
                </motion.div>
              )}
            </AnimatePresence>
          </div>
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
