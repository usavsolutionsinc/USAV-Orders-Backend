import pool from '@/lib/db';
import { normalizeTrackingKey18, normalizeTrackingLast8 } from '@/lib/tracking-format';
import { tenantQuery, withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';

export type ExceptionSourceStation = 'tech' | 'packer' | 'verify' | 'mobile' | 'fba';

export interface OrdersExceptionRecord {
  id: number;
  shipping_tracking_number: string;
  source_station: ExceptionSourceStation;
  staff_id: number | null;
  staff_name: string | null;
  exception_reason: string;
  notes: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

let tableEnsured = false;
type DbClient = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number }>;
};

export async function findOrderByTrackingKey(
  shippingTrackingNumber: string,
  dbClient: DbClient = pool,
  orgId?: OrgId
): Promise<{ id: number; shipping_tracking_number: string } | null> {
  // Keep tableEnsured variable for backwards compatibility with existing imports/tests.
  // Table creation is handled by migrations, not request-time DDL.
  tableEnsured = true;

  const rawTracking = String(shippingTrackingNumber || '').trim();
  const trackingKey18 = normalizeTrackingKey18(rawTracking);
  const trackingLast8 = normalizeTrackingLast8(rawTracking);
  const normalizedLast8 = /^\d{8}$/.test(trackingLast8) ? trackingLast8 : null;
  if (!trackingKey18) return null;

  // Tenant-aware path: scope the org-bearing `orders` table to the caller's org.
  // The stn joins are integer surrogate-PK (stn.id = o.shipment_id) and the
  // independent lateral lookup keys off shipping_tracking_numbers.id — that
  // table has no organization_id column (NEEDS-COL), so it is only reachable
  // via the org-scoped `orders` row, which is the tenant guard here.
  if (orgId) {
    const tenantResult = await tenantQuery(
      orgId,
      `SELECT
          o.id,
          COALESCE(stn.tracking_number_raw, s2.tracking_number_raw) AS shipping_tracking_number
       FROM orders o
       LEFT JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
       -- Independent lookup: find any stn row matching key18 (handles orders where
       -- shipment_id is null or points to a different legacy row)
       LEFT JOIN LATERAL (
           SELECT s.tracking_number_raw, s.id
           FROM shipping_tracking_numbers s
           WHERE RIGHT(regexp_replace(UPPER(s.tracking_number_normalized), '[^A-Z0-9]', '', 'g'), 18) = $1
              OR (
                $2::text IS NOT NULL
                AND RIGHT(regexp_replace(COALESCE(s.tracking_number_normalized, ''), '[^0-9]', '', 'g'), 8) = $2
              )
           ORDER BY s.id DESC LIMIT 1
       ) s2 ON TRUE
       WHERE o.organization_id = $3
         AND (
           (
             stn.id IS NOT NULL
             AND (
               RIGHT(regexp_replace(UPPER(stn.tracking_number_normalized), '[^A-Z0-9]', '', 'g'), 18) = $1
               OR (
                 $2::text IS NOT NULL
                 AND RIGHT(regexp_replace(COALESCE(stn.tracking_number_normalized, ''), '[^0-9]', '', 'g'), 8) = $2
               )
             )
           ) OR (
             s2.id IS NOT NULL AND o.shipment_id = s2.id
           )
         )
       ORDER BY o.id DESC
       LIMIT 1`,
      [trackingKey18, normalizedLast8, orgId]
    );

    return (tenantResult.rows[0] as { id: number; shipping_tracking_number: string } | undefined) || null;
  }

  const result = await dbClient.query(
    `SELECT
        o.id,
        COALESCE(stn.tracking_number_raw, s2.tracking_number_raw) AS shipping_tracking_number
     FROM orders o
     LEFT JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
     -- Independent lookup: find any stn row matching key18 (handles orders where
     -- shipment_id is null or points to a different legacy row)
     LEFT JOIN LATERAL (
         SELECT s.tracking_number_raw, s.id
         FROM shipping_tracking_numbers s
         WHERE RIGHT(regexp_replace(UPPER(s.tracking_number_normalized), '[^A-Z0-9]', '', 'g'), 18) = $1
            OR (
              $2::text IS NOT NULL
              AND RIGHT(regexp_replace(COALESCE(s.tracking_number_normalized, ''), '[^0-9]', '', 'g'), 8) = $2
            )
         ORDER BY s.id DESC LIMIT 1
     ) s2 ON TRUE
     WHERE (
         stn.id IS NOT NULL
         AND (
           RIGHT(regexp_replace(UPPER(stn.tracking_number_normalized), '[^A-Z0-9]', '', 'g'), 18) = $1
           OR (
             $2::text IS NOT NULL
             AND RIGHT(regexp_replace(COALESCE(stn.tracking_number_normalized, ''), '[^0-9]', '', 'g'), 8) = $2
           )
         )
     ) OR (
         s2.id IS NOT NULL AND o.shipment_id = s2.id
     )
     ORDER BY o.id DESC
     LIMIT 1`,
    [trackingKey18, normalizedLast8]
  );

  return result.rows[0] || null;
}

