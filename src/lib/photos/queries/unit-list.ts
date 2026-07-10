import pool from '@/lib/db';

/**
 * Serial-unit photo read helpers — the unit mirror of `packer-list.ts`.
 *
 * SERIAL_UNIT photos are stored polymorphically on `photos`, linked via
 * `photo_entity_links` with `entity_type='SERIAL_UNIT'`, `entity_id=serial_units.id`.
 * Same `pool` + explicit `organization_id` predicate convention as the receiving
 * and packer lists (tenant boundary is the predicate, not a per-call GUC txn).
 */

const LINK_JOINS = `
  INNER JOIN photo_entity_links l ON l.photo_id = p.id AND l.organization_id = p.organization_id
`;

/** Count photos linked to one serial_unit (for the live `total_photo_count`). */
export async function countUnitPhotos(
  organizationId: string,
  serialUnitId: number,
): Promise<number> {
  const res = await pool.query<{ c: string }>(
    `SELECT COUNT(DISTINCT p.id) AS c
       FROM photos p
       ${LINK_JOINS}
      WHERE p.organization_id = $1
        AND l.entity_type = 'SERIAL_UNIT'
        AND l.entity_id = $2`,
    [organizationId, serialUnitId],
  );
  return Number(res.rows[0]?.c ?? 0);
}
