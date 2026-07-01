import pool from '@/lib/db';
import { mapPhotoRow } from './list-for-entity';

export interface LibraryFilters {
  organizationId: string;
  cursor?: number | null;
  limit?: number;
  dateFrom?: string | null;
  dateTo?: string | null;
  sort?: 'recent' | 'oldest' | null;
  entityType?: string | null;
  entityId?: number | null;
  linkRole?: string | null;
  poRef?: string | null;
  receivingId?: number | null;
  /** Keep only RECEIVING-linked photos whose receiving.source matches (e.g. 'local_pickup'). */
  receivingSource?: string | null;
  /** Drop RECEIVING-linked photos whose receiving.source matches (exclude local pickups from unboxing). */
  receivingSourceExclude?: string | null;
  staffId?: number | null;
  hasAnalysis?: boolean | null;
  /** Tri-state damage filter from photo_analysis.metadata.damage_detected. */
  damageDetected?: boolean | null;
  /** Custom image type — keep only photos tagged with this photo_type. */
  photoType?: string | null;
  /** Photo label key — keep only photos assigned this label (photo_labels.key). */
  labelKey?: string | null;
  // ── Business-ID filters (each resolves through photo_entity_links; verified
  //    join paths in 2026-* migrations). All tenant-scoped via p.organization_id.
  /** Shipping tracking number (receiving.shipment_id / packer_logs.shipment_id → shipping_tracking_numbers). */
  tracking?: string | null;
  /** Product serial (serial_units.serial_number). */
  serial?: string | null;
  /** Catalog SKU string — matched against sku_catalog.sku ONLY, then id-joined (never join on the SKU string). */
  sku?: string | null;
  /** Zendesk claim ticket number (photo_entity_links ZENDESK_TICKET.entity_id). */
  ticketId?: number | null;
  /** Local pickup order id (local_pickup_orders.id). */
  pickupId?: number | null;
  /** Returns RMA number (rma_authorizations.rma_number via return_dispositions). */
  rma?: string | null;
  // ── Unified PO-photo finder ──────────────────────────────────────────────
  /**
   * A single identifier the operator typed (order#, tracking#, serial#, or PO#).
   * Unlike the granular `serial`/`tracking` filters above (which keep ONLY the
   * photos directly linked to that one entity), the finder resolves the value to
   * its receiving carton(s) and surfaces *every* photo on those cartons — i.e.
   * "show me this PO's photos" regardless of which identifier you have in hand.
   */
  poFinder?: string | null;
  /** Which identifier `poFinder` is. Defaults to 'po'. */
  poFinderKind?: PoFinderKind | null;
}

export type PoFinderKind = 'order' | 'tracking' | 'serial' | 'po' | 'ticket' | 'any';

const PO_FINDER_KINDS: readonly PoFinderKind[] = ['order', 'tracking', 'serial', 'po', 'ticket', 'any'];

export function isPoFinderKind(value: unknown): value is PoFinderKind {
  return typeof value === 'string' && (PO_FINDER_KINDS as readonly string[]).includes(value);
}

/**
 * Parse the shared library filter params (everything except org + pagination)
 * from a URLSearchParams. Used by BOTH `/api/photos/library` (list) and
 * `/api/photos/library/ids` (select-all-matching) so the two never diverge on
 * which rows a filter set selects.
 */
