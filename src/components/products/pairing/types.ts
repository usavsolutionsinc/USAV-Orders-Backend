// Shared types for the Product Hub pairing surface on /products?view=pairing.

export interface PairingQueueItem {
  skuCatalogId: number;
  sku: string;
  productTitle: string | null;
  imageUrl: string | null;
  suggestionCount: number;
  topConfidence: number;
  orderCount: number;
  confirmedCount: number;
  platforms: string[];
  /** Whether the canonical catalog row is active. Inactive rows only surface via
   *  search (the default backlog is active-only) and get an "inactive" badge. */
  isActive?: boolean;
  /**
   * When the row surfaced because the search term matched an account-source
   * identifier (rather than the canonical SKU/title), this carries which one —
   * so the operator can confirm "yes, that's the Amazon ASIN I pasted". Null on
   * canonical matches and on the default backlog view.
   */
  matchedVia?: {
    platform: string;
    platformSku: string | null;
    platformItemId: string | null;
  } | null;
}

export type PairingSort = 'volume' | 'confidence' | 'count' | 'title';

export interface PairingQueueResponse {
  success: true;
  items: PairingQueueItem[];
  total: number;
  limit: number;
  offset: number;
}

/** An account-source identifier that exists in sku_platform_ids but is not yet
 *  linked to any canonical SKU. Surfaced by /api/sku-catalog/search-unmatched so
 *  the operator can pair it (or create a new Zoho SKU for it). */
export interface UnmappedPlatformId {
  platformIdRowId: number;
  platform: string;
  platformSku: string | null;
  platformItemId: string | null;
  accountName: string | null;
  suggestedTitle: string | null;
  orderCount: number;
}

export interface SearchUnmatchedResponse {
  success: true;
  query: string;
  catalogSku: { exists: boolean; id?: number; isActive?: boolean };
  unmappedPlatformIds: UnmappedPlatformId[];
}

export interface HubCandidate {
  platformIdRowId: number;
  platform: string;
  platformSku: string | null;
  platformItemId: string | null;
  accountName: string | null;
  listingTitle: string | null;
  listingUrl: string | null;
  imageUrl: string | null;
  confidence: number;
  reason: string;
  orderCount: number;
}

export interface HubConfirmed {
  platformIdRowId: number;
  platform: string;
  platformSku: string | null;
  platformItemId: string | null;
  accountName: string | null;
  listingTitle: string | null;
  listingUrl: string | null;
  imageUrl: string | null;
  confidence: number | null;
  pairedBy: number | null;
  pairedAt: string | null;
}

export interface HubSnapshot {
  success: true;
  skuCatalogId: number;
  canonicalSku: string;
  canonicalTitle: string | null;
  confirmed: Record<string, HubConfirmed[]>;
  suggestions: Record<string, HubCandidate[]>;
}

export interface PendingAction {
  kind: 'accept' | 'reject';
  candidate: HubCandidate;
}

export interface PendingUnpair {
  kind: 'unpair';
  confirmed: HubConfirmed;
}
