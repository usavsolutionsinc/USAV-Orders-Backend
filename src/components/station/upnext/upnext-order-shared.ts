import { AlertCircle, ClipboardList, List, Package, ShoppingCart, Wrench } from '@/components/Icons';
import type { UpNextTabId } from '@/utils/upnext-shared';

/** Tab → icon mapping for the Up Next slider (nav variant). Keeps the bar
 *  visually consistent with the global sidebar's view switcher. */
export const UP_NEXT_TAB_ICONS: Record<UpNextTabId, (props: { className?: string }) => JSX.Element> = {
  all: List,
  orders: ShoppingCart,
  fba: Package,
  repair: Wrench,
  stock: AlertCircle,
  receiving: ClipboardList,
};

/**
 * Two separate hide-sets for two different concerns. Keeping rendering logic
 * intact means flipping a single entry brings a feature back.
 *
 * `HIDDEN_PILL_IDS` — pills hidden from the slider only.
 *   - `fba` + `repair`: queued for a redesign, out of view for now.
 *   - `all` + `orders`: with FBA + Repair hidden these two pills show the
 *     same content (orders), so the second pill is redundant. The "all"
 *     view still renders below; we just don't draw the duplicate pills.
 *
 * `HIDDEN_SECTION_IDS` — sections hidden from the "all"-view section list.
 *   Only the categories whose CONTENT we don't want to render belong here
 *   (FBA + Repair). `orders` must NOT be hidden as a section, otherwise the
 *   "all" view ends up empty even though `filteredOrders` is populated —
 *   that was the bug behind "9 late but no cards".
 */
export const HIDDEN_PILL_IDS = new Set<UpNextTabId>(['fba', 'repair', 'all', 'orders']);
export const HIDDEN_SECTION_IDS = new Set<UpNextTabId>(['fba', 'repair']);

export type TabId = UpNextTabId;

export interface UpNextOrderProps {
  techId: string;
  onStart: (tracking: string) => void;
  onMissingParts: (orderId: number, reason: string) => void;
  onAllCompleted?: () => void;
  filterBarPortalRef?: React.RefObject<HTMLDivElement | null>;
}
