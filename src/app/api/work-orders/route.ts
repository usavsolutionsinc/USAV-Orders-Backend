import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

type QueueKey =
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
  queueKey: Exclude<QueueKey, 'all_unassigned' | 'all_assigned'>;
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
  stockLevel?: number | null;
}

function normalizeQueue(raw: string | null): QueueKey {
  const value = String(raw || '').trim().toLowerCase();
  const allowed: QueueKey[] = [
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
  return allowed.includes(value as QueueKey) ? (value as QueueKey) : 'all_unassigned';
}

function normalizeStatus(raw: unknown): WorkStatus {
  const value = String(raw || '').trim().toUpperCase();
  if (value === 'ASSIGNED' || value === 'IN_PROGRESS' || value === 'DONE' || value === 'CANCELED') return value;
  return 'OPEN';
}

function isAssignedRow(row: WorkOrderRow): boolean {
  return row.techId != null && row.packerId != null;
}

function matchesSearch(row: WorkOrderRow, query: string): boolean {
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

function matchesQueue(row: WorkOrderRow, queue: QueueKey): boolean {
  if (queue === 'all_unassigned') return !isAssignedRow(row);
  if (queue === 'all_assigned') return isAssignedRow(row);
  return row.queueKey === queue;
}

function compareRows(a: WorkOrderRow, b: WorkOrderRow): number {
  const statusRank = (value: WorkStatus) => {
    if (value === 'IN_PROGRESS') return 0;
    if (value === 'ASSIGNED') return 1;
    if (value === 'OPEN') return 2;
    if (value === 'DONE') return 3;
    return 4;
  };

  const deadlineA = a.deadlineAt ? new Date(a.deadlineAt).getTime() : Number.MAX_SAFE_INTEGER;
  const deadlineB = b.deadlineAt ? new Date(b.deadlineAt).getTime() : Number.MAX_SAFE_INTEGER;

  if ((a.stockLevel ?? null) != null || (b.stockLevel ?? null) != null) {
    const stockA = a.stockLevel ?? Number.MAX_SAFE_INTEGER;
    const stockB = b.stockLevel ?? Number.MAX_SAFE_INTEGER;
    if (stockA !== stockB) return stockA - stockB;
  }
  if (statusRank(a.status) !== statusRank(b.status)) return statusRank(a.status) - statusRank(b.status);
  if (a.priority !== b.priority) return a.priority - b.priority;
  if (deadlineA !== deadlineB) return deadlineA - deadlineB;
  return a.entityId - b.entityId;
}

async function getOrders(): Promise<WorkOrderRow[]> {
  const result = await pool.query(
    `SELECT
       o.id,
       o.order_id,
       o.product_title,
       o.item_number,
       stn.tracking_number_raw AS tracking_number,
       o.sku,
       o.notes,
       test_wa.id AS test_assignment_id,
       test_wa.assigned_tech_id AS tech_id,
       st.name AS tech_name,
       test_wa.status AS test_status,
       test_wa.priority AS test_priority,
       test_wa.deadline_at AS deadline_at,
       test_wa.notes AS test_notes,
       test_wa.assigned_at AS test_assigned_at,
       test_wa.updated_at AS test_updated_at,
       pack_wa.id AS pack_assignment_id,
       pack_wa.assigned_packer_id AS packer_id,
       sp.name AS packer_name
     FROM orders o
     LEFT JOIN LATERAL (
       SELECT *
       FROM work_assignments wa
       WHERE wa.entity_type = 'ORDER'
         AND wa.entity_id = o.id
         AND wa.work_type = 'TEST'
         AND wa.status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS')
       ORDER BY CASE wa.status
         WHEN 'IN_PROGRESS' THEN 1
         WHEN 'ASSIGNED' THEN 2
         WHEN 'OPEN' THEN 3
         ELSE 4
       END, wa.updated_at DESC, wa.id DESC
       LIMIT 1
     ) test_wa ON TRUE
     LEFT JOIN LATERAL (
       SELECT *
       FROM work_assignments wa
       WHERE wa.entity_type = 'ORDER'
         AND wa.entity_id = o.id
         AND wa.work_type = 'PACK'
         AND wa.status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS')
       ORDER BY CASE wa.status
         WHEN 'IN_PROGRESS' THEN 1
         WHEN 'ASSIGNED' THEN 2
         WHEN 'OPEN' THEN 3
         ELSE 4
       END, wa.updated_at DESC, wa.id DESC
       LIMIT 1
     ) pack_wa ON TRUE
     LEFT JOIN staff st ON st.id = test_wa.assigned_tech_id
     LEFT JOIN staff sp ON sp.id = pack_wa.assigned_packer_id
     LEFT JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
     WHERE NOT COALESCE(
             stn.is_carrier_accepted OR stn.is_in_transit
             OR stn.is_out_for_delivery OR stn.is_delivered, false
           )
       AND o.shipment_id IS NOT NULL
     ORDER BY COALESCE(test_wa.deadline_at, o.created_at) ASC, o.id ASC
     LIMIT 500`
  );

  return result.rows.map((row) => ({
    id: `ORDER:${row.id}`,
    entityType: 'ORDER' as const,
    entityId: Number(row.id),
    queueKey: 'orders' as const,
    queueLabel: 'Orders',
    title: String(row.product_title || 'Untitled order'),
    subtitle: [row.order_id, row.tracking_number, row.sku].filter(Boolean).join(' • '),
    recordLabel: String(row.order_id || row.item_number || `Order #${row.id}`),
    sourcePath: '/dashboard?pending=',
    techId: row.tech_id == null ? null : Number(row.tech_id),
    techName: row.tech_name ? String(row.tech_name) : null,
    packerId: row.packer_id == null ? null : Number(row.packer_id),
    packerName: row.packer_name ? String(row.packer_name) : null,
    status: normalizeStatus(row.test_status),
    priority: Number(row.test_priority || 100),
    deadlineAt: row.deadline_at ? new Date(row.deadline_at).toISOString() : null,
    notes: (row.test_notes || row.notes) ? String(row.test_notes || row.notes) : null,
    assignedAt: row.test_assigned_at ? new Date(row.test_assigned_at).toISOString() : null,
    updatedAt: row.test_updated_at ? new Date(row.test_updated_at).toISOString() : null,
    primaryAssignmentId: row.test_assignment_id == null ? null : Number(row.test_assignment_id),
    secondaryAssignmentId: row.pack_assignment_id == null ? null : Number(row.pack_assignment_id),
    primaryWorkType: 'TEST' as const,
  }));
}

async function getReceiving(): Promise<WorkOrderRow[]> {
  const result = await pool.query(
    `SELECT
       r.id,
       r.receiving_tracking_number,
       r.carrier,
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
     LEFT JOIN LATERAL (
       SELECT *
       FROM work_assignments wa
       WHERE wa.entity_type = 'RECEIVING'
         AND wa.entity_id = r.id
         AND wa.work_type = 'TEST'
         AND wa.status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS')
       ORDER BY CASE wa.status
         WHEN 'IN_PROGRESS' THEN 1
         WHEN 'ASSIGNED' THEN 2
         WHEN 'OPEN' THEN 3
         ELSE 4
       END, wa.updated_at DESC, wa.id DESC
       LIMIT 1
     ) wa ON TRUE
     LEFT JOIN staff st ON st.id = wa.assigned_tech_id
     LEFT JOIN staff sp ON sp.id = wa.assigned_packer_id
     WHERE COALESCE(r.needs_test, false) = true
        OR COALESCE(r.is_return, false) = true
        OR UPPER(COALESCE(r.carrier, '')) = 'LOCAL'
        OR UPPER(COALESCE(r.receiving_tracking_number, '')) LIKE 'LOCAL-%'
     ORDER BY COALESCE(wa.deadline_at, r.received_at, r.created_at) ASC, r.id ASC
     LIMIT 500`
  );

  return result.rows.map((row) => {
    const isLocalPickup =
      String(row.carrier || '').toUpperCase() === 'LOCAL' ||
      String(row.receiving_tracking_number || '').toUpperCase().startsWith('LOCAL-');
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
      deadlineAt: row.deadline_at ? new Date(row.deadline_at).toISOString() : null,
      notes: (row.notes || row.receiving_notes) ? String(row.notes || row.receiving_notes) : null,
      assignedAt: row.assigned_at ? new Date(row.assigned_at).toISOString() : null,
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
      primaryAssignmentId: row.assignment_id == null ? null : Number(row.assignment_id),
      secondaryAssignmentId: null,
      primaryWorkType: 'TEST' as const,
    };
  });
}

async function getRepairs(): Promise<WorkOrderRow[]> {
  const result = await pool.query(
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
         AND wa.status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS')
       ORDER BY CASE wa.status
         WHEN 'IN_PROGRESS' THEN 1
         WHEN 'ASSIGNED' THEN 2
         WHEN 'OPEN' THEN 3
         ELSE 4
       END, wa.updated_at DESC, wa.id DESC
       LIMIT 1
     ) wa ON TRUE
     LEFT JOIN staff st ON st.id = wa.assigned_tech_id
     LEFT JOIN staff sp ON sp.id = wa.assigned_packer_id
     WHERE COALESCE(rs.status, '') NOT IN ('Shipped', 'Picked Up')
     ORDER BY COALESCE(wa.deadline_at, wa.updated_at) ASC NULLS LAST, rs.id ASC`
  );

  return result.rows.map((row) => {
    return {
      id: `REPAIR:${row.id}`,
      entityType: 'REPAIR' as const,
      entityId: Number(row.id),
      queueKey: 'repair_services' as const,
      queueLabel: 'Repair Services',
      title: String(row.product_title || 'Repair service'),
      subtitle: String(row.issue || 'Repair work order'),
      recordLabel: String(row.ticket_number || `Repair #${row.id}`),
      sourcePath: '/repair',
      techId: row.assigned_tech_id == null ? null : Number(row.assigned_tech_id),
      techName: row.tech_name ? String(row.tech_name) : null,
      packerId: row.assigned_packer_id == null ? null : Number(row.assigned_packer_id),
      packerName: row.packer_name ? String(row.packer_name) : null,
      status: normalizeStatus(row.status),
      priority: Number(row.priority || 100),
      deadlineAt: row.deadline_at ? new Date(row.deadline_at).toISOString() : null,
      notes: (row.notes || row.repair_notes) ? String(row.notes || row.repair_notes) : null,
      assignedAt: row.assigned_at ? new Date(row.assigned_at).toISOString() : null,
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
      primaryAssignmentId: row.assignment_id == null ? null : Number(row.assignment_id),
      secondaryAssignmentId: null,
      primaryWorkType: 'REPAIR' as const,
    };
  });
}

