import { NextRequest, NextResponse } from 'next/server';
import type { PoolClient } from 'pg';
import { tenantQuery, withTenantTransaction } from '@/lib/tenancy/db';
import { normalizePSTTimestamp } from '@/utils/date';
import {
  publishOrderAssignmentsUpdated,
  publishQueueAssignmentsUpdated,
} from '@/lib/realtime/publish';
import {
  getOrderAssignmentSnapshotsByOrderIds,
  getStaffNameMap,
} from '@/lib/work-assignments/order-assignment-snapshot';
import { withAuth } from '@/lib/auth/withAuth';
import { compareWorkOrderRows } from '@/lib/work-orders/ranking';
import { getOrders } from '@/lib/work-orders/queries';
import type { WorkOrderRow as SharedWorkOrderRow } from '@/components/work-orders/types';

type QueueKey =
  | 'all'
  | 'done'
  | 'all_unassigned'
  | 'all_assigned'
  | 'orders'
  | 'test_returns'
  | 'fba_shipments'
  | 'repair_services'
  | 'test_receiving'
  | 'local_pickups'
  | 'stock_replenish';

type WorkStatus = 'OPEN' | 'ASSIGNED' | 'IN_PROGRESS' | 'DONE' | 'CANCELED';
type EntityType = 'ORDER' | 'REPAIR' | 'FBA_SHIPMENT' | 'RECEIVING' | 'SKU_STOCK';
type WorkType = 'TEST' | 'PACK' | 'REPAIR' | 'QA' | 'STOCK_REPLENISH';

interface WorkOrderRow {
  id: string;
  entityType: EntityType;
  entityId: number;
  queueKey: Exclude<QueueKey, 'all' | 'all_unassigned' | 'all_assigned'>;
  queueLabel: string;
  title: string;
  subtitle: string;
  recordLabel: string;
  sourcePath: string;
  techId: number | null;
  techName: string | null;
  packerId: number | null;
  packerName: string | null;
  status: WorkStatus;
  priority: number;
  deadlineAt: string | null;
  notes: string | null;
  assignedAt: string | null;
  updatedAt: string | null;
  primaryAssignmentId: number | null;
  secondaryAssignmentId: number | null;
  primaryWorkType: WorkType;
  orderId?: string | null;
  trackingNumber?: string | null;
  itemNumber?: string | null;
  sku?: string | null;
  condition?: string | null;
  shipmentId?: number | string | null;
  accountSource?: string | null;
  quantity?: string | null;
  createdAt?: string | null;
  stockLevel?: number | null;
}

function normalizeQueue(raw: string | null): QueueKey {
  const value = String(raw || '').trim().toLowerCase();
  const allowed: QueueKey[] = [
    'all',
    'done',
    'all_unassigned',
    'all_assigned',
    'orders',
    'test_returns',
    'fba_shipments',
    'repair_services',
    'test_receiving',
    'local_pickups',
    'stock_replenish',
  ];
  return allowed.includes(value as QueueKey) ? (value as QueueKey) : 'all';
}

function normalizeStatus(raw: unknown): WorkStatus {
  const value = String(raw || '').trim().toUpperCase();
  if (value === 'ASSIGNED' || value === 'IN_PROGRESS' || value === 'DONE' || value === 'CANCELED') return value;
  return 'OPEN';
}

function isAssignedRow(row: SharedWorkOrderRow): boolean {
  return row.techId != null || row.packerId != null;
}

function isActionableRow(row: SharedWorkOrderRow): boolean {
  return row.status !== 'DONE' && row.status !== 'CANCELED';
}

