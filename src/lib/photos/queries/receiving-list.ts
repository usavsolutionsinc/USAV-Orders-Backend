import pool from '@/lib/db';

const LINK_JOINS = `
  INNER JOIN photo_entity_links l ON l.photo_id = p.id AND l.organization_id = p.organization_id
  LEFT JOIN receiving_lines rl
         ON l.entity_type = 'RECEIVING_LINE' AND rl.id = l.entity_id
`;

export interface ReceivingPhotoListRow {
  id: number;
  entityType: string;
  entityId: number;
  receivingIdResolved: number | null;
  url: string;
  caption: string | null;
  uploadedBy: number | null;
  createdAt: string;
}

interface DbRow {
  id: string;
  entity_type: string;
  entity_id: string;
  receiving_id_resolved: string | null;
  caption: string | null;
  uploaded_by: number | null;
  created_at: string;
}

const SELECT = `
  DISTINCT ON (p.id)
  p.id,
  l.entity_type,
  l.entity_id,
  CASE
    WHEN l.entity_type = 'RECEIVING' THEN l.entity_id
    WHEN l.entity_type = 'RECEIVING_LINE' THEN rl.receiving_id
    ELSE NULL
  END AS receiving_id_resolved,
  p.photo_type AS caption,
  p.taken_by_staff_id AS uploaded_by,
  p.created_at
`;

function mapRow(row: DbRow, contentUrl: (id: number) => string): ReceivingPhotoListRow {
  return {
    id: Number(row.id),
    entityType: row.entity_type,
    entityId: Number(row.entity_id),
    receivingIdResolved:
      row.receiving_id_resolved != null ? Number(row.receiving_id_resolved) : null,
    url: contentUrl(Number(row.id)),
    caption: row.caption,
    uploadedBy: row.uploaded_by != null ? Number(row.uploaded_by) : null,
    createdAt: row.created_at,
  };
}

/** List receiving photos via photo_entity_links (Phase E — links only). */
export async function listReceivingPhotos(input: {
  organizationId: string;
  receivingId: number;
  lineId?: number | null;
  scope?: 'po' | 'all';
  /** Filter by capture intent — triage box shots vs unbox item shots. */
  photoIntent?: 'package' | 'item' | 'all';
  contentUrl?: (id: number) => string;
}): Promise<ReceivingPhotoListRow[]> {
  const toUrl = input.contentUrl ?? ((id: number) => `/api/photos/${id}/content`);
  const params: unknown[] = [input.organizationId];
  let where: string;

  if (input.lineId != null) {
    params.push(input.lineId);
    const lineParam = `$${params.length}`;
    where = `
      p.organization_id = $1
      AND l.entity_type = 'RECEIVING_LINE'
      AND l.entity_id = ${lineParam}`;
  } else if (input.scope === 'po') {
    params.push(input.receivingId);
    const rid = `$${params.length}`;
    where = `
      p.organization_id = $1
      AND l.entity_type = 'RECEIVING'
      AND l.entity_id = ${rid}`;
  } else {
    params.push(input.receivingId);
    const rid = `$${params.length}`;
    where = `
      p.organization_id = $1
      AND (
        (l.entity_type = 'RECEIVING' AND l.entity_id = ${rid})
        OR (l.entity_type = 'RECEIVING_LINE' AND rl.receiving_id = ${rid})
      )`;
  }

  const intent = input.photoIntent ?? 'all';
  const intentSql =
    intent === 'package'
      ? ` AND (l.entity_type = 'RECEIVING' OR COALESCE(p.photo_type, '') IN ('receiving_package', 'receiving'))`
      : intent === 'item'
        ? ` AND (l.entity_type = 'RECEIVING_LINE' OR COALESCE(p.photo_type, '') = 'receiving_item')`
        : '';

  const res = await pool.query<DbRow>(
    `SELECT ${SELECT}
       FROM photos p
       ${LINK_JOINS}
      WHERE ${where}${intentSql}
      ORDER BY p.id ASC, p.created_at ASC`,
    params,
  );

  return res.rows.map((r) => mapRow(r, toUrl));
}

export function sqlReceivingPhotoCount(receivingIdExpr: string, orgIdExpr: string): string {
  return `(SELECT COUNT(DISTINCT p.id)
     FROM photos p
     INNER JOIN photo_entity_links l ON l.photo_id = p.id AND l.organization_id = p.organization_id
     LEFT JOIN receiving_lines rl_ph
            ON l.entity_type = 'RECEIVING_LINE' AND rl_ph.id = l.entity_id
    WHERE p.organization_id = ${orgIdExpr}
      AND ${receivingIdExpr} IS NOT NULL
      AND (
        (l.entity_type = 'RECEIVING' AND l.entity_id = ${receivingIdExpr})
        OR (l.entity_type = 'RECEIVING_LINE' AND rl_ph.receiving_id = ${receivingIdExpr})
      ))`;
}

