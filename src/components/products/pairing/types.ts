// Shared types for the Product Hub pairing surface on /products?view=pairing.

export interface PairingQueueItem {
  skuCatalogId: number;
  sku: string;
  productTitle: string | null;
  imageUrl: string | null;
  suggestionCount: number;
  topConfidence: number;
  confirmedCount: number;
  platforms: string[];
}

export interface PairingQueueResponse {
  success: true;
  items: PairingQueueItem[];
  total: number;
  limit: number;
  offset: number;
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
