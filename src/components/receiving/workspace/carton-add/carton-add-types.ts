import { ExternalLink, Package, Search } from '@/components/Icons';

// ─── Shared types ────────────────────────────────────────────────────────────

export type CartonAddTab = 'item' | 'web' | 'box';

export interface AssignedBox {
  id: number;
  code: string;
  total: number;
  locationName: string | null;
}

/** A product chosen from the Item or Web tab — shaped for add-unmatched-line. */
export interface CartonAddSelection {
  sku_platform_id_row: number | null;
  sku_catalog_id: number | null;
  sku: string;
  item_name: string;
  image_url: string | null;
}

export interface CartonAddPopoverProps {
  /** Which tabs to show (in order). Single-tab → the tab bar is hidden. */
  tabs: CartonAddTab[];
  initialTab?: CartonAddTab;
  /** Serial-unit ids (the whole carton) for the Box tab. */
  unitIds: number[];
  /** Add a catalog/web line. Required when 'item' or 'web' is in `tabs`. */
  onAddLine?: (sel: CartonAddSelection) => Promise<void>;
  /**
   * When set, the Item/Web tabs render this reason instead of their search UI.
   * Used when adding lines isn't possible at all.
   */
  addLineDisabledReason?: string | null;
  /**
   * Optional banner shown atop the Item/Web tabs — e.g. "Adds as an off-PO
   * item" on a matched carton, so the operator knows it won't hit the Zoho PO.
   */
  addLineHint?: string | null;
  /** Report the box the carton's units landed in (Box tab). */
  onAssignedBox?: (box: AssignedBox) => void;
  onClose: () => void;
}

/** Item tab — internal catalog (Zoho items) row. */
export interface CatalogItem {
  id: number;
  sku: string | null;
  zoho_sku?: string | null;
  product_title: string;
  image_url: string | null;
}

/** Web tab — eBay Browse (external) hit. */
export interface WebHit {
  externalId: string | null;
  title: string;
  url: string | null;
  imageUrl: string | null;
  condition: 'new' | 'refurbished' | 'used' | 'for_parts' | null;
  priceCents: number | null;
}

/** Box tab — open handling unit (LPN). */
export interface OpenBox {
  id: number;
  code: string;
  location_name: string | null;
  unit_count: number;
}

export const TAB_META: Record<CartonAddTab, { label: string; Icon: typeof Package }> = {
  item: { label: 'Item', Icon: Search },
  web: { label: 'Web', Icon: ExternalLink },
  box: { label: 'Package', Icon: Package },
};

export const DEBOUNCE_MS = 220;
