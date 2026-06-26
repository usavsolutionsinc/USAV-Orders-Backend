import type { ShippedOrder } from '@/types/orders';
import type { Order } from '@/components/station/upnext/upnext-types';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';
import type { ReceivingDetailsLog } from '@/components/station/receiving-details-log';

export function dispatchDashboardAndStationRefresh(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('dashboard-refresh'));
  window.dispatchEvent(new CustomEvent('usav-refresh-data'));
}

export interface ReceivingPhotoChangedPayload {
  action: 'delete' | 'upload' | 'insert' | 'update';
  photoIds?: number[];
  receivingId?: number | null;
  receivingLineIds?: number[];
  totalPhotoCount?: number | null;
}

/**
 * Browser-side photo refresh signal.
 *
 * The `receiving-photo.changed` name matches the realtime event used by the
 * receiving surfaces, while `usav-refresh-data` keeps the existing tables in
 * sync immediately after a library delete.
 */
export function dispatchReceivingPhotoChanged(payload: ReceivingPhotoChangedPayload): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('receiving-photo.changed', { detail: payload }));
  window.dispatchEvent(new CustomEvent('dashboard-refresh'));
  window.dispatchEvent(new CustomEvent('usav-refresh-data'));
}

/** Merge a single row into the dashboard pending queue cache (no full table refetch). */
export function dispatchPendingOrderRowRefetch(orderId: number): void {
  if (typeof window === 'undefined') return;
  if (!Number.isFinite(orderId) || orderId <= 0) return;
  window.dispatchEvent(new CustomEvent('dashboard-pending-order-refetch', { detail: { orderId } }));
}

export function dispatchCloseShippedDetails(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('close-shipped-details'));
}

export type ShippedDetailsContext = 'shipped' | 'queue';

export interface OpenShippedDetailsPayload {
  order: ShippedOrder;
  context?: ShippedDetailsContext;
}

export function dispatchOpenShippedDetails(order: ShippedOrder, context?: ShippedDetailsContext): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('open-shipped-details', { detail: { order, context } }));
}

export function getOpenShippedDetailsPayload(detail: unknown): OpenShippedDetailsPayload | null {
  if (!detail || typeof detail !== 'object') return null;

  const payload = detail as { order?: ShippedOrder; context?: ShippedDetailsContext };
  if (payload.order && typeof payload.order === 'object') {
    return { order: payload.order, context: payload.context };
  }

  return { order: detail as ShippedOrder };
}

export type ShippedDetailsNavigationDirection = 'up' | 'down';

export function dispatchNavigateShippedDetails(direction: ShippedDetailsNavigationDirection): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('navigate-shipped-details', { detail: { direction } }));
}

// ── SKU Stock (desktop) ─────────────────────────────────────────────────────

/** `GlobalDesktopSkuScanner` listens for this to open camera scan from Quick tools FAB. */
export const SKU_STOCK_DESKTOP_SCAN_EVENT = 'sku-stock:open-desktop-scanner';

export function dispatchSkuStockDesktopScanner(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SKU_STOCK_DESKTOP_SCAN_EVENT));
}

// ── Tech Up Next preview (right-pane workspace) ─────────────────────────────

/**
 * Selected Up Next item to preview in the `/tech` right pane. `null` clears
 * the preview and returns the pane to the global history (or the active-order
 * workspace, if one is in progress).
 */
export type UpNextPreviewPayload =
  | { kind: 'order'; order: Order }
  | null;

export function dispatchUpNextPreview(payload: UpNextPreviewPayload): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('tech-upnext-preview', { detail: payload }));
}

/**
 * Right-pane "Start" action — fired from `UpNextActionDock` when the tech
 * commits to working the previewed order. `UpNextOrder` listens and routes
 * to its existing `handleStart` so the API call + parent side-effects
 * (clear active order, kick off scan resolver) match a sidebar Start.
 */
export interface UpNextActionStartPayload {
  orderId: number;
  shipping_tracking_number: string;
  order_id: string;
}

export function dispatchUpNextActionStart(payload: UpNextActionStartPayload): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('tech-upnext-action-start', { detail: payload }));
}

/**
 * Right-pane "Out of stock" submit — `UpNextOrder` routes this to
 * `handleMissingParts`, which POSTs the reason and refreshes the queue.
 */
export interface UpNextActionOosPayload {
  orderId: number;
  reason: string;
}

export function dispatchUpNextActionOos(payload: UpNextActionOosPayload): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('tech-upnext-action-oos-set', { detail: payload }));
}

// ── Receiving right-pane workspace ──────────────────────────────────────────

/**
 * Payload for `receiving-workspace-open`. The sidebar dispatches this whenever
 * a line is selected (via row click, scan resolution, or sidebar prev/next nav)
 * so the right pane can swap from history table → focused workspace.
 *
 * - `accordionBootstrap: 'all'` opens every FlowSection on mount (used after a
 *   table row click where the operator is inspecting the full record).
 * - `scanDriven: true` puts LineEditPanel in its compact density mode (matches
 *   today's sidebar behavior for scan-resolved lines).
 */
export interface ReceivingWorkspaceOpenPayload {
  row: ReceivingLineRow;
  accordionBootstrap: 'default' | 'all';
  scanDriven: boolean;
}

export function dispatchReceivingWorkspaceOpen(
  payload: ReceivingWorkspaceOpenPayload,
): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('receiving-workspace-open', { detail: payload }),
  );
}

export function dispatchReceivingWorkspaceClose(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('receiving-workspace-close'));
}

/**
 * Nav state mirror — sidebar dispatches this whenever `scanMatchedRows` or the
 * current line index changes so the workspace header can render Prev/Next
 * chevrons + Line N of M without lifting the scanMatchedRows array up. The
 * actual prev/next handlers still live in the sidebar (they trigger
 * `receiving-select-line` via `dispatchSelectLine`).
 */
export interface ReceivingWorkspaceNavStatePayload {
  currentIndex: number;
  total: number;
  canPrev: boolean;
  canNext: boolean;
}

export function dispatchReceivingWorkspaceNavState(
  payload: ReceivingWorkspaceNavStatePayload,
): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('receiving-workspace-nav-state', { detail: payload }),
  );
}

export type ReceivingDetailsOverlayDetail = {
  receivingId: number;
  /** Row/list fields for instant overlay render before the enrich fetch lands. */
  seed?: Partial<ReceivingDetailsLog>;
};

/**
 * Surface the existing `ReceivingDetailsStack` overlay on-demand. The
 * workspace's `i` info button dispatches this; ReceivingDashboard listens and
 * mounts the overlay with the matching log.
 */
export function dispatchReceivingDetailsOverlay(
  receivingId: number,
  seed?: ReceivingDetailsOverlayDetail['seed'],
): void {
  if (typeof window === 'undefined') return;
  if (!Number.isFinite(receivingId) || receivingId <= 0) return;
  window.dispatchEvent(
    new CustomEvent('receiving-open-details-overlay', {
      detail: { receivingId, seed } satisfies ReceivingDetailsOverlayDetail,
    }),
  );
}

// ── Dashboard shipped search ─────────────────────────────────────────────────

/** When `=1`, embedded Shipped sidebar focuses search, then strips this param from the URL. */
export const DASHBOARD_SHIPPED_FOCUS_SEARCH_PARAM = 'focusShippedSearch';

export function dashboardShippedFocusSearchHref(): string {
  const p = new URLSearchParams();
  p.set('shipped', '');
  p.set(DASHBOARD_SHIPPED_FOCUS_SEARCH_PARAM, '1');
  return `/dashboard?${p.toString()}`;
}
