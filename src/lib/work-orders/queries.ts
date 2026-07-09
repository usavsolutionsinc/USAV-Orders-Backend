import { tenantQuery } from '@/lib/tenancy/db';
import { SHIPPED_BY_CARRIER_SQL } from '@/lib/sql-fragments';
import { normalizePSTTimestamp } from '@/utils/date';
import type { WorkOrderRow, WorkStatus } from '@/components/work-orders/types';

/**
 * Server-side work-order queue queries.
 *
 * Extracted from /api/work-orders/route.ts so that the queue route AND the
 * per-operator header endpoint (/api/work-orders/mine) share ONE data source.
 * (A route file can only export HTTP handlers — Next's generated route-type
 * checker rejects extra exports — so this query lives in lib instead.)
 */

const shippedByCarrierOrLatestStatusSql = SHIPPED_BY_CARRIER_SQL;

function normalizeStatus(raw: unknown): WorkStatus {
  const value = String(raw || '').trim().toUpperCase();
  if (value === 'ASSIGNED' || value === 'IN_PROGRESS' || value === 'DONE' || value === 'CANCELED') return value;
  return 'OPEN';
}

export async function getOrders(orgId: string): Promise<WorkOrderRow[]> {
  const result = await tenantQuery(orgId,
    `SELECT
       o.id,
       o.order_id,
       o.product_title,
       o.item_number,
       o.shipment_id,
       stn.tracking_number_raw AS tracking_number,
       COALESCE((
         SELECT json_agg(json_build_object(
           'shipment_id', osl.shipment_id,
           'tracking_number_raw', stn2.tracking_number_raw,
           'is_primary', osl.is_primary
         ) ORDER BY osl.is_primary DESC, stn2.tracking_number_raw)
         FROM shipment_links osl
         JOIN shipping_tracking_numbers stn2 ON stn2.id = osl.shipment_id
         WHERE osl.owner_type = 'ORDER' AND osl.owner_id = o.id
           AND osl.organization_id = $1
       ), '[]'::json) AS tracking_number_rows,
       o.sku,
       o.condition,
       o.account_source,
       o.quantity,
       o.notes,
       o.out_of_stock,
       o.created_at,
       (COALESCE((SELECT count(*) FROM station_activity_logs sal2
         WHERE sal2.shipment_id IS NOT NULL AND sal2.shipment_id = o.shipment_id
           AND sal2.organization_id = $1), 0) > 0) AS has_tech_scan,
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
         AND wa.organization_id = $1
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
         AND wa.organization_id = $1
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
     WHERE NOT ${shippedByCarrierOrLatestStatusSql}
       AND NOT EXISTS (
         SELECT 1
         FROM station_activity_logs sal
         WHERE sal.shipment_id IS NOT NULL
           AND sal.shipment_id = o.shipment_id
           AND sal.organization_id = $1
       )
       AND UPPER(COALESCE(o.status, '')) <> 'SHIPPED'
       AND o.shipment_id IS NOT NULL
       AND o.organization_id = $1
     ORDER BY COALESCE(test_wa.deadline_at, o.created_at) ASC, o.id ASC
     LIMIT 500`,
    [orgId]
  );

  return result.rows.map(mapOrderRow);
}

/**
 * Shared row → WorkOrderRow projection for ORDER-entity queue rows. Extracted so
 * the active-queue query (getOrders) and the windowed calendar query
 * (getWorkOrdersInRange) emit an identical shape from one place.
 */
// NOTE: no explicit WorkOrderRow return annotation — the literal carries a few
// extra queue fields (primaryAssignmentId/primaryWorkType/…) that the shared
// WorkOrderRow type (owned by P1-WORK-01) doesn't yet declare. Letting the type
// infer and widening at the getOrders/getWorkOrdersInRange boundary avoids an
// excess-property error without editing the shared type.
function mapOrderRow(row: any) {
  return {
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
    deadlineAt: normalizePSTTimestamp(row.deadline_at),
    notes: (row.test_notes || row.notes) ? String(row.test_notes || row.notes) : null,
    assignedAt: normalizePSTTimestamp(row.test_assigned_at),
    updatedAt: normalizePSTTimestamp(row.test_updated_at),
    primaryAssignmentId: row.test_assignment_id == null ? null : Number(row.test_assignment_id),
    secondaryAssignmentId: row.pack_assignment_id == null ? null : Number(row.pack_assignment_id),
    primaryWorkType: 'TEST' as const,
    orderId: row.order_id ? String(row.order_id) : null,
    trackingNumber: row.tracking_number ? String(row.tracking_number) : null,
    trackingNumberRows: Array.isArray(row.tracking_number_rows) ? row.tracking_number_rows : [],
    itemNumber: row.item_number ? String(row.item_number) : null,
    sku: row.sku ? String(row.sku) : null,
    condition: row.condition ? String(row.condition) : null,
    shipmentId: row.shipment_id ?? null,
    accountSource: row.account_source ? String(row.account_source) : null,
    quantity: row.quantity ? String(row.quantity) : null,
    createdAt: normalizePSTTimestamp(row.created_at),
    hasTechScan: Boolean(row.has_tech_scan),
    outOfStock: row.out_of_stock ? String(row.out_of_stock).trim() : null,
  };
}

/**
 * Windowed ORDER work-order query for the scheduling calendar (P3-ADM-03).
 *
 * The active-queue getOrders() caps at active statuses / LIMIT 500 with NO date
 * filter — wrong for a calendar that needs every assignment whose deadline (the
 * day-placement field; work_assignments has no scheduled_at, so we reuse
 * deadline_at) lands inside the visible month/week window, including DONE rows.
 *
 * Additive: a new function alongside getOrders; the existing query is untouched.
 * `fromISO`/`toISO` are inclusive-start / exclusive-end UTC ISO timestamps for
 * the visible window. Org/RLS scoped via tenantQuery.
 */
export async function getWorkOrdersInRange(
  orgId: string,
  fromISO: string,
  toISO: string,
): Promise<WorkOrderRow[]> {
  const result = await tenantQuery(orgId,
    `SELECT
       o.id,
       o.order_id,
       o.product_title,
       o.item_number,
       o.shipment_id,
       stn.tracking_number_raw AS tracking_number,
       '[]'::json AS tracking_number_rows,
       o.sku,
       o.condition,
       o.account_source,
       o.quantity,
       o.notes,
       o.out_of_stock,
       o.created_at,
       false AS has_tech_scan,
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
     FROM work_assignments test_wa
     JOIN orders o
       ON o.id = test_wa.entity_id
       AND o.organization_id = $1
     LEFT JOIN LATERAL (
       SELECT *
       FROM work_assignments wa
       WHERE wa.entity_type = 'ORDER'
         AND wa.entity_id = o.id
         AND wa.work_type = 'PACK'
         AND wa.organization_id = $1
       ORDER BY wa.updated_at DESC, wa.id DESC
       LIMIT 1
     ) pack_wa ON TRUE
     LEFT JOIN staff st ON st.id = test_wa.assigned_tech_id
     LEFT JOIN staff sp ON sp.id = pack_wa.assigned_packer_id
     LEFT JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
     WHERE test_wa.entity_type = 'ORDER'
       AND test_wa.work_type = 'TEST'
       AND test_wa.organization_id = $1
       AND test_wa.deadline_at >= $2::timestamptz
       AND test_wa.deadline_at <  $3::timestamptz
     ORDER BY test_wa.deadline_at ASC, o.id ASC
     LIMIT 1000`,
    [orgId, fromISO, toISO]
  );

  return result.rows.map(mapOrderRow);
}
