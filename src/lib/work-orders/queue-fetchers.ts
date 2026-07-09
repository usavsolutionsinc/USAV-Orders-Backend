import { tenantQuery } from '@/lib/tenancy/db';
import { normalizePSTTimestamp } from '@/utils/date';
import type { WorkOrderRow, WorkStatus } from '@/components/work-orders/types';

function normalizeStatus(raw: unknown): WorkStatus {
  const value = String(raw || '').trim().toUpperCase();
  if (value === 'ASSIGNED' || value === 'IN_PROGRESS' || value === 'DONE' || value === 'CANCELED') return value;
  return 'OPEN';
}

export async function getReceivingWorkOrders(orgId: string): Promise<WorkOrderRow[]> {
  const result = await tenantQuery(orgId,
    `SELECT
       r.id,
       stn.tracking_number_raw AS receiving_tracking_number,
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
                   LEFT JOIN receiving_line_testing rlt ON rlt.receiving_line_id = rl.id AND rlt.organization_id = rl.organization_id
                   WHERE rl.receiving_id = r.id AND rl.organization_id = $1 AND COALESCE(rlt.needs_test, true) = true
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

export async function getRepairWorkOrders(orgId: string): Promise<WorkOrderRow[]> {
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

export async function getFbaWorkOrders(orgId: string): Promise<WorkOrderRow[]> {
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

export async function getSkuStockWorkOrders(orgId: string): Promise<WorkOrderRow[]> {
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

