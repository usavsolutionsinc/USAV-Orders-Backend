import pool from '@/lib/db';

/**
 * Packer-photo read helpers — the packing mirror of `receiving-list.ts`.
 *
 * Packer photos are stored polymorphically on the `photos` table, linked via
 * `photo_entity_links` with `entity_type='PACKER_LOG'`, `entity_id=packer_logs.id`.
 * Same `pool` + explicit `organization_id` predicate convention as the receiving
 * list (tenant boundary is the predicate, not a per-call GUC txn here).
 */

const LINK_JOINS = `
  INNER JOIN photo_entity_links l ON l.photo_id = p.id AND l.organization_id = p.organization_id
`;

export interface PackerPhotoListRow {
  id: number;
  url: string;
  caption: string | null;
  uploadedBy: number | null;
  createdAt: string;
}

interface DbRow {
  id: string;
  caption: string | null;
  uploaded_by: number | null;
  created_at: string;
}

/** List every photo linked to one packer_log, oldest first. */
export async function listPackerPhotos(input: {
  organizationId: string;
  packerLogId: number;
  contentUrl?: (id: number) => string;
}): Promise<PackerPhotoListRow[]> {
  const toUrl = input.contentUrl ?? ((id: number) => `/api/photos/${id}/content`);
  const res = await pool.query<DbRow>(
    `SELECT DISTINCT ON (p.id)
       p.id,
       p.photo_type AS caption,
       p.taken_by_staff_id AS uploaded_by,
       p.created_at
       FROM photos p
       ${LINK_JOINS}
      WHERE p.organization_id = $1
        AND l.entity_type = 'PACKER_LOG'
        AND l.entity_id = $2
      ORDER BY p.id ASC, p.created_at ASC`,
    [input.organizationId, input.packerLogId],
  );
  return res.rows.map((r) => ({
    id: Number(r.id),
    url: toUrl(Number(r.id)),
    caption: r.caption,
    uploadedBy: r.uploaded_by != null ? Number(r.uploaded_by) : null,
    createdAt: r.created_at,
  }));
}

/** Count photos linked to one packer_log (for the live `total_photo_count`). */
export async function countPackerPhotos(
  organizationId: string,
  packerLogId: number,
): Promise<number> {
  const res = await pool.query<{ c: string }>(
    `SELECT COUNT(DISTINCT p.id) AS c
       FROM photos p
       ${LINK_JOINS}
      WHERE p.organization_id = $1
        AND l.entity_type = 'PACKER_LOG'
        AND l.entity_id = $2`,
    [organizationId, packerLogId],
  );
  return Number(res.rows[0]?.c ?? 0);
}

/** Resolve which packer_log a photo belongs to (for delete → publish). */
export async function getPackerPhotoLogId(
  photoId: number,
  organizationId: string,
): Promise<number | null> {
  const res = await pool.query<{ entity_id: string }>(
    `SELECT l.entity_id
       FROM photos p
       ${LINK_JOINS}
      WHERE p.id = $1
        AND p.organization_id = $2
        AND l.entity_type = 'PACKER_LOG'
      LIMIT 1`,
    [photoId, organizationId],
  );
  return res.rows[0] ? Number(res.rows[0].entity_id) : null;
}
