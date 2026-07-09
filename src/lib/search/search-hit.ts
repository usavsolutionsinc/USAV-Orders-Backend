/**
 * SearchHit — the single tool-calling-friendly result shape every AI-search
 * consumer (CommandBar, /api/ai/retrieve, chat tools, future agents) renders.
 *
 * STRICT SUPERSET of global-search's SearchResult
 * (`{ id, entityType, title, subtitle, href, matchField }`) so CommandBar and
 * existing consumers keep working with minimal change; the additions are
 * `score`, `chips[]`, and optional `facets`/`actions`.
 *
 * Vocabulary note — two discriminator layers, one mapping (here, nowhere else):
 *   DB (entity_search_docs.entity_type, uppercase):
 *     ORDER | SERIAL_UNIT | RECEIVING | SKU | REPAIR | FBA_SHIPMENT
 *   UI (SearchHit.entityType, lowercase — matches global-search + ENTITY_ICONS):
 *     order | unit | receiving | sku | repair | fba
 */

import type { SearchEntityType } from '@/lib/search/build-search-text';

export type SearchHitEntityType = 'order' | 'unit' | 'receiving' | 'sku' | 'repair' | 'fba';

export interface SearchHitChip {
  label: string;
  /** Semantic tone key — rendered via existing chip conventions, never a hex. */
  tone?: 'gray' | 'blue' | 'emerald' | 'amber' | 'rose';
}

export interface SearchHitAction {
  type: string;
  label: string;
  payload: unknown;
}

export interface SearchHit {
  id: number;
  entityType: SearchHitEntityType;
  title: string;
  subtitle: string;
  href: string;
  matchField: string;
  score: number;
  chips: SearchHitChip[];
  /** Machine-readable facet values for follow-up filtering/tool calls. */
  facets?: Record<string, string | null>;
  actions?: SearchHitAction[];
}

const DB_TO_UI: Record<SearchEntityType, SearchHitEntityType> = {
  ORDER: 'order',
  SERIAL_UNIT: 'unit',
  RECEIVING: 'receiving',
  SKU: 'sku',
  REPAIR: 'repair',
  FBA_SHIPMENT: 'fba',
};

const UI_TO_DB: Record<SearchHitEntityType, SearchEntityType> = {
  order: 'ORDER',
  unit: 'SERIAL_UNIT',
  receiving: 'RECEIVING',
  sku: 'SKU',
  repair: 'REPAIR',
  fba: 'FBA_SHIPMENT',
};

export function toUiEntityType(dbType: SearchEntityType): SearchHitEntityType {
  return DB_TO_UI[dbType];
}

export function toDbEntityType(uiType: SearchHitEntityType): SearchEntityType {
  return UI_TO_DB[uiType];
}

export function isUiEntityType(value: string): value is SearchHitEntityType {
  return value in UI_TO_DB;
}

/**
 * Deep-link per entity — mirrors the hrefs global-search already emits so a
 * hit opens the same surface regardless of which engine produced it.
 * SERIAL_UNIT uses the inventory workbench's `?unit=` view (ByUnitView →
 * /api/serial-units/:id, which accepts the numeric id).
 */
export function searchHitHref(dbType: SearchEntityType, entityId: number): string {
  switch (dbType) {
    case 'ORDER':
      // Full-page order view (Shopify-style). The dashboard slide-over stays the
      // in-place experience (row-click + right-rail detail-stack); a search/⌘K
      // navigation deep-links to the canonical page. Keep this in sync with the
      // exact-arm href in global-entity-search.ts.
      return `/o/${entityId}`;
    case 'SERIAL_UNIT':
      return `/inventory/units?unit=${entityId}`;
    case 'RECEIVING':
      // Unbox is the first-class receiving surface (`/unbox`); it opens the
      // carton via `?openReceivingId=`.
      return `/unbox?openReceivingId=${entityId}`;
    case 'SKU':
      return `/products?view=qc&skuId=${entityId}`;
    case 'REPAIR':
      return `/repair?tab=active&openRepair=${entityId}`;
    case 'FBA_SHIPMENT':
      return `/fba?openShipmentId=${entityId}`;
  }
}

/**
 * Identifier heuristic for the exact bypass: serial / tracking / order-id /
 * numeric-id shaped input (no spaces, digit-bearing token or a pure id).
 * Natural-language queries fall through to the hybrid arms. Lives in this
 * pure module (not hybrid-retrieval) so the client — CommandBar skips its
 * redundant global-search fetch for identifier queries — can import it
 * without pulling the server-only pool/tenancy graph into the bundle.
 */
export function looksLikeIdentifier(query: string): boolean {
  const q = query.trim();
  if (!q || /\s/.test(q)) return false;
  if (/^\d{3,}$/.test(q)) return true; // bare numeric id / tracking fragment
  // Alphanumeric token with digits (serials, FNSKUs, order ids, LPNs, RS-#).
  return /^[A-Za-z0-9#:_\-\.\/]+$/.test(q) && /\d{2,}/.test(q) && q.length >= 4;
}

/**
 * AI-suggested filter application (plan §8.4, Phase 3): map an entity scope +
 * distilled query to the LIST SURFACE that can show "all matches" with the
 * query applied as its own URL filter — the Ask-AI path's toolArgs become a
 * real table/workbench filter, not just a hit list. Param names are each
 * surface's existing URL-state contract (dashboard `?search=`, inventory
 * `?q=`). Types without a URL-searchable list surface return null — the
 * action simply doesn't render (never a dead link).
 */
export function searchScopeHref(dbType: SearchEntityType, query: string): string | null {
  const q = encodeURIComponent(query.trim());
  if (!q) return null;
  switch (dbType) {
    case 'ORDER':
      return `/dashboard?search=${q}`;
    case 'SERIAL_UNIT':
      return `/inventory/units?q=${q}`;
    case 'SKU':
      return `/inventory/skus?q=${q}`;
    default:
      return null; // RECEIVING / REPAIR / FBA_SHIPMENT: no URL-searchable list yet
  }
}

/** Human label for the surface searchScopeHref targets (UI action rows). */
export function searchScopeLabel(dbType: SearchEntityType): string | null {
  switch (dbType) {
    case 'ORDER':
      return 'Shipped orders';
    case 'SERIAL_UNIT':
      return 'Inventory units';
    case 'SKU':
      return 'SKU catalog';
    default:
      return null;
  }
}

/** Chip tones keyed by facet kind — semantic families only (house chip rule). */
export function facetChips(facets: {
  status?: string | null;
  conditionGrade?: string | null;
  sourcePlatform?: string | null;
}): SearchHitChip[] {
  const chips: SearchHitChip[] = [];
  if (facets.status) chips.push({ label: facets.status, tone: 'blue' });
  if (facets.conditionGrade) chips.push({ label: facets.conditionGrade, tone: 'amber' });
  if (facets.sourcePlatform) chips.push({ label: facets.sourcePlatform, tone: 'gray' });
  return chips;
}
