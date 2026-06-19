import pool from '@/lib/db';
import { mapPhotoRow, PHOTO_SELECT } from './list-for-entity';

export interface LibraryFilters {
  organizationId: string;
  cursor?: number | null;
  limit?: number;
  dateFrom?: string | null;
  dateTo?: string | null;
  entityType?: string | null;
  entityId?: number | null;
  linkRole?: string | null;
  poRef?: string | null;
  receivingId?: number | null;
  staffId?: number | null;
  hasAnalysis?: boolean | null;
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

  const res = await pool.query(
    `SELECT DISTINCT ON (p.id) p.id, p.organization_id, p.photo_type, p.taken_by_staff_id,
            p.po_ref, p.created_at,
            EXISTS (SELECT 1 FROM photo_analysis a WHERE a.photo_id = p.id) AS has_analysis,
            (a.metadata->>'damage_detected')::boolean AS damage_detected
       FROM photos p
       LEFT JOIN photo_entity_links l ON l.photo_id = p.id
       LEFT JOIN photo_analysis a ON a.photo_id = p.id
      WHERE ${clauses.join(' AND ')}
      ORDER BY p.id DESC, p.created_at DESC
      LIMIT ${limitParam}`,
    params,
  );

  const rows = res.rows.map((row) => ({
    ...mapPhotoRow(row as Parameters<typeof mapPhotoRow>[0]),
    hasAnalysis: Boolean((row as { has_analysis?: boolean }).has_analysis),
    damageDetected: (row as { damage_detected?: boolean | null }).damage_detected ?? null,
  }));
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;

  return { items: rows, nextCursor, hasMore };
}