function matchesSearch(row: SharedWorkOrderRow, query: string): boolean {
  if (!query.trim()) return true;
  const needle = query.trim().toLowerCase();
  const haystack = [
    row.title,
    row.subtitle,
    row.recordLabel,
    row.queueLabel,
    row.techName,
    row.packerName,
    row.notes,
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(needle);
}

function matchesQueue(row: SharedWorkOrderRow, queue: QueueKey): boolean {
  if (queue === 'all') return true;
  if (queue === 'done') return row.status === 'DONE';
  if (queue === 'all_unassigned') return isActionableRow(row) && !isAssignedRow(row);
  if (queue === 'all_assigned') return isActionableRow(row) && isAssignedRow(row);
  return row.queueKey === queue;
}

// Ranking now lives in the shared SoT (src/lib/work-orders/ranking.ts) so the
// per-operator header chip ranks identically to this queue.
const compareRows = compareWorkOrderRows;


async function getReceiving(orgId: string): Promise<WorkOrderRow[]> {
  const result = await tenantQuery(orgId,
    `SELECT
       r.id,
       COALESCE(stn.tracking_number_raw, r.receiving_tracking_number) AS receiving_tracking_number,
       COALESCE(NULLIF(stn.carrier, 'UNKNOWN'), r.carrier)             AS carrier,
       r.is_return,
       r.target_channel,
       r.notes AS receiving_notes,
       wa.id AS assignment_id,
       wa.assigned_tech_id,
       wa.assigned_packer_id,
       wa.status,
       wa.priority,
       wa.deadline_at,
       wa.notes,
       wa.assigned_at,
       wa.updated_at,
       st.name AS tech_name,
       sp.name AS packer_name
     FROM receiving r
     LEFT JOIN shipping_tracking_numbers stn ON stn.id = r.shipment_id
     LEFT JOIN LATERAL (
       SELECT *
       FROM work_assignments wa
       WHERE wa.entity_type = 'RECEIVING'
         AND wa.entity_id = r.id
         AND wa.work_type = 'TEST'
         AND wa.organization_id = $1
         AND wa.status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'DONE')
       ORDER BY CASE wa.status
         WHEN 'IN_PROGRESS' THEN 1
         WHEN 'ASSIGNED' THEN 2
         WHEN 'OPEN' THEN 3
         WHEN 'DONE' THEN 4
         ELSE 5
       END, wa.updated_at DESC, wa.id DESC
       LIMIT 1
     ) wa ON TRUE
     LEFT JOIN staff st ON st.id = wa.assigned_tech_id
     LEFT JOIN staff sp ON sp.id = wa.assigned_packer_id
     WHERE r.organization_id = $1
       AND (
            (
              -- Carton is flagged for test AND it still has at least one line that
              -- needs testing. Per-line needs_test (cables toggled off) drops a
              -- carton out only once EVERY line is no-test; cartons not yet lined
              -- (no receiving_lines rows) still show so they aren't hidden pre-unbox.
              COALESCE(r.needs_test, false) = true
              AND (
                NOT EXISTS (SELECT 1 FROM receiving_lines rl WHERE rl.receiving_id = r.id AND rl.organization_id = $1)
                OR EXISTS (
                  SELECT 1 FROM receiving_lines rl
                   WHERE rl.receiving_id = r.id AND rl.organization_id = $1 AND COALESCE(rl.needs_test, true) = true
                )
              )
            )
            OR COALESCE(r.is_return, false) = true
            OR UPPER(COALESCE(r.carrier, '')) = 'LOCAL'
          )
     -- is_priority (pending-order match or manual toggle) floats urgent cartons
     -- to the top of the tester's queue, matching the unbox Prioritize rail.
     ORDER BY COALESCE(r.is_priority, false) DESC,
              COALESCE(wa.deadline_at, r.received_at, r.created_at) ASC, r.id ASC
     LIMIT 500`,
    [orgId]
  );

  return result.rows.map((row) => {
    const isLocalPickup = String(row.carrier || '').toUpperCase() === 'LOCAL';
    const queueKey = isLocalPickup
      ? 'local_pickups'
      : row.is_return
      ? 'test_returns'
      : 'test_receiving';

    const queueLabelMap: Record<string, string> = {
      local_pickups: 'Local Pick-ups',
      test_returns: 'Test Returns',
      test_receiving: 'Test Receiving',
    };

    return {
      id: `RECEIVING:${row.id}`,
      entityType: 'RECEIVING' as const,
      entityId: Number(row.id),
      queueKey: queueKey as WorkOrderRow['queueKey'],
      queueLabel: queueLabelMap[queueKey],
      title: String(row.receiving_tracking_number || `Receiving #${row.id}`),
      subtitle: [row.carrier, row.target_channel].filter(Boolean).join(' • ') || 'Receiving intake',
      recordLabel: String(row.receiving_tracking_number || `Receiving #${row.id}`),
      sourcePath: '/receiving',
      techId: row.assigned_tech_id == null ? null : Number(row.assigned_tech_id),
      techName: row.tech_name ? String(row.tech_name) : null,
      packerId: row.assigned_packer_id == null ? null : Number(row.assigned_packer_id),
      packerName: row.packer_name ? String(row.packer_name) : null,
      status: normalizeStatus(row.status),
      priority: Number(row.priority || 100),
      deadlineAt: normalizePSTTimestamp(row.deadline_at),
      notes: (row.notes || row.receiving_notes) ? String(row.notes || row.receiving_notes) : null,
      assignedAt: normalizePSTTimestamp(row.assigned_at),
      updatedAt: normalizePSTTimestamp(row.updated_at),
      primaryAssignmentId: row.assignment_id == null ? null : Number(row.assignment_id),
      secondaryAssignmentId: null,
      primaryWorkType: 'TEST' as const,
    };
  });
}

async function getRepairs(orgId: string): Promise<WorkOrderRow[]> {
  const result = await tenantQuery(orgId,
    `SELECT
       rs.id,
       rs.ticket_number,
       rs.product_title,
       rs.issue,
       rs.notes AS repair_notes,
       wa.id AS assignment_id,
       wa.assigned_tech_id,
       wa.assigned_packer_id,
       wa.status,
       wa.priority,
       wa.deadline_at,
       wa.notes,
       wa.assigned_at,
       wa.updated_at,
       st.name AS tech_name,
       sp.name AS packer_name
     FROM repair_service rs
     LEFT JOIN LATERAL (
       SELECT *
       FROM work_assignments wa
       WHERE wa.entity_type = 'REPAIR'
         AND wa.entity_id = rs.id
         AND wa.work_type = 'REPAIR'
         AND wa.organization_id = $1
         AND wa.status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'DONE')
       ORDER BY CASE wa.status
         WHEN 'IN_PROGRESS' THEN 1
         WHEN 'ASSIGNED' THEN 2
         WHEN 'OPEN' THEN 3
         WHEN 'DONE' THEN 4
         ELSE 5
       END, wa.updated_at DESC, wa.id DESC
       LIMIT 1
     ) wa ON TRUE
     LEFT JOIN staff st ON st.id = wa.assigned_tech_id
     LEFT JOIN staff sp ON sp.id = wa.assigned_packer_id
     WHERE rs.organization_id = $1
       AND COALESCE(rs.status, '') NOT IN ('Done', 'Shipped', 'Picked Up')
     ORDER BY COALESCE(wa.deadline_at, wa.updated_at) ASC NULLS LAST, rs.id ASC`,
    [orgId]
  );

  return result.rows.map((row) => {
    const ticketLabel = String(row.ticket_number || `Repair #${row.id}`);
    const issueText = row.issue ? String(row.issue) : '';
    const titleText = String(row.product_title || issueText || ticketLabel);
    const subtitleText = [issueText || null, ticketLabel].filter(Boolean).join(' • ') || 'Repair work order';

    return {
      id: `REPAIR:${row.id}`,
      entityType: 'REPAIR' as const,
      entityId: Number(row.id),
      queueKey: 'repair_services' as const,
      queueLabel: 'Repair Services',
      title: titleText,
      subtitle: subtitleText,
      recordLabel: ticketLabel,
      sourcePath: '/repair',
      techId: row.assigned_tech_id == null ? null : Number(row.assigned_tech_id),
      techName: row.tech_name ? String(row.tech_name) : null,
      packerId: row.assigned_packer_id == null ? null : Number(row.assigned_packer_id),
      packerName: row.packer_name ? String(row.packer_name) : null,
      status: normalizeStatus(row.status),
      priority: Number(row.priority || 100),
      deadlineAt: normalizePSTTimestamp(row.deadline_at),
      notes: (row.notes || row.repair_notes) ? String(row.notes || row.repair_notes) : null,
      assignedAt: normalizePSTTimestamp(row.assigned_at),
      updatedAt: normalizePSTTimestamp(row.updated_at),
      primaryAssignmentId: row.assignment_id == null ? null : Number(row.assignment_id),
      secondaryAssignmentId: null,
      primaryWorkType: 'REPAIR' as const,
    };
  });
}

async function getFbaShipments(orgId: string): Promise<WorkOrderRow[]> {
  const result = await tenantQuery(orgId,
    `SELECT
       fs.id,
       fs.shipment_ref,
       fs.notes AS shipment_notes,
       fs.assigned_tech_id AS native_tech_id,
       fs.assigned_packer_id AS native_packer_id,
       wa.id AS assignment_id,
       wa.assigned_tech_id,
       wa.assigned_packer_id,
       wa.status,
       wa.priority,
       wa.deadline_at,
       wa.notes,
       wa.assigned_at,
       wa.updated_at,
       st.name AS tech_name,
       sp.name AS packer_name
     FROM fba_shipments fs
     LEFT JOIN LATERAL (
       SELECT *
       FROM work_assignments wa
       WHERE wa.entity_type = 'FBA_SHIPMENT'
         AND wa.entity_id = fs.id
         AND wa.work_type = 'QA'
         AND wa.organization_id = $1
         AND wa.status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'DONE')
       ORDER BY CASE wa.status
         WHEN 'IN_PROGRESS' THEN 1
         WHEN 'ASSIGNED' THEN 2
         WHEN 'OPEN' THEN 3
         WHEN 'DONE' THEN 4
         ELSE 5
       END, wa.updated_at DESC, wa.id DESC
       LIMIT 1
     ) wa ON TRUE
     LEFT JOIN staff st ON st.id = COALESCE(wa.assigned_tech_id, fs.assigned_tech_id)
     LEFT JOIN staff sp ON sp.id = COALESCE(wa.assigned_packer_id, fs.assigned_packer_id)
     WHERE fs.organization_id = $1
       AND COALESCE(fs.status, 'PLANNED') <> 'SHIPPED'
     ORDER BY fs.created_at DESC NULLS LAST, fs.id DESC
     LIMIT 500`,
    [orgId]
  );

  return result.rows.map((row) => ({
    id: `FBA_SHIPMENT:${row.id}`,
    entityType: 'FBA_SHIPMENT' as const,
    entityId: Number(row.id),
    queueKey: 'fba_shipments' as const,
    queueLabel: 'FBA Shipments',
    title: String(row.shipment_ref || `FBA #${row.id}`),
    subtitle: `Shipment #${row.id}`,
    recordLabel: String(row.shipment_ref || `FBA #${row.id}`),
    sourcePath: '/fba',
    techId: row.assigned_tech_id == null ? (row.native_tech_id == null ? null : Number(row.native_tech_id)) : Number(row.assigned_tech_id),
    techName: row.tech_name ? String(row.tech_name) : null,
    packerId: row.assigned_packer_id == null ? (row.native_packer_id == null ? null : Number(row.native_packer_id)) : Number(row.assigned_packer_id),
    packerName: row.packer_name ? String(row.packer_name) : null,
    status: normalizeStatus(row.status || (row.native_tech_id ? 'ASSIGNED' : 'OPEN')),
    priority: Number(row.priority || 100),
    deadlineAt: normalizePSTTimestamp(row.deadline_at),
    notes: (row.notes || row.shipment_notes) ? String(row.notes || row.shipment_notes) : null,
    assignedAt: normalizePSTTimestamp(row.assigned_at),
    updatedAt: normalizePSTTimestamp(row.updated_at),
    primaryAssignmentId: row.assignment_id == null ? null : Number(row.assignment_id),
    secondaryAssignmentId: null,
    primaryWorkType: 'QA' as const,
  }));
}

async function getSkuStock(orgId: string): Promise<WorkOrderRow[]> {
  // Only return rows with an assigned/in-progress/done work assignment.
  // Unassigned sku_stock rows (no WA, or WA status = OPEN) are intentionally
  // excluded — use /api/assignments/sku-search to search then assign them.
  const result = await tenantQuery(orgId,
    `SELECT
       ss.id,
       ss.sku,
       ss.product_title,
       ss.stock,
       wa.id          AS assignment_id,
       wa.assigned_tech_id,
       wa.assigned_packer_id,
       wa.status,
       wa.priority,
       wa.deadline_at,
       wa.notes,
       wa.assigned_at,
       wa.updated_at,
       st.name        AS tech_name,
       sp.name        AS packer_name
     FROM sku_stock ss
     INNER JOIN LATERAL (
       SELECT *
       FROM work_assignments
       WHERE entity_type = 'SKU_STOCK'
         AND entity_id   = ss.id
         AND work_type   = 'STOCK_REPLENISH'
         AND organization_id = $1
         AND status IN ('ASSIGNED', 'IN_PROGRESS', 'DONE')
       ORDER BY CASE status
         WHEN 'IN_PROGRESS' THEN 1
         WHEN 'ASSIGNED'    THEN 2
         WHEN 'DONE'        THEN 3
         ELSE 4
       END, updated_at DESC, id DESC
       LIMIT 1
     ) wa ON TRUE
     LEFT JOIN staff st ON st.id = wa.assigned_tech_id
     LEFT JOIN staff sp ON sp.id = wa.assigned_packer_id
     WHERE ss.organization_id = $1
     ORDER BY CASE wa.status
       WHEN 'IN_PROGRESS' THEN 1
       WHEN 'ASSIGNED'    THEN 2
       WHEN 'DONE'        THEN 3
       ELSE 4
     END,
     wa.priority ASC,
     COALESCE(ss.stock, 0) ASC,
     ss.id DESC
     LIMIT 500`,
    [orgId]
  );

  return result.rows.map((row) => {
    const stockLevel = Number.parseInt(String(row.stock || '0').replace(/[^0-9-]+/g, ''), 10);
    return {
      id: `SKU_STOCK:${row.id}`,
      entityType: 'SKU_STOCK' as const,
      entityId: Number(row.id),
      queueKey: 'stock_replenish' as const,
      queueLabel: 'Stock Replenish',
      title: String(row.product_title || row.sku || `SKU Stock #${row.id}`),
      subtitle: `SKU ${String(row.sku || 'N/A')} • Stock ${Number.isFinite(stockLevel) ? stockLevel : 0}`,
      recordLabel: String(row.sku || `SKU Stock #${row.id}`),
      sourcePath: '/sku-stock',
      techId: row.assigned_tech_id == null ? null : Number(row.assigned_tech_id),
      techName: row.tech_name ? String(row.tech_name) : null,
      packerId: null,
      packerName: null,
      status: normalizeStatus(row.status),
      priority: Number(row.priority || 100),
      deadlineAt: normalizePSTTimestamp(row.deadline_at),
      notes: row.notes ? String(row.notes) : null,
      assignedAt: normalizePSTTimestamp(row.assigned_at),
      updatedAt: normalizePSTTimestamp(row.updated_at),
      primaryAssignmentId: row.assignment_id == null ? null : Number(row.assignment_id),
      secondaryAssignmentId: null,
      primaryWorkType: 'STOCK_REPLENISH' as const,
      stockLevel: Number.isFinite(stockLevel) ? stockLevel : 0,
    };
  });
}

async function upsertAssignment(client: PoolClient, orgId: string, params: {
  entityType: EntityType;
  entityId: number;
  workType: WorkType;
  assignedTechId: number | null;
  assignedPackerId: number | null;
  completedByPackerId?: number | null;
  status: WorkStatus;
  priority: number;
  deadlineAt: string | null;
  notes: string | null;
  allowInsertWhenEmpty?: boolean;
}) {
  const existing = await client.query<{ id: number }>(
    `SELECT id
     FROM work_assignments
     WHERE entity_type = $1
       AND entity_id = $2
       AND work_type = $3
       AND organization_id = $4
       AND status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS')
     ORDER BY CASE status
       WHEN 'IN_PROGRESS' THEN 1
       WHEN 'ASSIGNED' THEN 2
       WHEN 'OPEN' THEN 3
       ELSE 4
     END, updated_at DESC, id DESC
     LIMIT 1`,
    [params.entityType, params.entityId, params.workType, orgId]
  );

  const shouldInsert =
    params.allowInsertWhenEmpty !== false &&
    (params.assignedTechId != null ||
      params.assignedPackerId != null ||
      params.status !== 'OPEN' ||
      params.notes != null ||
      params.deadlineAt != null ||
      params.priority !== 100);

  if (existing.rows[0]) {
    await client.query(
      `UPDATE work_assignments
       SET assigned_tech_id = $1,
           assigned_packer_id = $2,
           status = $3::assignment_status_enum,
           priority = $4,
           deadline_at = $5,
           notes = $6,
           started_at = CASE WHEN $3::text = 'IN_PROGRESS' THEN COALESCE(started_at, NOW()) ELSE started_at END,
           completed_at = CASE WHEN $3::text IN ('DONE', 'CANCELED') THEN COALESCE(completed_at, NOW()) ELSE NULL END,
           completed_by_packer_id = CASE WHEN $3::text = 'DONE' THEN COALESCE($8, completed_by_packer_id) ELSE completed_by_packer_id END,
           updated_at = NOW()
       WHERE id = $7 AND organization_id = $9`,
      [
        params.assignedTechId,
        params.assignedPackerId,
        params.status,
        params.priority,
        params.deadlineAt,
        params.notes,
        existing.rows[0].id,
        params.completedByPackerId ?? null,
        orgId,
      ]
    );
    return existing.rows[0].id;
  }

  if (!shouldInsert) return null;

  // Two concurrent PATCHes can both miss the SELECT and attempt INSERT; the partial
  // unique index ux_work_assignments_active_entity then raises a duplicate key.
  // ON CONFLICT makes this path atomic (same pattern as shipstation deadline upsert).
  const inserted = await client.query<{ id: number }>(
    `INSERT INTO work_assignments
       (organization_id, entity_type, entity_id, work_type, assigned_tech_id, assigned_packer_id,
        completed_by_packer_id, status, priority, deadline_at, notes)
     VALUES ($11, $1, $2, $3, $4, $5, $6, $7::assignment_status_enum, $8, $9, $10)
     ON CONFLICT (entity_type, entity_id, work_type)
       WHERE (status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS'))
     DO UPDATE SET
       assigned_tech_id = EXCLUDED.assigned_tech_id,
       assigned_packer_id = EXCLUDED.assigned_packer_id,
       status = EXCLUDED.status,
       priority = EXCLUDED.priority,
       deadline_at = EXCLUDED.deadline_at,
       notes = EXCLUDED.notes,
       started_at = CASE
         WHEN EXCLUDED.status::text = 'IN_PROGRESS' THEN COALESCE(work_assignments.started_at, NOW())
         ELSE work_assignments.started_at
       END,
       completed_at = CASE
         WHEN EXCLUDED.status::text IN ('DONE', 'CANCELED') THEN COALESCE(work_assignments.completed_at, NOW())
         ELSE NULL
       END,
       completed_by_packer_id = CASE
         WHEN EXCLUDED.status::text = 'DONE' THEN COALESCE(EXCLUDED.completed_by_packer_id, work_assignments.completed_by_packer_id)
         ELSE work_assignments.completed_by_packer_id
       END,
       updated_at = NOW()
     RETURNING id`,
    [
      params.entityType,
      params.entityId,
      params.workType,
      params.assignedTechId,
      params.assignedPackerId,
      params.completedByPackerId ?? null,
      params.status,
      params.priority,
      params.deadlineAt,
      params.notes,
      orgId,
    ]
  );
  return inserted.rows[0]?.id ?? null;
}

async function safeFetch<T>(label: string, fn: () => Promise<T[]>): Promise<T[]> {
  try {
    return await fn();
  } catch (err: any) {
    console.error(`[work-orders] ${label} failed:`, err?.message || err);
    return [];
  }
}

export const GET = withAuth(async (request: NextRequest, ctx) => {
  try {
    const { searchParams } = new URL(request.url);
    const queue = normalizeQueue(searchParams.get('queue'));
    const query = String(searchParams.get('q') || '').trim();

    // Only pending orders for now — receiving, FBA, repair, stock queues disabled
    const [orders] = await Promise.all([
      safeFetch('getOrders', () => getOrders(ctx.organizationId)),
    ]);

    const allRows = [...orders];

    const counts: Record<QueueKey, number> = {
      all: allRows.length,
      done: allRows.filter((row) => matchesQueue(row, 'done')).length,
      all_unassigned: allRows.filter((row) => matchesQueue(row, 'all_unassigned')).length,
      all_assigned: allRows.filter((row) => matchesQueue(row, 'all_assigned')).length,
      orders: allRows.filter((row) => row.queueKey === 'orders').length,
      test_returns: allRows.filter((row) => row.queueKey === 'test_returns').length,
      fba_shipments: allRows.filter((row) => row.queueKey === 'fba_shipments').length,
      repair_services: allRows.filter((row) => row.queueKey === 'repair_services').length,
      test_receiving: allRows.filter((row) => row.queueKey === 'test_receiving').length,
      local_pickups: allRows.filter((row) => row.queueKey === 'local_pickups').length,
      stock_replenish: allRows.filter((row) => row.queueKey === 'stock_replenish').length,
    };

    const rows = allRows
      .filter((row) => matchesQueue(row, queue))
      .filter((row) => matchesSearch(row, query))
      .sort(compareRows);

    return NextResponse.json({ rows, counts });
  } catch (error: any) {
    console.error('Failed to fetch work orders:', error);
    return NextResponse.json(
      { error: 'Failed to fetch work orders', details: error?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}, { permission: 'work_orders.view' });

export const PATCH = withAuth(async (request: NextRequest, ctx) => {
  try {
    const body = await request.json();
    const entityType = String(body?.entityType || '').trim().toUpperCase() as EntityType;
    const entityId = Number(body?.entityId);
    const techIdRaw = Number(body?.assignedTechId);
    const packerIdRaw = Number(body?.assignedPackerId);
    const priorityRaw = Number(body?.priority);
    const status = normalizeStatus(body?.status);
    const deadlineAt = normalizePSTTimestamp(body?.deadlineAt);
    const notes = String(body?.notes || '').trim() || null;

    // Track whether assignedPackerId was explicitly included in the request body.
    // When it is absent (undefined) the caller is doing a tech-only partial save and
    // we must NOT touch the PACK work-assignment — otherwise we would null-out any
    // packer that was already saved, causing the "packer disappears" bug.
    const packerIdProvided = 'assignedPackerId' in (body ?? {});

    if (!['ORDER', 'REPAIR', 'FBA_SHIPMENT', 'RECEIVING', 'SKU_STOCK'].includes(entityType)) {
      return NextResponse.json({ error: 'Invalid entityType' }, { status: 400 });
    }
    if (!Number.isFinite(entityId) || entityId <= 0) {
      return NextResponse.json({ error: 'Invalid entityId' }, { status: 400 });
    }

    const assignedTechId = Number.isFinite(techIdRaw) && techIdRaw > 0 ? techIdRaw : null;
    const assignedPackerId = Number.isFinite(packerIdRaw) && packerIdRaw > 0 ? packerIdRaw : null;
    const priority = Number.isFinite(priorityRaw) ? Math.max(1, Math.min(priorityRaw, 9999)) : 100;

    // Map each entity type to its org-bearing parent table for the ownership
    // gate. Keys are the validated EntityType union — never user input — so the
    // identifier interpolated into the SQL below cannot be attacker-controlled.
    const parentTable: Record<EntityType, string> = {
      ORDER: 'orders',
      REPAIR: 'repair_service',
      FBA_SHIPMENT: 'fba_shipments',
      RECEIVING: 'receiving',
      SKU_STOCK: 'sku_stock',
    };

    const owned = await withTenantTransaction(ctx.organizationId, async (client) => {
      // Verify the target entity belongs to the caller's org before any write.
      // A cross-tenant entityId returns false → 404 (hide existence), closing the
      // work-assignment / fba_shipments / receiving cross-tenant write breach.
      const owns = await client.query(
        `SELECT 1 FROM ${parentTable[entityType]} WHERE id = $1 AND organization_id = $2`,
        [entityId, ctx.organizationId],
      );
      if (owns.rowCount === 0) return false;

      if (entityType === 'ORDER') {
        // TEST row owns the technician slot; never write packer here.
        await upsertAssignment(client, ctx.organizationId, {
          entityType: 'ORDER',
          entityId,
          workType: 'TEST',
          assignedTechId,
          assignedPackerId: null,
          status,
          priority,
          deadlineAt,
          notes,
        });

        // PACK row owns the packer slot.  Only upsert it when the caller explicitly
        // included assignedPackerId in the request body — either to set a new packer
        // (non-null) or to intentionally clear one (null).  Skipping this call on
        // tech-only partial saves prevents the PACK WA from being null-wiped.
        if (packerIdProvided) {
          await upsertAssignment(client, ctx.organizationId, {
            entityType: 'ORDER',
            entityId,
            workType: 'PACK',
            assignedTechId: null,
            assignedPackerId,
            completedByPackerId: status === 'DONE' ? (assignedPackerId ?? null) : null,
            status,
            priority,
            deadlineAt: null,
            notes,
            allowInsertWhenEmpty: assignedPackerId != null,
          });
        }

        // is_shipped is now derived from shipping_tracking_numbers; no direct write needed
      } else {
        const workType: WorkType =
          entityType === 'REPAIR'
            ? 'REPAIR'
            : entityType === 'FBA_SHIPMENT'
            ? 'QA'
            : entityType === 'SKU_STOCK'
            ? 'STOCK_REPLENISH'
            : 'TEST';

        await upsertAssignment(client, ctx.organizationId, {
          entityType,
          entityId,
          workType,
          assignedTechId,
          assignedPackerId,
          status,
          priority,
          deadlineAt,
          notes,
        });

        if (entityType === 'FBA_SHIPMENT') {
          await client.query(
            `UPDATE fba_shipments
             SET assigned_tech_id = $1,
                 assigned_packer_id = $2
             WHERE id = $3 AND organization_id = $4`,
            [assignedTechId, assignedPackerId, entityId, ctx.organizationId]
          );
        }

        if (entityType === 'RECEIVING') {
          await client.query(
            `UPDATE receiving
             SET assigned_tech_id = $1,
                 updated_at = NOW()
             WHERE id = $2 AND organization_id = $3`,
            [assignedTechId, entityId, ctx.organizationId]
          );
        }
      }
      return true;
    });

    if (!owned) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    try {
      if (entityType === 'ORDER') {
        const snaps = await getOrderAssignmentSnapshotsByOrderIds([entityId]);
        const snap = snaps.get(entityId) ?? { testerId: null, packerId: null, deadlineAt: null };
        const nameMap = await getStaffNameMap([snap.testerId, snap.packerId]);
        await publishOrderAssignmentsUpdated({
          organizationId: ctx.organizationId,
          orderId: entityId,
          testerId: snap.testerId,
          packerId: snap.packerId,
          testerName: snap.testerId != null ? nameMap.get(snap.testerId) ?? null : null,
          packerName: snap.packerId != null ? nameMap.get(snap.packerId) ?? null : null,
          deadlineAt: snap.deadlineAt,
          source: 'work-orders.patch',
        });
      } else {
        await publishQueueAssignmentsUpdated({
          organizationId: ctx.organizationId,
          entityType,
          entityId,
          source: 'work-orders.patch',
        });
      }
    } catch (broadcastErr) {
      console.warn('[work-orders PATCH] realtime broadcast failed (non-critical):', broadcastErr);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Failed to update work order:', error);
    return NextResponse.json(
      { error: 'Failed to update work order', details: error?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}, { permission: 'work_orders.claim' });