async function getFbaShipments(): Promise<WorkOrderRow[]> {
  const result = await pool.query(
    `SELECT
       fs.id,
       fs.shipment_id,
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
         AND wa.status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS')
       ORDER BY CASE wa.status
         WHEN 'IN_PROGRESS' THEN 1
         WHEN 'ASSIGNED' THEN 2
         WHEN 'OPEN' THEN 3
         ELSE 4
       END, wa.updated_at DESC, wa.id DESC
       LIMIT 1
     ) wa ON TRUE
     LEFT JOIN staff st ON st.id = COALESCE(wa.assigned_tech_id, fs.assigned_tech_id)
     LEFT JOIN staff sp ON sp.id = COALESCE(wa.assigned_packer_id, fs.assigned_packer_id)
     WHERE COALESCE(fs.status, 'PLANNED') <> 'SHIPPED'
     ORDER BY fs.created_at DESC NULLS LAST, fs.id DESC
     LIMIT 500`
  );

  return result.rows.map((row) => ({
    id: `FBA_SHIPMENT:${row.id}`,
    entityType: 'FBA_SHIPMENT' as const,
    entityId: Number(row.id),
    queueKey: 'fba_shipments' as const,
    queueLabel: 'FBA Shipments',
    title: String(row.shipment_ref || row.shipment_id || `FBA #${row.id}`),
    subtitle: String(row.shipment_id || 'Amazon shipment'),
    recordLabel: String(row.shipment_ref || row.shipment_id || `FBA #${row.id}`),
    sourcePath: '/fba',
    techId: row.assigned_tech_id == null ? (row.native_tech_id == null ? null : Number(row.native_tech_id)) : Number(row.assigned_tech_id),
    techName: row.tech_name ? String(row.tech_name) : null,
    packerId: row.assigned_packer_id == null ? (row.native_packer_id == null ? null : Number(row.native_packer_id)) : Number(row.assigned_packer_id),
    packerName: row.packer_name ? String(row.packer_name) : null,
    status: normalizeStatus(row.status || (row.native_tech_id ? 'ASSIGNED' : 'OPEN')),
    priority: Number(row.priority || 100),
    deadlineAt: row.deadline_at ? new Date(row.deadline_at).toISOString() : null,
    notes: (row.notes || row.shipment_notes) ? String(row.notes || row.shipment_notes) : null,
    assignedAt: row.assigned_at ? new Date(row.assigned_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    primaryAssignmentId: row.assignment_id == null ? null : Number(row.assignment_id),
    secondaryAssignmentId: null,
    primaryWorkType: 'QA' as const,
  }));
}

async function getSkuStock(): Promise<WorkOrderRow[]> {
  const result = await pool.query(
    `SELECT
       ss.id,
       ss.sku,
       ss.product_title,
       ss.stock,
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
     FROM sku_stock ss
     LEFT JOIN LATERAL (
       SELECT *
       FROM work_assignments wa
       WHERE wa.entity_type = 'SKU_STOCK'
         AND wa.entity_id = ss.id
         AND wa.work_type = 'STOCK_REPLENISH'
         AND wa.status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS')
       ORDER BY CASE wa.status
         WHEN 'IN_PROGRESS' THEN 1
         WHEN 'ASSIGNED' THEN 2
         WHEN 'OPEN' THEN 3
         ELSE 4
       END, wa.updated_at DESC, wa.id DESC
       LIMIT 1
     ) wa ON TRUE
     LEFT JOIN staff st ON st.id = wa.assigned_tech_id
     LEFT JOIN staff sp ON sp.id = wa.assigned_packer_id
     ORDER BY COALESCE(NULLIF(regexp_replace(COALESCE(ss.stock, ''), '[^0-9-]+', '', 'g'), ''), '0')::int ASC,
              COALESCE(ss.product_title, '') ASC,
              ss.id DESC
     LIMIT 500`
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
      packerId: row.assigned_packer_id == null ? null : Number(row.assigned_packer_id),
      packerName: row.packer_name ? String(row.packer_name) : null,
      status: normalizeStatus(row.status),
      priority: Number(row.priority || 100),
      deadlineAt: row.deadline_at ? new Date(row.deadline_at).toISOString() : null,
      notes: row.notes ? String(row.notes) : null,
      assignedAt: row.assigned_at ? new Date(row.assigned_at).toISOString() : null,
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
      primaryAssignmentId: row.assignment_id == null ? null : Number(row.assignment_id),
      secondaryAssignmentId: null,
      primaryWorkType: 'STOCK_REPLENISH' as const,
      stockLevel: Number.isFinite(stockLevel) ? stockLevel : 0,
    };
  });
}