export function libraryFiltersFromSearchParams(
  params: URLSearchParams,
): Omit<LibraryFilters, 'organizationId' | 'cursor' | 'limit'> {
  const hasAnalysisRaw = params.get('hasAnalysis');
  const damageRaw = params.get('damageDetected');
  return {
    dateFrom: params.get('dateFrom'),
    dateTo: params.get('dateTo'),
    sort: params.get('sort') === 'oldest' ? 'oldest' : 'recent',
    entityType: params.get('entityType'),
    entityId: params.get('entityId') ? Number(params.get('entityId')) : null,
    linkRole: params.get('linkRole'),
    poRef: params.get('poRef'),
    receivingId: params.get('receivingId') ? Number(params.get('receivingId')) : null,
    tracking: params.get('tracking'),
    serial: params.get('serial'),
    sku: params.get('sku'),
    ticketId: params.get('ticketId') ? Number(params.get('ticketId')) : null,
    pickupId: params.get('pickupId') ? Number(params.get('pickupId')) : null,
    rma: params.get('rma'),
    poFinder: params.get('poFinder'),
    poFinderKind: isPoFinderKind(params.get('poFinderKind'))
      ? (params.get('poFinderKind') as PoFinderKind)
      : null,
    receivingSource: params.get('receivingSource'),
    receivingSourceExclude: params.get('receivingSourceExclude'),
    staffId: params.get('staffId') ? Number(params.get('staffId')) : null,
    photoType: params.get('photoType'),
    labelKey: params.get('label'),
    hasAnalysis: hasAnalysisRaw === 'true' ? true : hasAnalysisRaw === 'false' ? false : null,
    damageDetected: damageRaw === 'true' ? true : damageRaw === 'false' ? false : null,
  };
}

/**
 * Build an EXISTS subquery matching photos linked (directly via RECEIVING, or
 * indirectly via RECEIVING_LINE) to a `receiving` row with the given `source`.
 * Returns the SQL fragment; pushes the source value onto `params`.
 */
function receivingSourceExists(params: unknown[], source: string): string {
  params.push(source);
  const src = `$${params.length}`;
  return `EXISTS (
        SELECT 1 FROM photo_entity_links l
         JOIN receiving r ON r.organization_id = p.organization_id AND (
                (l.entity_type = 'RECEIVING' AND r.id = l.entity_id)
             OR (l.entity_type = 'RECEIVING_LINE' AND r.id = (
                   SELECT rl.receiving_id FROM receiving_lines rl WHERE rl.id = l.entity_id))
              )
         WHERE l.photo_id = p.id
           AND l.organization_id = p.organization_id
           AND r.source = ${src}
      )`;
}

/**
 * Tracking-number match across BOTH photo→tracking paths:
 *  - packing:  PACKER_LOG → packer_logs.shipment_id → shipping_tracking_numbers
 *  - unboxing: RECEIVING (direct or via RECEIVING_LINE) → receiving.shipment_id → STN
 * `tracking_number_normalized` is the canonical STN column (UNIQUE). Substring
 * ILIKE so a partial/last-N paste still resolves. One param, referenced 3×.
 */
function trackingExists(params: unknown[], tracking: string): string {
  params.push(`%${tracking}%`);
  const t = `$${params.length}`;
  return `EXISTS (
        SELECT 1 FROM photo_entity_links l
         WHERE l.photo_id = p.id
           AND l.organization_id = p.organization_id
           AND (
             (l.entity_type = 'PACKER_LOG' AND EXISTS (
                SELECT 1 FROM packer_logs pl
                 JOIN shipping_tracking_numbers stn ON stn.id = pl.shipment_id
                 WHERE pl.id = l.entity_id AND stn.tracking_number_normalized ILIKE ${t}))
          OR (l.entity_type = 'RECEIVING' AND EXISTS (
                SELECT 1 FROM receiving r
                 JOIN shipping_tracking_numbers stn ON stn.id = r.shipment_id
                 WHERE r.id = l.entity_id AND stn.tracking_number_normalized ILIKE ${t}))
          OR (l.entity_type = 'RECEIVING_LINE' AND EXISTS (
                SELECT 1 FROM receiving_lines rl
                 JOIN receiving r ON r.id = rl.receiving_id
                 JOIN shipping_tracking_numbers stn ON stn.id = r.shipment_id
                 WHERE rl.id = l.entity_id AND stn.tracking_number_normalized ILIKE ${t}))
           )
      )`;
}