export async function upsertOpenOrderException(params: {
  /** Phase 3a: tenant scope for the orders_exceptions insert. */
  organizationId: string;
  shippingTrackingNumber: string;
  sourceStation: ExceptionSourceStation;
  staffId?: number | null;
  staffName?: string | null;
  reason?: string;
  notes?: string | null;
}, dbClient: DbClient = pool, orgId?: OrgId): Promise<{ exception: OrdersExceptionRecord | null; matchedOrderId: number | null }> {
  tableEnsured = true;

  const tracking = String(params.shippingTrackingNumber || '').trim();
  if (tracking.includes(':')) {
    return { exception: null, matchedOrderId: null };
  }
  const trackingKey18 = normalizeTrackingKey18(tracking);
  const trackingLast8 = normalizeTrackingLast8(tracking);
  const normalizedLast8 = /^\d{8}$/.test(trackingLast8) ? trackingLast8 : null;
  if (!tracking || !trackingKey18) {
    return { exception: null, matchedOrderId: null };
  }

  // Thread orgId through to the shared matcher so the order lookup is tenant-scoped too.
  const matchedOrder = await findOrderByTrackingKey(tracking, dbClient, orgId);
  if (matchedOrder) {
    return { exception: null, matchedOrderId: matchedOrder.id };
  }

  // Tenant-aware path: scope the open-exception lookup + update to the caller's
  // org and stamp the INSERT inside a tenant transaction so the GUC is set.
  if (orgId) {
    return withTenantTransaction(orgId, async (client) => {
      const existing = await client.query(
        `SELECT *
         FROM orders_exceptions
         WHERE status = 'open'
           AND source_station = $2
           AND organization_id = $4
           AND (
             RIGHT(regexp_replace(UPPER(COALESCE(shipping_tracking_number, '')), '[^A-Z0-9]', '', 'g'), 18) = $1
             OR (
               $3::text IS NOT NULL
               AND RIGHT(regexp_replace(COALESCE(shipping_tracking_number, ''), '[^0-9]', '', 'g'), 8) = $3
             )
           )
         ORDER BY id DESC
         LIMIT 1`,
        [trackingKey18, params.sourceStation, normalizedLast8, orgId]
      );

      if (existing.rows.length > 0) {
        const existingRow = existing.rows[0];
        const updated = await client.query(
          `UPDATE orders_exceptions
           SET shipping_tracking_number = $1,
               source_station = $2,
               staff_id = COALESCE($3, staff_id),
               staff_name = COALESCE($4, staff_name),
               exception_reason = $5,
               notes = COALESCE($6, notes),
               updated_at = NOW()
           WHERE id = $7
             AND organization_id = $8
           RETURNING *`,
          [
            tracking,
            params.sourceStation,
            params.staffId ?? null,
            params.staffName ?? null,
            params.reason || 'not_found',
            params.notes ?? null,
            existingRow.id,
            orgId,
          ]
        );

        return { exception: updated.rows[0], matchedOrderId: null };
      }

      const inserted = await client.query(
        `INSERT INTO orders_exceptions (
          organization_id,
          shipping_tracking_number,
          source_station,
          staff_id,
          staff_name,
          exception_reason,
          notes,
          status,
          created_at,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'open', NOW(), NOW())
        RETURNING *`,
        [
          params.organizationId,
          tracking,
          params.sourceStation,
          params.staffId ?? null,
          params.staffName ?? null,
          params.reason || 'not_found',
          params.notes ?? null,
        ]
      );

      return { exception: inserted.rows[0], matchedOrderId: null };
    });
  }

  const existing = await dbClient.query(
    `SELECT *
     FROM orders_exceptions
     WHERE status = 'open'
       AND source_station = $2
       AND (
         RIGHT(regexp_replace(UPPER(COALESCE(shipping_tracking_number, '')), '[^A-Z0-9]', '', 'g'), 18) = $1
         OR (
           $3::text IS NOT NULL
           AND RIGHT(regexp_replace(COALESCE(shipping_tracking_number, ''), '[^0-9]', '', 'g'), 8) = $3
         )
       )
     ORDER BY id DESC
     LIMIT 1`,
    [trackingKey18, params.sourceStation, normalizedLast8]
  );

  if (existing.rows.length > 0) {
    const existingRow = existing.rows[0];
    const updated = await dbClient.query(
      `UPDATE orders_exceptions
       SET shipping_tracking_number = $1,
           source_station = $2,
           staff_id = COALESCE($3, staff_id),
           staff_name = COALESCE($4, staff_name),
           exception_reason = $5,
           notes = COALESCE($6, notes),
           updated_at = NOW()
       WHERE id = $7
       RETURNING *`,
      [
        tracking,
        params.sourceStation,
        params.staffId ?? null,
        params.staffName ?? null,
        params.reason || 'not_found',
        params.notes ?? null,
        existingRow.id,
      ]
    );

    return { exception: updated.rows[0], matchedOrderId: null };
  }

  const inserted = await dbClient.query(
    `INSERT INTO orders_exceptions (
      organization_id,
      shipping_tracking_number,
      source_station,
      staff_id,
      staff_name,
      exception_reason,
      notes,
      status,
      created_at,
      updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'open', NOW(), NOW())
    RETURNING *`,
    [
      params.organizationId,
      tracking,
      params.sourceStation,
      params.staffId ?? null,
      params.staffName ?? null,
      params.reason || 'not_found',
      params.notes ?? null,
    ]
  );

  return { exception: inserted.rows[0], matchedOrderId: null };
}

