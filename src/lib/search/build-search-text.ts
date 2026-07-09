/**
 * buildSearchText — canonical denormalized text + display fields + facets for
 * one entity_search_docs row (AI search Phase 0,
 * docs/ai-search-modernization-plan.md).
 *
 * Pure functions: the outbox worker (search-outbox-worker.ts) loads parent
 * rows org-scoped with the SQL aliases documented per entity below, then this
 * module turns a row into `{ title, subtitle, searchText, facets }`. Keep the
 * fields here in sync with the trigger UPDATE OF column lists in migration
 * 2026-07-03d — a column searched here but missing there goes stale silently.
 *
 * Mirrors what global-search already queries per entity (order ids, titles,
 * SKUs, serials, tracking, source platform) plus notes/facets. Title SoT
 * rules honored: serial-unit titles prefer `items.name` (joined on
 * zoho_item_id — never the SKU string) with sku_catalog.product_title as
 * fallback; sku_catalog rows are their own namespace and use product_title.
 */

export type SearchEntityType =
  | 'ORDER'
  | 'SERIAL_UNIT'
  | 'RECEIVING'
  | 'SKU'
  | 'REPAIR'
  | 'FBA_SHIPMENT';

export const SEARCH_ENTITY_TYPES: readonly SearchEntityType[] = [
  'ORDER',
  'SERIAL_UNIT',
  'RECEIVING',
  'SKU',
  'REPAIR',
  'FBA_SHIPMENT',
] as const;

export function isSearchEntityType(value: string): value is SearchEntityType {
  return (SEARCH_ENTITY_TYPES as readonly string[]).includes(value);
}

export interface SearchDocFacets {
  status: string | null;
  conditionGrade: string | null;
  sourcePlatform: string | null;
  /** Carrier tracking number (order/receiving) — powers the row's tracking chip. */
  trackingNumber: string | null;
  /** Carrier name (order/receiving) — the tracking chip's leading label. */
  carrier: string | null;
  happenedAt: Date | null;
}

export interface BuiltSearchDoc {
  title: string;
  subtitle: string | null;
  searchText: string;
  facets: SearchDocFacets;
}

/** Raw loader row — snake_case aliases exactly as the worker SQL selects them. */
export type SearchSourceRow = Record<string, unknown>;

// Embedding inputs are billed per token and long tails add no recall for
// entity docs — cap the canonical text.
const MAX_SEARCH_TEXT = 2000;