/**
 * Unified PO-photo finder. Resolves a typed identifier of `kind` to the set of
 * `receiving` cartons it belongs to, then matches photos linked to ANY of those
 * cartons (directly as RECEIVING, or via RECEIVING_LINE). The end goal: typing
 * an order#, tracking#, or serial# surfaces the whole PO's unboxing photos.
 *
 * Each carton-resolver subquery is standalone, so it is tenant-scoped on its own
 * (`organization_id = $1`, the leading organizationId param) — never relying on
 * the outer photo_entity_links scope. ILIKE substring so a partial paste/last-N
 * still resolves. One value param, referenced across the kind's resolver.
 *
 * Verified join paths (see deep-scan + migrations):
 *  - tracking → receiving.shipment_id → STN (+ shipment_links extra boxes)
 *  - serial   → serial_units.origin_receiving_line_id → receiving_lines.receiving_id
 *  - order    → receiving_lines.source_order_id / zoho_purchaseorder_number (returns
 *               bind the sales-order# as the carton PO#; see returned-serial-link.ts)
 *  - po       → receiving.zoho_purchaseorder_number (+ denormalized photos.po_ref)
 */
/** The carton-id resolver subquery for ONE identifier kind. References $1 (org)
 *  and `v` (the value param). 'any' is composed from these, not handled here. */
function cartonResolverSql(kind: Exclude<PoFinderKind, 'any'>, v: string): string {
  switch (kind) {
    case 'tracking':
      return `
        SELECT r.id FROM receiving r
          JOIN shipping_tracking_numbers stn ON stn.id = r.shipment_id
         WHERE r.organization_id = $1 AND stn.tracking_number_normalized ILIKE ${v}
        UNION
        SELECT sl.owner_id FROM shipment_links sl
          JOIN shipping_tracking_numbers stn ON stn.id = sl.shipment_id
         WHERE sl.owner_type = 'RECEIVING' AND sl.organization_id = $1
           AND stn.tracking_number_normalized ILIKE ${v}`;
    case 'serial':
      return `
        SELECT rl.receiving_id FROM serial_units su
          JOIN receiving_lines rl ON rl.id = su.origin_receiving_line_id
         WHERE su.organization_id = $1 AND su.serial_number ILIKE ${v}`;
    case 'order':
      return `
        SELECT rl.receiving_id FROM receiving_lines rl
         WHERE rl.organization_id = $1
           AND (rl.source_order_id ILIKE ${v} OR rl.zoho_purchaseorder_number ILIKE ${v})`;
    case 'po':
    default:
      return `
        SELECT r.id FROM receiving r
         WHERE r.organization_id = $1 AND r.zoho_purchaseorder_number ILIKE ${v}`;
  }
}

/** Wrap a carton-id resolver in the "photos linked to any of these cartons" EXISTS. */
function cartonExistsSql(resolver: string): string {
  return `EXISTS (
        SELECT 1 FROM photo_entity_links l
         LEFT JOIN receiving_lines rlf
                ON l.entity_type = 'RECEIVING_LINE' AND rlf.id = l.entity_id
         WHERE l.photo_id = p.id
           AND l.organization_id = p.organization_id
           AND COALESCE(
                 CASE WHEN l.entity_type = 'RECEIVING' THEN l.entity_id END,
                 rlf.receiving_id
               ) IN (${resolver})
      )`;
}

