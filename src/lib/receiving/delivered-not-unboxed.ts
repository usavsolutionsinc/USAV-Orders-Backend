/**
 * "Delivered · not unboxed" — carrier delivered, warehouse has not finished
 * unboxing. Broader than delivered-unscanned: includes dock-scanned cartons
 * that still have unboxed_at NULL / qty=0.
 *
 * Dedicated list feed because view=incoming excludes SHIPMENT_SCANNED rows, so
 * scanned-but-not-unboxed would never appear in the main lines table.
 */

import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import {
  NOT_ZOHO_RECEIVED_PREDICATE,
  SHIPMENT_SCANNED_PREDICATE,
} from '@/lib/receiving/delivered-unscanned';

export const DELIVERED_NOT_UNBOXED_WINDOW_DAYS = 30;
export const DELIVERED_NOT_UNBOXED_CAP = 100;

/** Shared not-unboxed guard (aliases `rl`, `r`). */
export const NOT_UNBOXED_PREDICATE = `COALESCE(rl.quantity_received, 0) = 0
           AND (r.id IS NULL OR r.unboxed_at IS NULL)
           AND rl.workflow_status NOT IN (
             'UNBOXED','AWAITING_TEST','IN_TEST','PASSED','DONE','FAILED','RTV','SCRAP'
           )`;

export interface DeliveredNotUnboxedItem {
  receiving_line_id: number;
  shipment_id: number | null;
  carrier: string | null;
  tracking_number_raw: string | null;
  delivered_at: string | null;
  zoho_purchaseorder_id: string | null;
  po_number: string | null;
  vendor_name: string | null;
  expected_delivery_date: string | null;
  po_date: string | null;
  item_name: string | null;
  sku: string | null;
  workflow_status: string | null;
  was_scanned: boolean;
}

export async function getDeliveredNotUnboxedCount(orgId: OrgId): Promise<number> {
  const { rows } = await tenantQuery<{ n: number }>(
    orgId,
    `SELECT COUNT(DISTINCT COALESCE(rl.zoho_purchaseorder_id, rl.id::text))::int AS n
       FROM receiving_lines rl
       LEFT JOIN receiving r ON (
            r.id = rl.receiving_id
         OR (rl.receiving_id IS NULL
             AND r.source = 'zoho_po'
             AND r.zoho_purchaseorder_id = rl.zoho_purchaseorder_id
             AND r.organization_id = rl.organization_id)
         OR (rl.receiving_id IS NULL
             AND r.source = 'ebay'
             AND r.source_order_id = rl.source_order_id
             AND r.organization_id = rl.organization_id)
       )
       LEFT JOIN shipping_tracking_numbers stn ON stn.id = r.shipment_id
       LEFT JOIN zoho_po_mirror mirror ON mirror.zoho_purchaseorder_id = rl.zoho_purchaseorder_id
      WHERE rl.organization_id = $1
        AND stn.is_delivered = true
        AND stn.delivered_at > NOW() - ($2 || ' days')::interval
        AND ${NOT_UNBOXED_PREDICATE}
        AND (
          rl.zoho_purchaseorder_id IS NOT NULL AND ${NOT_ZOHO_RECEIVED_PREDICATE}
          OR rl.inbound_source_type = 'ebay'
        )`,
    [orgId, String(DELIVERED_NOT_UNBOXED_WINDOW_DAYS)],
  );
  return rows[0]?.n ?? 0;
}

export async function listDeliveredNotUnboxed(orgId: OrgId): Promise<DeliveredNotUnboxedItem[]> {
  const { rows } = await tenantQuery<DeliveredNotUnboxedItem>(
    orgId,
    `SELECT DISTINCT ON (rl.id)
            rl.id                              AS receiving_line_id,
            stn.id                             AS shipment_id,
            stn.carrier,
            stn.tracking_number_raw,
            stn.delivered_at::text             AS delivered_at,
            rl.zoho_purchaseorder_id,
            COALESCE(mirror.zoho_purchaseorder_number, rl.source_order_id)
                                               AS po_number,
            COALESCE(mirror.vendor_name, rl.item_name) AS vendor_name,
            mirror.expected_delivery_date::text AS expected_delivery_date,
            mirror.po_date::text               AS po_date,
            rl.item_name,
            rl.sku,
            rl.workflow_status::text           AS workflow_status,
            (${SHIPMENT_SCANNED_PREDICATE})    AS was_scanned
       FROM receiving_lines rl
       LEFT JOIN receiving r ON (
            r.id = rl.receiving_id
         OR (rl.receiving_id IS NULL
             AND r.source = 'zoho_po'
             AND r.zoho_purchaseorder_id = rl.zoho_purchaseorder_id
             AND r.organization_id = rl.organization_id)
         OR (rl.receiving_id IS NULL
             AND r.source = 'ebay'
             AND r.source_order_id = rl.source_order_id
             AND r.organization_id = rl.organization_id)
       )
       LEFT JOIN shipping_tracking_numbers stn ON stn.id = r.shipment_id
       LEFT JOIN zoho_po_mirror mirror ON mirror.zoho_purchaseorder_id = rl.zoho_purchaseorder_id
      WHERE rl.organization_id = $1
        AND stn.is_delivered = true
        AND stn.delivered_at > NOW() - ($2 || ' days')::interval
        AND ${NOT_UNBOXED_PREDICATE}
        AND (
          rl.zoho_purchaseorder_id IS NOT NULL AND ${NOT_ZOHO_RECEIVED_PREDICATE}
          OR rl.inbound_source_type = 'ebay'
        )
      ORDER BY rl.id, stn.delivered_at DESC NULLS LAST
      LIMIT $3`,
    [orgId, String(DELIVERED_NOT_UNBOXED_WINDOW_DAYS), DELIVERED_NOT_UNBOXED_CAP],
  );
  return rows;
}