function str(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

function strOrNull(value: unknown): string | null {
  const s = str(value);
  return s ? s : null;
}

function dateOrNull(...candidates: unknown[]): Date | null {
  for (const c of candidates) {
    if (c == null) continue;
    const d = c instanceof Date ? c : new Date(String(c));
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

/** Join, drop blanks, dedupe (case-insensitive), cap length. */
function joinSearchText(parts: unknown[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const s = str(part);
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out.join(' \n').slice(0, MAX_SEARCH_TEXT);
}

function subtitleOf(parts: unknown[]): string | null {
  const s = parts.map(str).filter(Boolean).join(' · ');
  return s ? s : null;
}

/**
 * Loader row contract (worker SQL):
 *   id, order_id, product_title, sku, account_source, status, condition,
 *   notes, order_date, created_at, serials (STRING_AGG of
 *   tech_serial_numbers.serial_number), tracking_number (stn raw), carrier
 *   (stn.carrier, UNKNOWN→null).
 */
function buildOrderDoc(row: SearchSourceRow): BuiltSearchDoc {
  const title = str(row.product_title) || `Order #${str(row.id)}`;
  return {
    title,
    subtitle: subtitleOf([row.order_id, row.serials, row.sku, row.account_source]),
    searchText: joinSearchText([
      row.order_id,
      row.product_title,
      row.sku,
      row.serials,
      row.tracking_number,
      row.account_source,
      row.status,
      row.condition,
      row.notes,
    ]),
    facets: {
      status: strOrNull(row.status),
      conditionGrade: strOrNull(row.condition),
      sourcePlatform: strOrNull(row.account_source),
      trackingNumber: strOrNull(row.tracking_number),
      carrier: strOrNull(row.carrier),
      happenedAt: dateOrNull(row.order_date, row.created_at),
    },
  };
}

/**
 * Loader row contract:
 *   id, serial_number, unit_uid, sku, current_status, condition_grade,
 *   current_location, notes, received_at, created_at,
 *   shipping_tracking_number, product_title (COALESCE(items.name via
 *   zoho_item_id, sku_catalog.product_title via sku_catalog_id)).
 */
function buildSerialUnitDoc(row: SearchSourceRow): BuiltSearchDoc {
  const title = str(row.product_title) || str(row.serial_number) || `Unit #${str(row.id)}`;
  return {
    title,
    subtitle: subtitleOf([row.serial_number, row.sku, row.current_status]),
    searchText: joinSearchText([
      row.serial_number,
      row.unit_uid,
      row.sku,
      row.product_title,
      row.current_location,
      row.shipping_tracking_number,
      row.current_status,
      row.condition_grade,
      row.notes,
    ]),
    facets: {
      status: strOrNull(row.current_status),
      conditionGrade: strOrNull(row.condition_grade),
      sourcePlatform: null,
      trackingNumber: strOrNull(row.shipping_tracking_number),
      carrier: null,
      happenedAt: dateOrNull(row.received_at, row.created_at),
    },
  };
}

/**
 * Loader row contract:
 *   id, tracking_number (stn raw), carrier, po_number
 *   (zoho_purchaseorder_number), source_platform, intake_type,
 *   exception_code, support_notes, zoho_notes, condition_grade,
 *   qa_status, received_at, created_at, line_item_names, line_skus
 *   (STRING_AGGs over receiving_lines).
 */
function buildReceivingDoc(row: SearchSourceRow): BuiltSearchDoc {
  const title = str(row.tracking_number) || `Receiving #${str(row.id)}`;
  return {
    title,
    subtitle: subtitleOf([row.carrier, row.po_number, row.source_platform]),
    searchText: joinSearchText([
      row.tracking_number,
      row.carrier,
      row.po_number,
      row.source_platform,
      row.intake_type,
      row.exception_code,
      row.line_item_names,
      row.line_skus,
      row.support_notes,
      row.zoho_notes,
      row.qa_status,
    ]),
    facets: {
      status: strOrNull(row.qa_status),
      conditionGrade: strOrNull(row.condition_grade),
      sourcePlatform: strOrNull(row.source_platform),
      trackingNumber: strOrNull(row.tracking_number),
      carrier: strOrNull(row.carrier),
      happenedAt: dateOrNull(row.received_at, row.created_at),
    },
  };
}

/**
 * Loader row contract:
 *   id, sku, product_title, category, upc, ean, gtin, notes,
 *   lifecycle_status, is_active, created_at, updated_at.
 */
function buildSkuDoc(row: SearchSourceRow): BuiltSearchDoc {
  const title = str(row.product_title) || str(row.sku) || `SKU #${str(row.id)}`;
  return {
    title,
    subtitle: subtitleOf([row.sku, row.category]),
    searchText: joinSearchText([
      row.sku,
      row.product_title,
      row.category,
      row.upc,
      row.ean,
      row.gtin,
      row.lifecycle_status,
      row.notes,
    ]),
    facets: {
      status: strOrNull(row.lifecycle_status),
      conditionGrade: null,
      sourcePlatform: null,
      trackingNumber: null,
      carrier: null,
      happenedAt: dateOrNull(row.updated_at, row.created_at),
    },
  };
}

/**
 * Loader row contract:
 *   id, ticket_number, product_title, serial_number, issue, notes, status,
 *   source_order_id, source_tracking_number, source_sku, received_at,
 *   created_at.
 */
function buildRepairDoc(row: SearchSourceRow): BuiltSearchDoc {
  const title = str(row.product_title) || `Repair #${str(row.id)}`;
  return {
    title,
    subtitle: subtitleOf([row.ticket_number, row.status]),
    searchText: joinSearchText([
      row.ticket_number,
      row.product_title,
      row.serial_number,
      row.issue,
      row.source_order_id,
      row.source_tracking_number,
      row.source_sku,
      row.status,
      row.notes,
    ]),
    facets: {
      status: strOrNull(row.status),
      conditionGrade: null,
      sourcePlatform: strOrNull(row.source_system),
      trackingNumber: null,
      carrier: null,
      happenedAt: dateOrNull(row.received_at, row.created_at),
    },
  };
}

/**
 * Loader row contract:
 *   id, shipment_ref, amazon_shipment_id, destination_fc, status, notes,
 *   due_date, shipped_at, created_at, item_titles, item_skus, item_fnskus,
 *   item_asins (STRING_AGGs over fba_shipment_items).
 */
function buildFbaDoc(row: SearchSourceRow): BuiltSearchDoc {
  const title = str(row.shipment_ref) || `FBA #${str(row.id)}`;
  return {
    title,
    subtitle: subtitleOf([row.status, row.destination_fc]),
    searchText: joinSearchText([
      row.shipment_ref,
      row.amazon_shipment_id,
      row.destination_fc,
      row.item_titles,
      row.item_skus,
      row.item_fnskus,
      row.item_asins,
      row.status,
      row.notes,
    ]),
    facets: {
      status: strOrNull(row.status),
      conditionGrade: null,
      sourcePlatform: 'fba',
      trackingNumber: null,
      carrier: null,
      happenedAt: dateOrNull(row.shipped_at, row.due_date, row.created_at),
    },
  };
}

const BUILDERS: Record<SearchEntityType, (row: SearchSourceRow) => BuiltSearchDoc> = {
  ORDER: buildOrderDoc,
  SERIAL_UNIT: buildSerialUnitDoc,
  RECEIVING: buildReceivingDoc,
  SKU: buildSkuDoc,
  REPAIR: buildRepairDoc,
  FBA_SHIPMENT: buildFbaDoc,
};

export function buildSearchText(
  entityType: SearchEntityType,
  row: SearchSourceRow,
): BuiltSearchDoc {
  return BUILDERS[entityType](row);
}
