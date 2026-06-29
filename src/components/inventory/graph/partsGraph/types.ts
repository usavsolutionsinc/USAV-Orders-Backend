/** Shared types for the derived (Zoho-items) parts graph view. */

export interface PartInstanceSku {
  sku: string;
  name: string;
  stockOnHand: number;
  stockAvailable: number;
}

export type PartReviewState = 'unreviewed' | 'confirmed' | 'not_a_part';

export interface PartAssignedParent {
  linkId: number;
  parentItemId: string | null;
  parentSku: string | null;
  parentName: string | null;
  qty: number;
}

export interface PartsLogicalPart {
  logicalKey: string;
  logicalLabel: string;
  base: string;
  colorLabel: string | null;
  conditionLabel: string | null;
  unknownTokens: string[];
  instanceCount: number;
  stockOnHand: number;
  stockAvailable: number;
  skus: PartInstanceSku[];
  reviewState: PartReviewState;
  assignedParents: PartAssignedParent[];
  notAPartLinkId: number | null;
}

export interface PartsBase {
  base: string;
  baseUnit: { itemId: string; sku: string; name: string } | null;
  partCount: number;
  totalInstances: number;
  totalStockOnHand: number;
  parts: PartsLogicalPart[];
}

export interface PartsGraphResponse {
  success: true;
  bases: PartsBase[];
  summary: {
    baseCount: number;
    logicalPartCount: number;
    partSkuCount: number;
    unclassifiedSkuCount: number;
    reviewedCount: number;
    needsReviewCount: number;
    notAPartCount: number;
  };
}
