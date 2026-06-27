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

export async function listPhotoLibrary(filters: LibraryFilters) {
  const limit = Math.min(Math.max(filters.limit ?? 48, 1), 100);
  const params: unknown[] = [filters.organizationId];
  const clauses: string[] = ['p.organization_id = $1'];

  if (filters.cursor && filters.cursor > 0) {
    params.push(filters.cursor);
    clauses.push(`p.id < $${params.length}`);
  }
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
  const sortDir = filters.sort === 'oldest' ? 'ASC' : 'DESC';
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
                AND la.organization_id = p.organization_id) AS labels
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
    return {
      ...mapPhotoRow(row as Parameters<typeof mapPhotoRow>[0]),
      takenByStaffName: staffName ?? null,
      hasAnalysis: Boolean((row as { has_analysis?: boolean }).has_analysis),
      damageDetected: (row as { damage_detected?: boolean | null }).damage_detected ?? null,
      ticketId: ticketId != null && Number.isFinite(ticketId) ? ticketId : null,
      labels,
    };
  });
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;

  return { items, nextCursor, hasMore };
}
