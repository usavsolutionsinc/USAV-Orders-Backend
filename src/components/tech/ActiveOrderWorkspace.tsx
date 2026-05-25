'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { framerPresence, framerTransition } from '@/design-system/foundations/motion-framer';
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
          <ListingResizePanel url={listingUrl} canEmbed={canEmbedListing} />
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

/* ─────────────────────────────────────────────────────────────────────────
 *  ListingResizePanel
 *  ───────────────────────────────────────────────────────────────────────
 *  Pinned iframe section at the bottom of the workspace with a draggable
 *  splitter on top. Click-and-hold the splitter to resize the iframe; the
 *  technician can drag it taller to clear cookie banners or external
 *  modals that block the marketplace content.
 *
 *  Interaction:
 *   • Drag up   → iframe grows (detail panel above gets less room).
 *   • Drag down → iframe shrinks. Past a collapse threshold it snaps closed.
 *   • Double-click → toggles "max" (≈ viewport-200px) and "default" (≈55vh).
 *   • Chevron button → fully collapse / restore.
 *   • Keyboard: ↑/↓ resize, Home/End jump to extremes, Enter/Space toggle.
 *
 *  Height + collapsed state persist in localStorage.
 *  ─────────────────────────────────────────────────────────────────── */

const LISTING_HEIGHT_STORAGE_KEY = 'tech.listingPanel.heightPx';
const LISTING_COLLAPSED_STORAGE_KEY = 'tech.listingPanel.collapsed';
const COLLAPSE_DRAG_THRESHOLD = 80;
const MIN_OPEN_HEIGHT = 160;

function getInitialListingHeight(): number {
  if (typeof window === 'undefined') return 480;
  try {
    const stored = window.localStorage.getItem(LISTING_HEIGHT_STORAGE_KEY);
    const parsed = stored ? parseInt(stored, 10) : NaN;
    if (Number.isFinite(parsed) && parsed >= MIN_OPEN_HEIGHT) return parsed;
  } catch { /* noop */ }
  return Math.max(360, Math.floor(window.innerHeight * 0.55));
}

function getInitialListingCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(LISTING_COLLAPSED_STORAGE_KEY) === '1';
  } catch { return false; }
}

interface ListingResizePanelProps {
  url: string;
  canEmbed: boolean;
}

function ListingResizePanel({ url, canEmbed }: ListingResizePanelProps) {
  const [height, setHeight] = useState<number>(getInitialListingHeight);
  const [isCollapsed, setIsCollapsed] = useState<boolean>(getInitialListingCollapsed);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);

  useEffect(() => {
    if (isCollapsed) return;
    try { window.localStorage.setItem(LISTING_HEIGHT_STORAGE_KEY, String(height)); } catch { /* noop */ }
  }, [height, isCollapsed]);

  useEffect(() => {
    try { window.localStorage.setItem(LISTING_COLLAPSED_STORAGE_KEY, isCollapsed ? '1' : '0'); } catch { /* noop */ }
  }, [isCollapsed]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    dragRef.current = {
      startY: e.clientY,
      startHeight: isCollapsed ? MIN_OPEN_HEIGHT : height,
    };
    setIsDragging(true);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'row-resize';
  }, [height, isCollapsed]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    // Inverted axis: dragging up (smaller clientY) grows the iframe.
    const delta = dragRef.current.startY - e.clientY;
    const next = dragRef.current.startHeight + delta;
    const maxH = Math.max(MIN_OPEN_HEIGHT, window.innerHeight - 200);
    if (next < COLLAPSE_DRAG_THRESHOLD) {
      setIsCollapsed(true);
    } else {
      setIsCollapsed(false);
      setHeight(Math.min(Math.max(next, MIN_OPEN_HEIGHT), maxH));
    }
  }, []);

  const stopDrag = useCallback(() => {
    dragRef.current = null;
    setIsDragging(false);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  }, []);

  const handleDoubleClick = useCallback(() => {
    const maxH = Math.max(MIN_OPEN_HEIGHT, window.innerHeight - 200);
    const defaultH = Math.floor(window.innerHeight * 0.55);
    if (isCollapsed) {
      setIsCollapsed(false);
      setHeight(defaultH);
      return;
    }
    setHeight((prev) => (prev >= maxH - 20 ? defaultH : maxH));
  }, [isCollapsed]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 64 : 16;
    const maxH = Math.max(MIN_OPEN_HEIGHT, window.innerHeight - 200);
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIsCollapsed(false);
      setHeight((h) => Math.min(h + step, maxH));
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHeight((h) => Math.max(h - step, MIN_OPEN_HEIGHT));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setIsCollapsed(false);
      setHeight(maxH);
    } else if (e.key === 'End') {
      e.preventDefault();
      setIsCollapsed(true);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setIsCollapsed((c) => !c);
    }
  }, []);

  const effectiveHeight = isCollapsed ? 0 : height;

  return (
    <div className="flex-none border-t border-gray-200 bg-white">
      {/* Splitter — drag region. */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize listing panel (drag, or arrow keys)"
        aria-valuenow={effectiveHeight}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleKeyDown}
        className={`group/grip relative flex h-2.5 cursor-row-resize items-center justify-center border-b border-gray-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 ${
          isDragging ? 'bg-blue-100' : 'bg-gray-50 hover:bg-blue-50'
        }`}
      >
        <span
          className={`h-[3px] w-10 rounded-full transition-colors ${
            isDragging ? 'bg-blue-500' : 'bg-gray-300 group-hover/grip:bg-blue-400'
          }`}
        />
      </div>

      {/* Title strip — outside the drag region so its buttons are
          independently clickable. */}
      <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-4 py-1.5">
        <div className="flex items-center gap-1.5 text-micro font-black uppercase tracking-widest text-gray-500">
          <ExternalLink className="h-3 w-3 text-blue-500" />
          Listing preview
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
            className="text-micro font-bold text-blue-600 hover:text-blue-800"
          >
            Open externally
          </button>
          <button
            type="button"
            onClick={() => setIsCollapsed((c) => !c)}
            aria-label={isCollapsed ? 'Expand listing' : 'Collapse listing'}
            className="flex h-5 w-5 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            <ChevronDown
              className={`h-4 w-4 transition-transform ${isCollapsed ? 'rotate-180' : ''}`}
            />
          </button>
        </div>
      </div>

      {/* Iframe body */}
      <div
        style={{ height: `${effectiveHeight}px` }}
        className={`overflow-hidden bg-white ${
          isDragging ? '' : 'transition-[height] duration-200 ease-out'
        }`}
      >
        {effectiveHeight > 0 ? (
          canEmbed ? (
            <div className="h-full">
              <EmbeddedBrowser url={url} />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center px-6 py-10 text-center">
              <p className="text-label font-semibold text-gray-500">
                Listing preview is only available in the desktop app. Use{' '}
                <button
                  type="button"
                  onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
                  className="text-blue-600 underline-offset-2 hover:underline"
                >
                  Open externally
                </button>{' '}
                to view the page in a browser tab.
              </p>
            </div>
          )
        ) : null}
      </div>
    </div>
  );
}
