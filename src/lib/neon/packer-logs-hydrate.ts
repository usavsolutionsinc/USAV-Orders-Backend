import pool from '@/lib/db';
import type { OrgId } from '@/lib/tenancy/constants';

/**
 * Spine-first deferred fields for the shipped table. The main `/api/packerlogs`
 * spine response omits these (display-only, per-row work_assignments laterals +
 * the photos round-trip) so the page paints immediately; this endpoint computes
 * ONLY these fields for the already-selected page of station_activity_logs ids
 * and the client merges them in.
 *
 * The SQL mirrors the exact expressions the full enriched query uses (same
 * ORDER BY / status precedence, same photo shape), so a hydrated row is
 * byte-identical to what the full query would have returned.
 */
export interface PackerLogHydration {
  ship_by_date: string | null;
  deadline_at: string | null;
  tester_id: number | null;
  tester_name: string | null;
  packer_photos_url: Array<{ id: number; url: string; uploadedAt: string }>;
}

export async function fetchPackerLogHydration(opts: {
  organizationId: OrgId;
  salIds: number[];
}): Promise<Record<number, PackerLogHydration>> {
  const { organizationId } = opts;
  const ids = Array.from(
    new Set(opts.salIds.map((n) => Number(n)).filter((n) => Number.isFinite(n))),
  );
  if (ids.length === 0) return {};

  // work_assignments deadline + assigned tester, keyed via the matched order
  // (enr.order_row_id — the projection is fully backfilled, so this is a cheap
  // 1:1 hop). Bounded to the given page of sal ids and org-scoped.
  const waResult = await pool.query<{
    sal_id: number;
    packer_log_id: number | null;
    deadline_at: string | null;
    tester_id: number | null;
    tester_name: string | null;
  }>(
    `WITH sel AS (
        SELECT sal.id AS sal_id, sal.packer_log_id, enr.order_row_id AS order_id
        FROM station_activity_logs sal
        LEFT JOIN packer_log_enrichment enr ON enr.sal_id = sal.id
        WHERE sal.id = ANY($1::int[]) AND sal.organization_id = $2
     )
     SELECT sel.sal_id,
            sel.packer_log_id,
            to_char(wa_deadline.deadline_at, 'YYYY-MM-DD HH24:MI:SS') AS deadline_at,
            wa_t.assigned_tech_id AS tester_id,
            tester_staff.name AS tester_name
       FROM sel
       LEFT JOIN orders o ON o.id = sel.order_id AND o.organization_id = $2
       LEFT JOIN LATERAL (
           SELECT wa.deadline_at
           FROM work_assignments wa
           WHERE wa.entity_type = 'ORDER' AND wa.entity_id = o.id AND wa.work_type = 'TEST'
           ORDER BY
             CASE wa.status
               WHEN 'IN_PROGRESS' THEN 1
               WHEN 'ASSIGNED' THEN 2
               WHEN 'OPEN' THEN 3
               WHEN 'DONE' THEN 4
               ELSE 5
             END,
             wa.updated_at DESC,
             wa.id DESC
           LIMIT 1
       ) wa_deadline ON TRUE
       LEFT JOIN LATERAL (
           SELECT wa.assigned_tech_id
           FROM work_assignments wa
           WHERE wa.entity_type = 'ORDER' AND wa.entity_id = o.id AND wa.work_type = 'TEST'
             AND wa.status IN ('ASSIGNED', 'IN_PROGRESS')
           ORDER BY wa.created_at DESC, wa.id DESC
           LIMIT 1
       ) wa_t ON TRUE
       LEFT JOIN staff tester_staff ON tester_staff.id = wa_t.assigned_tech_id`,
    [ids, organizationId],
  );

  // Photos keyed by packer_log_id (same query the full path runs), mapped back
  // to sal id below.
  const packerLogIds = waResult.rows
    .map((r) => r.packer_log_id)
    .filter((id): id is number => id != null);

  const photosByPackerLog: Record<number, PackerLogHydration['packer_photos_url']> = {};
  if (packerLogIds.length > 0) {
    try {
      const photosResult = await pool.query<{
        entity_id: number;
        photos: PackerLogHydration['packer_photos_url'];
      }>(
        `SELECT l.entity_id,
                json_agg(
                  json_build_object(
                    'id', p.id,
                    'url', '/api/photos/' || p.id::text || '/content',
                    'uploadedAt', p.created_at
                  )
                  ORDER BY p.created_at
                ) AS photos
           FROM photos p
           JOIN photo_entity_links l
             ON l.photo_id = p.id
            AND l.organization_id = p.organization_id
          WHERE l.entity_type = 'PACKER_LOG'
            AND l.link_role = 'primary'
            AND l.entity_id = ANY($1)
            AND l.organization_id = $2
          GROUP BY l.entity_id`,
        [packerLogIds, organizationId],
      );
      for (const row of photosResult.rows) {
        photosByPackerLog[row.entity_id] = row.photos;
      }
    } catch (error) {
      // Degrade-not-fail: a photo lookup failure hydrates without photos.
      console.warn('[packer-logs-hydrate] photo lookup failed; hydrating without photos', error);
    }
  }

  const out: Record<number, PackerLogHydration> = {};
  for (const row of waResult.rows) {
    out[row.sal_id] = {
      // ship_by_date and deadline_at are the same expression in the full query.
      ship_by_date: row.deadline_at,
      deadline_at: row.deadline_at,
      tester_id: row.tester_id,
      tester_name: row.tester_name,
      packer_photos_url: row.packer_log_id != null ? photosByPackerLog[row.packer_log_id] ?? [] : [],
    };
  }
  return out;
}