function ticketFinderExists(params: unknown[], rawValue: string): string {
  const digits = rawValue.replace(/^#/, '').trim();
  if (/^\d+$/.test(digits)) {
    params.push(Number(digits));
    const id = `$${params.length}`;
    return `EXISTS (
        SELECT 1 FROM photo_entity_links l
         WHERE l.photo_id = p.id
           AND l.organization_id = p.organization_id
           AND l.entity_type = 'ZENDESK_TICKET'
           AND l.entity_id = ${id}
      )`;
  }
  params.push(`%${digits}%`);
  const v = `$${params.length}`;
  return `EXISTS (
      SELECT 1 FROM photo_entity_links l
       WHERE l.photo_id = p.id
         AND l.organization_id = p.organization_id
         AND l.entity_type = 'ZENDESK_TICKET'
         AND l.entity_id::text ILIKE ${v}
    )`;
}

function poFinderExists(params: unknown[], kind: PoFinderKind, rawValue: string): string {
  if (kind === 'ticket') {
    return ticketFinderExists(params, rawValue);
  }

  params.push(`%${rawValue}%`);
  const v = `$${params.length}`;
  // A direct PO lookup also catches denormalized po_ref-only photos (stamped at
  // upload by resolve-po-ref.ts) that may predate or lack a carton link.
  const poRefMatch = `p.po_ref ILIKE ${v}`;
  if (kind === 'po') {
    return `(${poRefMatch} OR ${cartonExistsSql(cartonResolverSql('po', v))})`;
  }
  if (kind === 'any') {
    // The smart "All" scope: serial OR tracking OR order OR PO OR Zendesk ticket,
    // plus free-text/OCR (po_ref + photo_analysis).
    const cartons = (['serial', 'tracking', 'order', 'po'] as const)
      .map((k) => cartonExistsSql(cartonResolverSql(k, v)))
      .join(' OR ');
    const ocrMatch = `EXISTS (
        SELECT 1 FROM photo_analysis a
         WHERE a.photo_id = p.id AND a.metadata::text ILIKE ${v})`;
    const ticketMatch = ticketFinderExists(params, rawValue);
    return `(${poRefMatch} OR ${ocrMatch} OR ${ticketMatch} OR ${cartons})`;
  }
  return cartonExistsSql(cartonResolverSql(kind, v));
}

/**
 * Shared WHERE builder for the media library filter set. Both the paged row
 * query (listPhotoLibrary) and the id-only count query (listPhotoLibraryIds)
 * apply IDENTICAL predicates so they can never drift. Cursor/limit/ORDER BY and
 * column selection are the caller's concern — not here.
 */
function buildLibraryWhere(filters: LibraryFilters): { clauses: string[]; params: unknown[] } {
  const params: unknown[] = [filters.organizationId];
  const clauses: string[] = ['p.organization_id = $1'];

  // dateFrom/dateTo are PST `YYYY-MM-DD` calendar days (the same PST the folder
  // date-tree groups by). Compare against the photo's PST *calendar date* so the
  // range is inclusive of the whole end day — and so a single day (from===to)
  // matches that whole PST day. A naive `created_at <= dateTo::timestamptz` casts
  // to start-of-day in the server TZ (UTC), making a single-day window zero-width
  // (≈ always empty) and shifting multi-day ranges by the UTC offset.
  if (filters.dateFrom) {
    params.push(filters.dateFrom);
    clauses.push(`(p.created_at AT TIME ZONE 'America/Los_Angeles')::date >= $${params.length}::date`);
  }
  if (filters.dateTo) {
    params.push(filters.dateTo);
    clauses.push(`(p.created_at AT TIME ZONE 'America/Los_Angeles')::date <= $${params.length}::date`);
  }
  if (filters.poRef) {
    params.push(`%${filters.poRef}%`);
    clauses.push(`p.po_ref ILIKE $${params.length}`);
  }
  if (filters.staffId) {
    params.push(filters.staffId);
    clauses.push(`p.taken_by_staff_id = $${params.length}`);
  }
  if (filters.photoType) {
    params.push(filters.photoType);
    clauses.push(`lower(p.photo_type) = lower($${params.length})`);
  }
  if (filters.labelKey) {
    params.push(filters.labelKey);
    clauses.push(`
      EXISTS (
        SELECT 1 FROM photo_label_assignments la
         JOIN photo_labels lb ON lb.id = la.label_id
        WHERE la.photo_id = p.id
          AND la.organization_id = p.organization_id
          AND lower(lb.key) = lower($${params.length})
      )`);
  }
  if (filters.entityType && filters.entityId) {
    params.push(filters.entityType, filters.entityId);
    clauses.push(`
      EXISTS (
        SELECT 1 FROM photo_entity_links l
         WHERE l.photo_id = p.id
           AND l.organization_id = p.organization_id
           AND l.entity_type = $${params.length - 1}
           AND l.entity_id = $${params.length}
      )`);
  } else if (filters.entityType) {
    // Scope filter (no specific entity): keep ONLY photos linked to this entity
    // type — e.g. claims = ZENDESK_TICKET, packing = PACKER_LOG. Receiving
    // photos link as RECEIVING or RECEIVING_LINE, so unboxing matches both.
    const types =
      filters.entityType === 'RECEIVING' ? ['RECEIVING', 'RECEIVING_LINE'] : [filters.entityType];
    params.push(types);
    clauses.push(`
      EXISTS (
        SELECT 1 FROM photo_entity_links l
         WHERE l.photo_id = p.id
           AND l.organization_id = p.organization_id
           AND l.entity_type = ANY($${params.length}::text[])
      )`);
  }
  if (filters.receivingId) {
    params.push(filters.receivingId);
    const rid = `$${params.length}`;
    clauses.push(`
      EXISTS (
        SELECT 1 FROM photo_entity_links l
         LEFT JOIN receiving_lines rl
                ON l.entity_type = 'RECEIVING_LINE' AND rl.id = l.entity_id
         WHERE l.photo_id = p.id
           AND (
             (l.entity_type = 'RECEIVING' AND l.entity_id = ${rid})
             OR (l.entity_type = 'RECEIVING_LINE' AND rl.receiving_id = ${rid})
           )
      )`);
  }
  if (filters.tracking) {
    clauses.push(trackingExists(params, filters.tracking));
  }
  if (filters.serial) {
    params.push(`%${filters.serial}%`);
    clauses.push(`
      EXISTS (
        SELECT 1 FROM photo_entity_links l
         JOIN serial_units su ON l.entity_type = 'SERIAL_UNIT' AND su.id = l.entity_id
         WHERE l.photo_id = p.id
           AND l.organization_id = p.organization_id
           AND su.serial_number ILIKE $${params.length}
      )`);
  }
  if (filters.sku) {
    // SoT rule: never join the two SKU schemes on the string. Match the typed
    // SKU against sku_catalog.sku (UNIQUE) ONLY, then resolve photos by catalog
    // id — direct SKU links and via the serialized unit's sku_catalog_id.
    params.push(filters.sku);
    const sku = `$${params.length}`;
    clauses.push(`
      EXISTS (
        SELECT 1 FROM photo_entity_links l
         JOIN sku_catalog sc ON sc.sku ILIKE ${sku}
         WHERE l.photo_id = p.id
           AND l.organization_id = p.organization_id
           AND (
             (l.entity_type = 'SKU' AND l.entity_id = sc.id)
             OR (l.entity_type = 'SERIAL_UNIT' AND EXISTS (
                   SELECT 1 FROM serial_units su
                    WHERE su.id = l.entity_id AND su.sku_catalog_id = sc.id))
           )
      )`);
  }
  if (filters.ticketId) {
    params.push(filters.ticketId);
    clauses.push(`
      EXISTS (
        SELECT 1 FROM photo_entity_links l
         WHERE l.photo_id = p.id
           AND l.organization_id = p.organization_id
           AND l.entity_type = 'ZENDESK_TICKET'
           AND l.entity_id = $${params.length}
      )`);
  }
  if (filters.pickupId) {
    params.push(filters.pickupId);
    const pid = `$${params.length}`;
    clauses.push(`
      EXISTS (
        SELECT 1 FROM photo_entity_links l
         JOIN receiving r ON r.organization_id = p.organization_id AND (
                (l.entity_type = 'RECEIVING' AND r.id = l.entity_id)
             OR (l.entity_type = 'RECEIVING_LINE' AND r.id = (
                   SELECT rl.receiving_id FROM receiving_lines rl WHERE rl.id = l.entity_id)))
         JOIN local_pickup_orders lpo ON lpo.receiving_id = r.id
         WHERE l.photo_id = p.id
           AND l.organization_id = p.organization_id
           AND lpo.id = ${pid}
      )`);
  }
  if (filters.rma) {
    params.push(filters.rma);
    clauses.push(`
      EXISTS (
        SELECT 1 FROM photo_entity_links l
         JOIN serial_units su ON l.entity_type = 'SERIAL_UNIT' AND su.id = l.entity_id
         JOIN return_dispositions rd ON rd.serial_unit_id = su.id
         JOIN rma_authorizations rma ON rma.id = rd.rma_id
         WHERE l.photo_id = p.id
           AND l.organization_id = p.organization_id
           AND rma.rma_number ILIKE $${params.length}
      )`);
  }
  if (filters.poFinder) {
    const kind = isPoFinderKind(filters.poFinderKind) ? filters.poFinderKind : 'po';
    clauses.push(poFinderExists(params, kind, filters.poFinder));
  }
  // Local pickups create a `receiving` row with source='local_pickup'; scope to
  // (or exclude) those to split the RECEIVING entity into the two sidebar folders.
  if (filters.receivingSource) {
    clauses.push(receivingSourceExists(params, filters.receivingSource));
  }
  if (filters.receivingSourceExclude) {
    clauses.push(`NOT ${receivingSourceExists(params, filters.receivingSourceExclude)}`);
  }
  if (filters.linkRole) {
    params.push(filters.linkRole);
    clauses.push(`
      EXISTS (
        SELECT 1 FROM photo_entity_links l
         WHERE l.photo_id = p.id AND l.link_role = $${params.length}
      )`);
  }
  if (filters.hasAnalysis === true) {
    clauses.push(`EXISTS (SELECT 1 FROM photo_analysis a WHERE a.photo_id = p.id)`);
  } else if (filters.hasAnalysis === false) {
    clauses.push(`NOT EXISTS (SELECT 1 FROM photo_analysis a WHERE a.photo_id = p.id)`);
  }
  if (filters.damageDetected === true) {
    clauses.push(
      `EXISTS (SELECT 1 FROM photo_analysis a
                WHERE a.photo_id = p.id
                  AND (a.metadata->>'damage_detected')::boolean IS TRUE)`,
    );
  } else if (filters.damageDetected === false) {
    clauses.push(
      `NOT EXISTS (SELECT 1 FROM photo_analysis a
                    WHERE a.photo_id = p.id
                      AND (a.metadata->>'damage_detected')::boolean IS TRUE)`,
    );
  }

  return { clauses, params };
}

export async function listPhotoLibrary(filters: LibraryFilters) {
  const limit = Math.min(Math.max(filters.limit ?? 48, 1), 100);
  const { clauses, params } = buildLibraryWhere(filters);

  if (filters.cursor && filters.cursor > 0) {
    params.push(filters.cursor);
    clauses.push(`p.id < $${params.length}`);
  }

  const sortDir = filters.sort === 'oldest' ? 'ASC' : 'DESC';
  params.push(limit + 1);
  const limitParam = `$${params.length}`;

  // All filters are self-contained EXISTS/scalar subqueries on `p`, so we select
  // straight from `photos` — no row-multiplying joins, hence no DISTINCT ON
  // (which Postgres would require to lead the ORDER BY, breaking date sort).
  const res = await pool.query(
    `SELECT p.id, p.organization_id, p.photo_type, p.taken_by_staff_id,
            p.po_ref, p.created_at,
            (SELECT s.name FROM staff s
              WHERE s.id = p.taken_by_staff_id
                AND s.organization_id = p.organization_id
              LIMIT 1) AS taken_by_staff_name,
            EXISTS (SELECT 1 FROM photo_analysis a WHERE a.photo_id = p.id) AS has_analysis,
            (SELECT (a.metadata->>'damage_detected')::boolean
               FROM photo_analysis a WHERE a.photo_id = p.id LIMIT 1) AS damage_detected,
            (SELECT lz.entity_id FROM photo_entity_links lz
              WHERE lz.photo_id = p.id
                AND lz.organization_id = p.organization_id
                AND lz.entity_type = 'ZENDESK_TICKET'
              LIMIT 1) AS ticket_id,
            (SELECT COALESCE(json_agg(json_build_object(
                      'id', lb.id, 'key', lb.key, 'label', lb.label,
                      'color', lb.color, 'icon', lb.icon
                    ) ORDER BY lb.sort_index, lb.id), '[]'::json)
               FROM photo_label_assignments la
               JOIN photo_labels lb ON lb.id = la.label_id
              WHERE la.photo_id = p.id
                AND la.organization_id = p.organization_id) AS labels,
            -- Derived source scope (mirrors entityTypeForSourceScope + the
            -- receiving.source split) so the sidebar can highlight the image-type
            -- a folder's photos belong to even under the "All photos" scope.
            -- Precedence keeps a receiving capture as unboxing/pickup even when the
            -- unit it created is also linked (RECEIVING before SERIAL_UNIT).
            (CASE
               WHEN EXISTS (SELECT 1 FROM photo_entity_links l
                             WHERE l.photo_id = p.id AND l.organization_id = p.organization_id
                               AND l.entity_type = 'ZENDESK_TICKET') THEN 'claims'
               WHEN EXISTS (SELECT 1 FROM photo_entity_links l
                             WHERE l.photo_id = p.id AND l.organization_id = p.organization_id
                               AND l.entity_type = 'PACKER_LOG') THEN 'packing'
               WHEN EXISTS (SELECT 1 FROM photo_entity_links l
                              JOIN receiving r ON r.organization_id = p.organization_id AND (
                                    (l.entity_type = 'RECEIVING' AND r.id = l.entity_id)
                                 OR (l.entity_type = 'RECEIVING_LINE' AND r.id = (
                                       SELECT rl.receiving_id FROM receiving_lines rl WHERE rl.id = l.entity_id)))
                             WHERE l.photo_id = p.id AND l.organization_id = p.organization_id
                               AND r.source = 'local_pickup') THEN 'local_pickup'
               WHEN EXISTS (SELECT 1 FROM photo_entity_links l
                             WHERE l.photo_id = p.id AND l.organization_id = p.organization_id
                               AND l.entity_type IN ('RECEIVING', 'RECEIVING_LINE')) THEN 'unboxing'
               WHEN EXISTS (SELECT 1 FROM photo_entity_links l
                             WHERE l.photo_id = p.id AND l.organization_id = p.organization_id
                               AND l.entity_type = 'SERIAL_UNIT') THEN 'repair'
               ELSE NULL
             END) AS source_scope
       FROM photos p
      WHERE ${clauses.join(' AND ')}
      ORDER BY p.created_at ${sortDir}, p.id ${sortDir}
      LIMIT ${limitParam}`,
    params,
  );

  const rows = res.rows.map((row) => {
    const ticketRaw = (row as { ticket_id?: number | string | null }).ticket_id;
    const ticketId = ticketRaw != null ? Number(ticketRaw) : null;
    const staffName = (row as { taken_by_staff_name?: string | null }).taken_by_staff_name;
    const labelsRaw = (row as { labels?: unknown }).labels;
    const labels = Array.isArray(labelsRaw)
      ? (labelsRaw as Array<{ id: number; key: string; label: string; color: string | null; icon: string | null }>)
      : [];
    const sourceScope = (row as { source_scope?: string | null }).source_scope ?? null;
    return {
      ...mapPhotoRow(row as Parameters<typeof mapPhotoRow>[0]),
      takenByStaffName: staffName ?? null,
      hasAnalysis: Boolean((row as { has_analysis?: boolean }).has_analysis),
      damageDetected: (row as { damage_detected?: boolean | null }).damage_detected ?? null,
      ticketId: ticketId != null && Number.isFinite(ticketId) ? ticketId : null,
      labels,
      sourceScope,
    };
  });
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;

  return { items, nextCursor, hasMore };
}

/**
 * "Select all matching filters" — the total row count plus up to `cap` photo ids
 * for the SAME filter set as listPhotoLibrary (shared WHERE builder → no drift).
 * The count is a full scan over the filtered set; the id list is capped so we
 * never ship 10k ids to the client. `capped` tells the UI the selection is
 * partial (total > cap).
 */
export async function listPhotoLibraryIds(
  filters: LibraryFilters,
  opts: { cap?: number } = {},
): Promise<{ ids: number[]; total: number; capped: boolean }> {
  const cap = Math.min(Math.max(opts.cap ?? 500, 1), 2000);
  const { clauses, params } = buildLibraryWhere(filters);
  const where = clauses.join(' AND ');

  const countRes = await pool.query<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM photos p WHERE ${where}`,
    params,
  );
  const total = countRes.rows[0]?.total ?? 0;

  const sortDir = filters.sort === 'oldest' ? 'ASC' : 'DESC';
  const idParams = [...params, cap];
  const idsRes = await pool.query<{ id: number }>(
    `SELECT p.id
       FROM photos p
      WHERE ${where}
      ORDER BY p.created_at ${sortDir}, p.id ${sortDir}
      LIMIT $${idParams.length}`,
    idParams,
  );
  const ids = idsRes.rows.map((r) => Number(r.id)).filter((id) => Number.isFinite(id));

  return { ids, total, capped: total > ids.length };
}