async function upsertAssignment(params: {
  entityType: EntityType;
  entityId: number;
  workType: WorkType;
  assignedTechId: number | null;
  assignedPackerId: number | null;
  status: WorkStatus;
  priority: number;
  deadlineAt: string | null;
  notes: string | null;
  allowInsertWhenEmpty?: boolean;
}) {
  const existing = await pool.query<{ id: number }>(
    `SELECT id
     FROM work_assignments
     WHERE entity_type = $1
       AND entity_id = $2
       AND work_type = $3
       AND status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS')
     ORDER BY CASE status
       WHEN 'IN_PROGRESS' THEN 1
       WHEN 'ASSIGNED' THEN 2
       WHEN 'OPEN' THEN 3
       ELSE 4
     END, updated_at DESC, id DESC
     LIMIT 1`,
    [params.entityType, params.entityId, params.workType]
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
    await pool.query(
      `UPDATE work_assignments
       SET assigned_tech_id = $1,
           assigned_packer_id = $2,
           status = $3::assignment_status_enum,
           priority = $4,
           deadline_at = $5,
           notes = $6,
           started_at = CASE WHEN $3::text = 'IN_PROGRESS' THEN COALESCE(started_at, NOW()) ELSE started_at END,
           completed_at = CASE WHEN $3::text IN ('DONE', 'CANCELED') THEN COALESCE(completed_at, NOW()) ELSE NULL END,
           updated_at = NOW()
       WHERE id = $7`,
      [
        params.assignedTechId,
        params.assignedPackerId,
        params.status,
        params.priority,
        params.deadlineAt,
        params.notes,
        existing.rows[0].id,
      ]
    );
    return existing.rows[0].id;
  }

  if (!shouldInsert) return null;

  const inserted = await pool.query<{ id: number }>(
    `INSERT INTO work_assignments
       (entity_type, entity_id, work_type, assigned_tech_id, assigned_packer_id, status, priority, deadline_at, notes)
     VALUES ($1, $2, $3, $4, $5, $6::assignment_status_enum, $7, $8, $9)
     RETURNING id`,
    [
      params.entityType,
      params.entityId,
      params.workType,
      params.assignedTechId,
      params.assignedPackerId,
      params.status,
      params.priority,
      params.deadlineAt,
      params.notes,
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

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const queue = normalizeQueue(searchParams.get('queue'));
    const query = String(searchParams.get('q') || '').trim();

    const [orders, receiving, repairs, fbaShipments, skuStock] = await Promise.all([
      safeFetch('getOrders', getOrders),
      safeFetch('getReceiving', getReceiving),
      safeFetch('getRepairs', getRepairs),
      safeFetch('getFbaShipments', getFbaShipments),
      safeFetch('getSkuStock', getSkuStock),
    ]);

    const allRows = [...orders, ...receiving, ...repairs, ...fbaShipments, ...skuStock];

    const counts: Record<QueueKey, number> = {
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
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const entityType = String(body?.entityType || '').trim().toUpperCase() as EntityType;
    const entityId = Number(body?.entityId);
    const techIdRaw = Number(body?.assignedTechId);
    const packerIdRaw = Number(body?.assignedPackerId);
    const priorityRaw = Number(body?.priority);
    const status = normalizeStatus(body?.status);
    const deadlineAt =
      body?.deadlineAt && !Number.isNaN(Date.parse(String(body.deadlineAt)))
        ? new Date(String(body.deadlineAt)).toISOString()
        : null;
    const notes = String(body?.notes || '').trim() || null;

    if (!['ORDER', 'REPAIR', 'FBA_SHIPMENT', 'RECEIVING', 'SKU_STOCK'].includes(entityType)) {
      return NextResponse.json({ error: 'Invalid entityType' }, { status: 400 });
    }
    if (!Number.isFinite(entityId) || entityId <= 0) {
      return NextResponse.json({ error: 'Invalid entityId' }, { status: 400 });
    }

    const assignedTechId = Number.isFinite(techIdRaw) && techIdRaw > 0 ? techIdRaw : null;
    const assignedPackerId = Number.isFinite(packerIdRaw) && packerIdRaw > 0 ? packerIdRaw : null;
    const priority = Number.isFinite(priorityRaw) ? Math.max(1, Math.min(priorityRaw, 9999)) : 100;

    if (entityType === 'ORDER') {
      await upsertAssignment({
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
      await upsertAssignment({
        entityType: 'ORDER',
        entityId,
        workType: 'PACK',
        assignedTechId: null,
        assignedPackerId,
        status,
        priority,
        deadlineAt: null,
        notes,
      });

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

      await upsertAssignment({
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
        await pool.query(
          `UPDATE fba_shipments
           SET assigned_tech_id = $1,
               assigned_packer_id = $2
           WHERE id = $3`,
          [assignedTechId, assignedPackerId, entityId]
        );
      }

      if (entityType === 'RECEIVING') {
        await pool.query(
          `UPDATE receiving
           SET assigned_tech_id = $1,
               updated_at = NOW()
           WHERE id = $2`,
          [assignedTechId, entityId]
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Failed to update work order:', error);
    return NextResponse.json(
      { error: 'Failed to update work order', details: error?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}