/**
 * Parameterized photo count for one receiving carton. Bind `[orgId, receivingId]`.
 * `$2::int` is required — Postgres cannot infer the type inside the subquery.
 */
export const SQL_SELECT_RECEIVING_PHOTO_COUNT = `SELECT ${sqlReceivingPhotoCount('$2::int', '$1')}::int AS photo_count`;

export async function countReceivingPhotos(
  organizationId: string,
  receivingId: number,
): Promise<number> {
  const res = await pool.query<{ photo_count: string }>(SQL_SELECT_RECEIVING_PHOTO_COUNT, [
    organizationId,
    receivingId,
  ]);
  return Number(res.rows[0]?.photo_count ?? 0);
}

export function sqlPoLevelPhotoCount(receivingIdExpr: string, orgIdExpr: string): string {
  return `(SELECT COUNT(DISTINCT p.id)
     FROM photos p
     INNER JOIN photo_entity_links l ON l.photo_id = p.id AND l.organization_id = p.organization_id
    WHERE p.organization_id = ${orgIdExpr}
      AND ${receivingIdExpr} IS NOT NULL
      AND l.entity_type = 'RECEIVING'
      AND l.entity_id = ${receivingIdExpr})`;
}

export function sqlLinePhotoCount(lineIdExpr: string, orgIdExpr: string): string {
  return `(SELECT COUNT(DISTINCT p.id)
     FROM photos p
     INNER JOIN photo_entity_links l ON l.photo_id = p.id AND l.organization_id = p.organization_id
    WHERE p.organization_id = ${orgIdExpr}
      AND l.entity_type = 'RECEIVING_LINE'
      AND l.entity_id = ${lineIdExpr})`;
}

export function sqlLineIdsPhotoCount(lineIdsParam: string, orgIdExpr: string): string {
  return `(SELECT COUNT(DISTINCT p.id)
     FROM photos p
     INNER JOIN photo_entity_links l ON l.photo_id = p.id AND l.organization_id = p.organization_id
    WHERE p.organization_id = ${orgIdExpr}
      AND l.entity_type = 'RECEIVING_LINE'
      AND l.entity_id = ANY(${lineIdsParam}))`;
}

export async function getReceivingPhotosByIds(input: {
  organizationId: string;
  receivingId: number;
  photoIds: number[];
}): Promise<Array<{ id: number; url: string | null }>> {
  if (input.photoIds.length === 0) return [];
  const res = await pool.query<{ id: string }>(
    `SELECT DISTINCT ON (p.id) p.id
       FROM photos p
       ${LINK_JOINS}
      WHERE p.organization_id = $1
        AND p.id = ANY($2::int[])
        AND (
          (l.entity_type = 'RECEIVING' AND l.entity_id = $3)
          OR (l.entity_type = 'RECEIVING_LINE' AND rl.receiving_id = $3)
        )
      ORDER BY p.id ASC`,
    [input.organizationId, input.photoIds, input.receivingId],
  );
  return res.rows.map((r) => ({
    id: Number(r.id),
    url: `/api/photos/${r.id}/content`,
  }));
}

export async function listAllReceivingPhotoIds(
  organizationId: string,
  receivingId: number,
): Promise<number[]> {
  const rows = await listReceivingPhotos({ organizationId, receivingId, scope: 'all' });
  return rows.map((r) => r.id);
}

export async function getReceivingPhotoDeleteMeta(
  photoId: number,
  organizationId: string,
): Promise<{
  receivingId: number | null;
  receivingLineId: number | null;
} | null> {
  const res = await pool.query<{
    entity_type: string;
    entity_id: string;
    receiving_id_resolved: string | null;
  }>(
    `SELECT
       l.entity_type,
       l.entity_id,
       CASE
         WHEN l.entity_type = 'RECEIVING' THEN l.entity_id
         WHEN l.entity_type = 'RECEIVING_LINE' THEN rl.receiving_id
         ELSE NULL
       END AS receiving_id_resolved
       FROM photos p
       ${LINK_JOINS}
      WHERE p.id = $1
        AND p.organization_id = $2
        AND l.entity_type IN ('RECEIVING', 'RECEIVING_LINE')`,
    [photoId, organizationId],
  );
  const row = res.rows[0];
  if (!row) return null;
  const isLine = row.entity_type === 'RECEIVING_LINE';
  return {
    receivingId:
      row.receiving_id_resolved != null ? Number(row.receiving_id_resolved) : null,
    receivingLineId: isLine ? Number(row.entity_id) : null,
  };
}
