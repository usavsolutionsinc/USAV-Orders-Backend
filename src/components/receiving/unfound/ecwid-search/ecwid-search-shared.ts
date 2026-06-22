export interface EcwidProductSelection {
  /** sku_platform_ids.id — the specific Ecwid listing row; null when the operator enters a title only (not in Ecwid). */
  sku_platform_id_row: number | null;
  /** sku_catalog.id — the canonical SKU (may be null if catalog row not paired yet) */
  sku_catalog_id: number | null;
  /** Display SKU shown to the operator (Ecwid platform SKU or Zoho catalog SKU); empty when title-only manual line */
  sku: string;
  item_name: string;
  image_url: string | null;
  /** Set when the row came from /api/ecwid/recent-repair-orders (-RS SKU link). */
  is_repair_service?: boolean;
  ecwid_order_id?: string;
  ecwid_product_url?: string | null;
}

/** How the unmatched-items workspace opened this popover (parent supplies when visible). */
export type EcwidProductPopoverMode = 'search' | 'repair_service';

export interface EcwidProductSearchPopoverProps {
  /**
   * Receiving id is included in the selection callback so callers can wire
   * it into POST /api/receiving/add-unmatched-line without re-threading.
   */
  receivingId: number;
  /** Catalog search (`/api/sku-catalog/search`) vs recent repair-service Ecwid picks. */
  popoverMode: EcwidProductPopoverMode;
  /** Optional initial query (e.g. parsed product title from listing URL); catalog mode only */
  initialQuery?: string;
  /**
   * Force the catalog search to a specific `searchField` and hide the
   * title/SKU toggle. Local Pickup passes `'zoho_catalog'` so titles come from
   * the Zoho `sku_catalog` (not Ecwid `display_name`). Omit for the default
   * unfound-carton behaviour (Ecwid title / SKU toggle).
   */
  searchFieldOverride?: 'zoho_catalog';
  onSelect: (selection: EcwidProductSelection) => void | Promise<void>;
  onClose: () => void;
}

export interface PlatformIdRef {
  platform: string;
  platform_sku: string | null;
  platform_item_id: string | null;
  account_name: string | null;
}

export interface SearchItem {
  id: number;
  sku: string | null;
  zoho_sku: string | null;
  product_title: string;
  image_url: string | null;
  platform_ids: PlatformIdRef[];
  /** Present when the row was loaded from /api/ecwid/recent-repair-orders */
  order_id?: string;
  order_date?: string;
  product_url?: string | null;
}

export interface SearchResponse {
  success: boolean;
  items?: SearchItem[];
  error?: string;
}

export type CatalogSearchField = 'title' | 'ecwid_sku';

export const DEBOUNCE_MS = 200;
export const MAX_RESULTS = 20;
