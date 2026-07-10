import pool from '@/lib/db';
import { photoContentUrl } from '@/lib/photos/display-url';
import { UNIT_TESTING_PHOTO_TYPE } from '@/lib/photos/types';

/**
 * Photos for one unit's timeline, in two tagged buckets:
 *   • `testing` — SERIAL_UNIT photos with photo_type='testing_photo' (the packer
 *     testing-label scan captures).
 *   • `unbox`   — the unit's ORIGIN receiving line + its parent carton photos,
 *     reached via `serial_unit_provenance` (origin_type='RECEIVING_LINE') →
 *     `receiving_lines`. This is the join that pairs a unit's testing photos with
 *     the receiving unboxed photos of the same physical unit.
 *
 * Same `pool` + explicit `organization_id` predicate convention as the other
 * photo query helpers (tenant boundary is the predicate). Newest-first.
 * See docs/todo/packer-testing-photo-scan-timeline-plan.md.
 */

export interface UnitTimelinePhoto {
  photoId: number;
  at: string | null;
  source: 'testing' | 'unbox';
  takenByStaffId: number | null;
  thumbUrl: string;
  fullUrl: string;
}

interface DbRow {
  id: string;
  created_at: string;
  taken_by_staff_id: number | null;
  source: 'testing' | 'unbox';
}

export async function listUnitTimelinePhotos(
  organizationId: string,
  serialUnitId: number,
): Promise<UnitTimelinePhoto[]> {
  const res = await pool.query<DbRow>(
    `SELECT DISTINCT p.id, p.created_at, p.taken_by_staff_id, 'testing'::text AS source
       FROM photos p
       JOIN photo_entity_links l
         ON l.photo_id = p.id AND l.organization_id = p.organization_id
      WHERE p.organization_id = $1
        AND l.entity_type = 'SERIAL_UNIT'
        AND l.entity_id = $2
        AND lower(p.photo_type) = lower($3)
     UNION
     SELECT DISTINCT p.id, p.created_at, p.taken_by_staff_id, 'unbox'::text AS source
       FROM photos p
       JOIN photo_entity_links l
         ON l.photo_id = p.id AND l.organization_id = p.organization_id
       JOIN serial_unit_provenance sp
         ON sp.serial_unit_id = $2
        AND sp.origin_type = 'RECEIVING_LINE'
        AND sp.origin_id IS NOT NULL
        AND sp.organization_id = $1
       JOIN receiving_lines rl ON rl.id = sp.origin_id
      WHERE p.organization_id = $1
        AND (
          (l.entity_type = 'RECEIVING_LINE' AND l.entity_id = rl.id)
          OR (l.entity_type = 'RECEIVING' AND l.entity_id = rl.receiving_id)
        )
      ORDER BY created_at DESC`,
    [organizationId, serialUnitId, UNIT_TESTING_PHOTO_TYPE],
  );

  return res.rows.map((r) => {
    const id = Number(r.id);
    return {
      photoId: id,
      at: r.created_at,
      source: r.source,
      takenByStaffId: r.taken_by_staff_id != null ? Number(r.taken_by_staff_id) : null,
      thumbUrl: photoContentUrl(id, 'thumb'),
      fullUrl: photoContentUrl(id),
    };
  });
}