export type { OrderExceptionResolutionDetail } from '@/lib/orders-sync/types';
import type { OrderExceptionResolutionDetail, SyncProgress } from '@/lib/orders-sync/types';

const noopProgress: SyncProgress = () => {};

export async function syncOrderExceptionsToOrders(
  progress: SyncProgress = noopProgress,
  orgId?: OrgId,
): Promise<{
  scanned: number;
  matched: number;
  deleted: number;
  resolved: OrderExceptionResolutionDetail[];
  stillOpen: OrderExceptionResolutionDetail[];
}> {
  tableEnsured = true;

  // Hard cap so a single sync doesn't churn through thousands of stale rows.
  // Older exceptions get processed on subsequent runs.
  const EXCEPTIONS_SYNC_BATCH_LIMIT = 100;
  const openExceptions = orgId
    ? await tenantQuery(
        orgId,
        `SELECT id, shipping_tracking_number, source_station
         FROM orders_exceptions
         WHERE status = 'open'
           AND organization_id = $2
         ORDER BY id DESC
         LIMIT $1`,
        [EXCEPTIONS_SYNC_BATCH_LIMIT, orgId]
      )
    : await pool.query(
        `SELECT id, shipping_tracking_number, source_station
         FROM orders_exceptions
         WHERE status = 'open'
         ORDER BY id DESC
         LIMIT $1`,
        [EXCEPTIONS_SYNC_BATCH_LIMIT]
      );

  let matched = 0;
  let deleted = 0;
  const resolved: OrderExceptionResolutionDetail[] = [];
  const stillOpen: OrderExceptionResolutionDetail[] = [];

  progress({ type: 'phase', phase: 'scanning_exceptions', count: openExceptions.rows.length });

  for (const row of openExceptions.rows) {
    const rawTracking = String(row.shipping_tracking_number || '');
    const trackingKey18 = normalizeTrackingKey18(rawTracking);
    if (!trackingKey18) {
      const detail = {
        exceptionId: row.id as number,
        tracking: rawTracking,
        sourceStation: row.source_station ?? null,
      };
      stillOpen.push(detail);
      progress({ type: 'exception', kind: 'open', row: detail });
      continue;
    }

    // Use the shared matcher so we pick up the last-8-digit fallback and the
    // independent shipment_id lookup. Catches cases where the exception's
    // tracking was stored slightly differently than the inbound sheet/Ecwid
    // row (e.g. extra prefix chars trimmed by the tracking normalizer).
    const order = await findOrderByTrackingKey(rawTracking, pool, orgId);
    if (!order) {
      const detail = {
        exceptionId: row.id as number,
        tracking: rawTracking,
        sourceStation: row.source_station ?? null,
      };
      stillOpen.push(detail);
      progress({ type: 'exception', kind: 'open', row: detail });
      continue;
    }

    matched += 1;
    const detail = {
      exceptionId: row.id as number,
      tracking: rawTracking,
      matchedOrderId: order.id,
      sourceStation: row.source_station ?? null,
    };
    resolved.push(detail);
    progress({ type: 'exception', kind: 'resolved', row: detail });

    // Update status only — shipped state is derived from shipping_tracking_numbers.
    // Tenant-aware path scopes the orders UPDATE + the packer_logs EXISTS probe
    // to the caller's org (both tables carry organization_id). The stn join is
    // integer surrogate-PK (stn.id = pl.shipment_id) so it stays bare.
    if (orgId) {
      await tenantQuery(
        orgId,
        `UPDATE orders o
         SET status = CASE
               WHEN EXISTS (
                 SELECT 1 FROM packer_logs pl
                 JOIN   shipping_tracking_numbers stn ON stn.id = pl.shipment_id
                 WHERE  RIGHT(regexp_replace(UPPER(COALESCE(stn.tracking_number_normalized, '')), '[^A-Z0-9]', '', 'g'), 18) = $1
                   AND  pl.tracking_type = 'ORDERS'
                   AND  pl.organization_id = $3
               ) THEN 'shipped'
               ELSE status
             END
         WHERE o.id = $2
           AND o.organization_id = $3`,
        [trackingKey18, order.id, orgId]
      );
    } else {
      await pool.query(
        `UPDATE orders
         SET status = CASE
               WHEN EXISTS (
                 SELECT 1 FROM packer_logs pl
                 JOIN   shipping_tracking_numbers stn ON stn.id = pl.shipment_id
                 WHERE  RIGHT(regexp_replace(UPPER(COALESCE(stn.tracking_number_normalized, '')), '[^A-Z0-9]', '', 'g'), 18) = $1
                   AND  pl.tracking_type = 'ORDERS'
               ) THEN 'shipped'
               ELSE status
             END
         WHERE id = $2`,
        [trackingKey18, order.id]
      );
    }

    // Mark as resolved instead of deleting — station_scan_sessions holds FK
    // references to orders_exceptions rows, so deletion would violate the
    // constraint. Keeping resolved rows preserves the audit trail.
    const resolvedResult = orgId
      ? await tenantQuery(
          orgId,
          `UPDATE orders_exceptions SET status = 'resolved', updated_at = NOW() WHERE id = $1 AND organization_id = $2`,
          [row.id, orgId]
        )
      : await pool.query(
          `UPDATE orders_exceptions SET status = 'resolved', updated_at = NOW() WHERE id = $1`,
          [row.id]
        );

    deleted += resolvedResult.rowCount || 0;
  }

  progress({ type: 'phase', phase: 'done' });

  return {
    scanned: openExceptions.rows.length,
    matched,
    deleted,
    resolved,
    stillOpen,
  };
}
