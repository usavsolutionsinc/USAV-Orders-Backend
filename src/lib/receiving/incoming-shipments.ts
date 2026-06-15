import pool from '@/lib/db';
import { NOT_ZOHO_RECEIVED_PREDICATE } from '@/lib/receiving/delivered-unscanned';
import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';

export interface IncomingShipmentRef {
  id: number;
  carrier: string;
}

/**
 * The shipments backing the Incoming receiving table — the tracking#s an
 * operator actually sees, NOT every active shipment. A shipment is in-scope
 * when it's attached to a still-incoming PO line (EXPECTED, nothing received,
 * PO not Zoho-received/closed), reached via the same soft receiving join the
 * row endpoint uses. Excludes terminal / dead (≥5 errors) / non-UPS·USPS·FedEx.
 *
 * Ordered to poll the most time-sensitive first (out-for-delivery, never
 * polled), then by `next_check_at`. Returns up to `cap + 1` so the caller can
 * detect a capped sweep.
 *
 * Single source of truth shared by the operator "Tracking" button
 * (/api/receiving-lines/incoming/refresh) and the incoming-tracking cron.
 */
export async function selectIncomingShipmentIds(
  cap: number,
  orgId?: OrgId,
): Promise<IncomingShipmentRef[]> {
  // Tenant-scoped path: route through tenantQuery + GUC and add explicit
  // org predicates on the org-bearing parents (`rl`, `r`). The two
  // org-less tables here are reached only via those scoped parents:
  //   - zoho_po_mirror (NEEDS-COL): LEFT JOIN purely to read mirror.status,
  //     anchored on the org-filtered `rl` row;
  //   - shipping_tracking_numbers (NEEDS-COL): integer surrogate-PK join
  //     `stn.id = r.shipment_id` off the org-filtered `r` LATERAL.
  // So no mirror/stn org column exists to filter on (both listed in
  // needsColTables); GUC-wrapping + parent predicates is the scoping.
  if (orgId) {
    const { rows } = await tenantQuery<IncomingShipmentRef>(
      orgId,
      `WITH incoming_shipments AS (
         SELECT DISTINCT ON (stn.id)
                stn.id,
                stn.carrier,
                stn.latest_status_category,
                stn.is_out_for_delivery,
                stn.is_in_transit,
                stn.is_carrier_accepted,
                stn.next_check_at
           FROM receiving_lines rl
           LEFT JOIN zoho_po_mirror mirror
             ON mirror.zoho_purchaseorder_id = rl.zoho_purchaseorder_id
           JOIN LATERAL (
             SELECT r.* FROM receiving r
              WHERE (r.id = rl.receiving_id
                 OR (rl.receiving_id IS NULL
                     AND r.source = 'zoho_po'
                     AND r.zoho_purchaseorder_id = rl.zoho_purchaseorder_id))
                AND r.organization_id = $1
              ORDER BY (r.id = rl.receiving_id) DESC,
                       (r.shipment_id IS NOT NULL) DESC,
                       r.id DESC
              LIMIT 1
           ) r ON TRUE
           JOIN shipping_tracking_numbers stn ON stn.id = r.shipment_id
          WHERE rl.workflow_status = 'EXPECTED'
            AND COALESCE(rl.quantity_received, 0) = 0
            AND rl.zoho_purchaseorder_id IS NOT NULL
            AND rl.organization_id = $1
            AND ${NOT_ZOHO_RECEIVED_PREDICATE}
            AND stn.carrier IN ('UPS','USPS','FEDEX')
            AND COALESCE(stn.is_terminal, false) = false
            AND COALESCE(stn.consecutive_error_count, 0) < 5
          ORDER BY stn.id
       )
       SELECT id, carrier
         FROM incoming_shipments
        ORDER BY CASE WHEN is_out_for_delivery THEN 0
                      WHEN latest_status_category IS NULL THEN 1
                      WHEN is_in_transit THEN 2
                      WHEN is_carrier_accepted THEN 3
                      ELSE 4 END,
                 next_check_at ASC NULLS FIRST
        LIMIT ${cap + 1}`,
      [orgId],
    );
    return rows;
  }

  const { rows } = await pool.query<IncomingShipmentRef>(
    `WITH incoming_shipments AS (
       SELECT DISTINCT ON (stn.id)
              stn.id,
              stn.carrier,
              stn.latest_status_category,
              stn.is_out_for_delivery,
              stn.is_in_transit,
              stn.is_carrier_accepted,
              stn.next_check_at
         FROM receiving_lines rl
         LEFT JOIN zoho_po_mirror mirror
           ON mirror.zoho_purchaseorder_id = rl.zoho_purchaseorder_id
         JOIN LATERAL (
           SELECT r.* FROM receiving r
            WHERE r.id = rl.receiving_id
               OR (rl.receiving_id IS NULL
                   AND r.source = 'zoho_po'
                   AND r.zoho_purchaseorder_id = rl.zoho_purchaseorder_id)
            ORDER BY (r.id = rl.receiving_id) DESC,
                     (r.shipment_id IS NOT NULL) DESC,
                     r.id DESC
            LIMIT 1
         ) r ON TRUE
         JOIN shipping_tracking_numbers stn ON stn.id = r.shipment_id
        WHERE rl.workflow_status = 'EXPECTED'
          AND COALESCE(rl.quantity_received, 0) = 0
          AND rl.zoho_purchaseorder_id IS NOT NULL
          AND ${NOT_ZOHO_RECEIVED_PREDICATE}
          AND stn.carrier IN ('UPS','USPS','FEDEX')
          AND COALESCE(stn.is_terminal, false) = false
          AND COALESCE(stn.consecutive_error_count, 0) < 5
        ORDER BY stn.id
     )
     SELECT id, carrier
       FROM incoming_shipments
      ORDER BY CASE WHEN is_out_for_delivery THEN 0
                    WHEN latest_status_category IS NULL THEN 1
                    WHEN is_in_transit THEN 2
                    WHEN is_carrier_accepted THEN 3
                    ELSE 4 END,
               next_check_at ASC NULLS FIRST
      LIMIT ${cap + 1}`,
  );
  return rows;
}
