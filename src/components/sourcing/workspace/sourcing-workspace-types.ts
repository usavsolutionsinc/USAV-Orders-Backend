/** Types mirroring the /api/sourcing + /api/product-models API responses. */

export interface CompatiblePart {
  compatibility_id: number;
  sku_id: number;
  sku: string;
  product_title: string;
  part_role: string;
  is_oem: boolean;
  fit: string;
  lifecycle_status: string;
  on_hand: number;
  open_alert_count: number;
}

export interface LookupResult {
  resolvedBy: 'model_number' | 'serial_prefix' | 'model_name' | null;
  model: { id: number; model_number: string; model_name: string; family: string | null } | null;
  parts: CompatiblePart[];
}

export interface Candidate {
  externalId: string | null;
  title: string;
  url: string | null;
  imageUrl: string | null;
  condition: string | null;
  priceCents: number | null;
  shippingCents: number | null;
  currency: string;
  sellerName: string | null;
  raw?: unknown;
}

export interface ResearchCandidate {
  externalId: string | null;
  title: string;
  fitScore: number;
  priceScore: number;
  riskFlags: string[];
  rationale: string;
  nextAction: 'save' | 'compare' | 'skip';
}

export interface SourcingResearch {
  summary: string;
  recommendedQuery: string;
  rankedCandidates: ResearchCandidate[];
  cautions: string[];
  model: string;
}

export interface SourcingResearchResponse {
  query: string;
  total: number;
  bySource: Record<string, number>;
  results: Candidate[];
  research: SourcingResearch;
}

export interface AlertRow {
  id: number;
  sku_id: number | null;
  alert_type: string;
  severity: string;
  status: string;
  reason: string | null;
  opened_at: string;
  sku: string | null;
  product_title: string | null;
  lifecycle_status: string | null;
  replenish_target_cents: number | null;
  model_name: string | null;
  demand_source: string;
  demand_ref_type: string | null;
  demand_ref_id: number | null;
  target_qty: number | null;
  search_query: string | null;
}

export interface WatchCandidate {
  id: number;
  sku_id: number | null;
  title: string;
  url: string | null;
  image_url: string | null;
  condition: string | null;
  price_cents: number | null;
  shipping_cents: number | null;
  currency: string;
  seller_name: string | null;
  status: string;
}

export interface SavedSearch {
  id: number;
  label: string | null;
  query: string;
  sources: string[] | null;
  conditions: string[] | null;
  max_price_cents: number | null;
  cadence: string;
  is_active: boolean;
  last_run_at: string | null;
  last_hit_count: number | null;
  sku: string | null;
  product_title: string | null;
}

export interface SupplierStats {
  id: number;
  name: string;
  supplier_type: string;
  ebay_seller_id: string | null;
  rating: number | null;
  lead_time_days: number | null;
  candidate_count: number;
  acquisition_count: number;
  spend_cents: number;
  last_ordered_at: string | null;
}
