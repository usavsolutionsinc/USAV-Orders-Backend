import pool from '@/lib/db';

const ACTIVE_STATUSES = `('OPEN', 'ASSIGNED', 'IN_PROGRESS')`;

const WA_ORDER_BY = `
  ORDER BY entity_id,
    CASE status WHEN 'IN_PROGRESS' THEN 1 WHEN 'ASSIGNED' THEN 2 WHEN 'OPEN' THEN 3 ELSE 4 END,
    updated_at DESC NULLS LAST,
    id DESC
`;

export type OrderAssignmentSnapshot = {
  testerId: number | null;
  packerId: number | null;
  deadlineAt: string | null;
};

/**
 * Latest TEST (tech + deadline) and PACK (packer) rows per order id for realtime broadcasts.
 */
export async function getOrderAssignmentSnapshotsByOrderIds(
  orderIds: number[]
): Promise<Map<number, OrderAssignmentSnapshot>> {
  const unique = Array.from(
    new Set(orderIds.map(Number).filter((id) => Number.isFinite(id) && id > 0))
  );
  if (unique.length === 0) return new Map();

  const [testQ, packQ] = await Promise.all([
    pool.query<{
      entity_id: number;
      assigned_tech_id: number | null;
      deadline_at: Date | string | null;
    }>(
      `SELECT DISTINCT ON (entity_id) entity_id, assigned_tech_id, deadline_at
       FROM work_assignments
       WHERE entity_type = 'ORDER'
         AND entity_id = ANY($1::int[])
         AND work_type = 'TEST'
         AND status IN ${ACTIVE_STATUSES}
       ${WA_ORDER_BY}`,
      [unique]
    ),
    pool.query<{ entity_id: number; assigned_packer_id: number | null }>(
      `SELECT DISTINCT ON (entity_id) entity_id, assigned_packer_id
       FROM work_assignments
       WHERE entity_type = 'ORDER'
         AND entity_id = ANY($1::int[])
         AND work_type = 'PACK'
         AND status IN ${ACTIVE_STATUSES}
       ${WA_ORDER_BY}`,
      [unique]
    ),
  ]);

  const map = new Map<number, OrderAssignmentSnapshot>();
  for (const id of unique) {
    map.set(id, { testerId: null, packerId: null, deadlineAt: null });
  }

  for (const row of testQ.rows) {
    const id = Number(row.entity_id);
    const cur = map.get(id);
    if (!cur) continue;
    cur.testerId =
      row.assigned_tech_id != null && Number.isFinite(Number(row.assigned_tech_id))
        ? Number(row.assigned_tech_id)
        : null;
    cur.deadlineAt =
      row.deadline_at != null ? String(row.deadline_at) : null;
  }

  for (const row of packQ.rows) {
    const id = Number(row.entity_id);
    const cur = map.get(id);
    if (!cur) continue;
    cur.packerId =
      row.assigned_packer_id != null && Number.isFinite(Number(row.assigned_packer_id))
        ? Number(row.assigned_packer_id)
        : null;
  }

  return map;
}

export async function getStaffNameMap(staffIds: Array<number | null | undefined>): Promise<Map<number, string>> {
  const unique = Array.from(
    new Set(
      staffIds
        .map((n) => (n == null ? NaN : Number(n)))
        .filter((n) => Number.isFinite(n) && n > 0)
    )
  );
  if (unique.length === 0) return new Map();

  const r = await pool.query<{ id: number; name: string | null }>(
    `SELECT id, name FROM staff WHERE id = ANY($1::int[])`,
    [unique]
  );
  return new Map(
    r.rows.map((row) => [Number(row.id), String(row.name ?? '').trim() || `Staff #${row.id}`])
  );
}
