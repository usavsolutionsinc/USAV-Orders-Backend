/**
 * Picker queue — aggregated list of orders that have open allocations and
 * are ready for someone to walk the warehouse.
 *
 * Powers the `/m/pick` landing page and the `GET /api/pick/queue` endpoint.
 *
 * "Open" means at least one `order_unit_allocations.state` is ALLOCATED
 * or PICKING. Once every allocation rolls past PICKED the order drops off
 * the queue automatically.
 */

import pool from '@/lib/db';
import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';

export interface PickQueueRow {
  orderId: number;
  orderLabel: string;
  customerInitials: string;
  customerName: string | null;
  accountSource: string | null;
  shipByDate: string | null;
  pendingCount: number;
  inProgressCount: number;
  totalCount: number;
  activePickerId: number | null;
}

const QUEUE_SQL = `
  SELECT
    o.id                                          AS order_id,
    o.order_id                                    AS order_label,
    c.first_name                                  AS first_name,
    c.last_name                                   AS last_name,
    o.account_source                              AS account_source,
    (SELECT MIN(wa.deadline_at)
       FROM work_assignments wa
      WHERE wa.entity_type = 'ORDER'
        AND wa.entity_id   = o.id)::text          AS deadline_at,
    COUNT(*) FILTER (WHERE oua.state = 'ALLOCATED')::int  AS pending_count,
    COUNT(*) FILTER (WHERE oua.state = 'PICKING')::int    AS in_progress_count,
    COUNT(*)::int                                          AS total_count,
    (SELECT ps.picker_staff_id
       FROM picking_sessions ps
      WHERE ps.order_id = o.id
        AND ps.ended_at IS NULL
      ORDER BY ps.started_at DESC
      LIMIT 1)                                    AS active_picker_id
  FROM order_unit_allocations oua
  JOIN orders    o ON o.id = oua.order_id
  LEFT JOIN customers c ON c.id = o.customer_id
  WHERE oua.state IN ('ALLOCATED', 'PICKING')
  GROUP BY o.id, o.order_id, c.first_name, c.last_name, o.account_source
  ORDER BY deadline_at ASC NULLS LAST, o.id ASC
  LIMIT 200
`;

// Tenant-scoped variant: explicit AND <t>.organization_id = $1 on every
// org-bearing table (oua / o / c / wa), and picking_sessions — which has no
// organization_id column (child-scoped via orders) — gated through its parent
// order's org. All table joins here are integer surrogate-PK joins
// (o.id = oua.order_id, c.id = o.customer_id, wa.entity_id = o.id,
// ps.order_id = o.id), so no string-key org alignment is required.
const QUEUE_SQL_TENANT = `
  SELECT
    o.id                                          AS order_id,
    o.order_id                                    AS order_label,
    c.first_name                                  AS first_name,
    c.last_name                                   AS last_name,
    o.account_source                              AS account_source,
    (SELECT MIN(wa.deadline_at)
       FROM work_assignments wa
      WHERE wa.entity_type = 'ORDER'
        AND wa.entity_id   = o.id
        AND wa.organization_id = $1)::text        AS deadline_at,
    COUNT(*) FILTER (WHERE oua.state = 'ALLOCATED')::int  AS pending_count,
    COUNT(*) FILTER (WHERE oua.state = 'PICKING')::int    AS in_progress_count,
    COUNT(*)::int                                          AS total_count,
    (SELECT ps.picker_staff_id
       FROM picking_sessions ps
       JOIN orders po ON po.id = ps.order_id
      WHERE ps.order_id = o.id
        AND ps.ended_at IS NULL
        AND po.organization_id = $1
      ORDER BY ps.started_at DESC
      LIMIT 1)                                    AS active_picker_id
  FROM order_unit_allocations oua
  JOIN orders    o ON o.id = oua.order_id
  LEFT JOIN customers c ON c.id = o.customer_id AND c.organization_id = $1
  WHERE oua.state IN ('ALLOCATED', 'PICKING')
    AND oua.organization_id = $1
    AND o.organization_id = $1
  GROUP BY o.id, o.order_id, c.first_name, c.last_name, o.account_source
  ORDER BY deadline_at ASC NULLS LAST, o.id ASC
  LIMIT 200
`;

export async function loadPickQueue(orgId?: OrgId): Promise<PickQueueRow[]> {
  const q = orgId
    ? await tenantQuery<{
        order_id: number;
        order_label: string | null;
        first_name: string | null;
        last_name: string | null;
        account_source: string | null;
        deadline_at: string | null;
        pending_count: number;
        in_progress_count: number;
        total_count: number;
        active_picker_id: number | null;
      }>(orgId, QUEUE_SQL_TENANT, [orgId])
    : await pool.query<{
        order_id: number;
        order_label: string | null;
        first_name: string | null;
        last_name: string | null;
        account_source: string | null;
        deadline_at: string | null;
        pending_count: number;
        in_progress_count: number;
        total_count: number;
        active_picker_id: number | null;
      }>(QUEUE_SQL);

  return q.rows.map((r) => {
    const first = (r.first_name || '').trim();
    const last = (r.last_name || '').trim();
    const initials = `${first[0] || '?'}${last[0] || ''}`.toUpperCase();
    const fullName = [first, last].filter(Boolean).join(' ') || null;
    return {
      orderId: r.order_id,
      orderLabel: r.order_label ? `#${r.order_label}` : `#${r.order_id}`,
      customerInitials: initials,
      customerName: fullName,
      accountSource: r.account_source,
      shipByDate: r.deadline_at,
      pendingCount: r.pending_count,
      inProgressCount: r.in_progress_count,
      totalCount: r.total_count,
      activePickerId: r.active_picker_id,
    };
  });
}
