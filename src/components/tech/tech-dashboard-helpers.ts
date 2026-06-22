/**
 * Pure helpers for the tech dashboard. Extracted from TechDashboard so the
 * right-pane component can build a preview shape without pulling in the page.
 */

import type { ActiveStationOrder } from '@/hooks/useStationTestingController';
import type { Order } from '@/components/station/upnext/upnext-types';

/**
 * Build the synthetic `ActiveStationOrder` shape consumed by the workspace card
 * from an Up Next `Order`. Used for the right-pane preview when a tech clicks a
 * card before scanning (no serials, no test data yet).
 */
export function previewOrderToActiveShape(order: Order): ActiveStationOrder {
  const qty = Math.max(1, parseInt(String(order.quantity || '1'), 10) || 1);
  return {
    id: order.id,
    orderId: order.order_id,
    productTitle: order.product_title || '',
    itemNumber: order.item_number,
    sku: order.sku || '',
    condition: order.condition || '',
    notes: '',
    tracking: order.shipping_tracking_number || '',
    serialNumbers: [],
    testDateTime: null,
    testedBy: null,
    quantity: qty,
    shipByDate: order.ship_by_date,
    createdAt: order.created_at,
    orderFound: true,
    sourceType: 'order',
  };
}
