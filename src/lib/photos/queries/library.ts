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

export async function listPhotoLibrary(filters: LibraryFilters) {
  const limit = Math.min(Math.max(filters.limit ?? 48, 1), 100);
  const params: unknown[] = [filters.organizationId];
  const clauses: string[] = ['p.organization_id = $1'];

  if (filters.cursor && filters.cursor > 0) {
    params.push(filters.cursor);
    clauses.push(`p.id < $${params.length}`);
  }
  if (filters.dateFrom) {
    params.push(filters.dateFrom);
    clauses.push(`p.created_at >= $${params.length}::timestamptz`);
  }
  if (filters.dateTo) {
    params.push(filters.dateTo);
    clauses.push(`p.created_at <= $${params.length}::timestamptz`);
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
              LIMIT 1) AS ticket_id
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
    return {
      ...mapPhotoRow(row as Parameters<typeof mapPhotoRow>[0]),
      takenByStaffName: staffName ?? null,
      hasAnalysis: Boolean((row as { has_analysis?: boolean }).has_analysis),
      damageDetected: (row as { damage_detected?: boolean | null }).damage_detected ?? null,
      ticketId: ticketId != null && Number.isFinite(ticketId) ? ticketId : null,
    };
  });
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;

  return { items, nextCursor, hasMore };
}
