/**
 * Load tenant-scoped order context for marketplace document fetch.
 */

import 'server-only';

import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';

export interface OutboundOrderContext {
  id: number;
  orderRef: string;
  accountSource: string | null;
  sku: string | null;
  productTitle: string | null;
  quantity: string | null;
  shipmentId: number | null;
  tracking: string | null;
  carrier: string | null;
}

export async function loadOutboundOrderContext(
  orgId: OrgId,
  orderId: number,
): Promise<OutboundOrderContext | null> {
  const res = await tenantQuery<{
    id: number;
    order_id: string | null;
    account_source: string | null;
    sku: string | null;
    product_title: string | null;
    quantity: string | null;
    shipment_id: number | null;
    tracking_number: string | null;
    carrier: string | null;
  }>(
    orgId,
    `SELECT o.id, o.order_id, o.account_source, o.sku, o.product_title, o.quantity,
            o.shipment_id, stn.tracking_number_normalized AS tracking_number, stn.carrier
       FROM orders o
       LEFT JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
      WHERE o.id = $1 AND o.organization_id = $2
      LIMIT 1`,
    [orderId, orgId],
  );
  if (res.rowCount === 0) return null;
  const row = res.rows[0];
  return {
    id: Number(row.id),
    orderRef: String(row.order_id ?? '').trim() || String(orderId),
    accountSource: row.account_source,
    sku: row.sku,
    productTitle: row.product_title,
    quantity: row.quantity,
    shipmentId: row.shipment_id != null ? Number(row.shipment_id) : null,
    tracking: row.tracking_number,
    carrier: row.carrier,
  };
}

export function detectOutboundPlatform(accountSource: string | null): string {
  const src = (accountSource ?? '').trim().toLowerCase();
  if (!src) return 'unknown';
  if (src.includes('ebay')) return 'ebay';
  if (src.includes('amazon')) return 'amazon';
  if (src.includes('ecwid')) return 'ecwid';
  if (src.includes('walmart')) return 'walmart';
  if (src.includes('zoho')) return 'zoho';
  return src.split(/[\s_-]+/)[0] || 'unknown';
}
