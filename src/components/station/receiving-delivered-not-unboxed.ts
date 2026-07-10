/**
 * Line-anchored "delivered, not unboxed yet" boxes for the Incoming facet.
 */

import type { ReceivingLineRow } from './receiving-line-row';

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

export interface DeliveredNotUnboxedResponse {
  success: boolean;
  count: number;
  window_days: number;
  items: DeliveredNotUnboxedItem[];
}

export function deliveredNotUnboxedToRow(item: DeliveredNotUnboxedItem): ReceivingLineRow {
  return {
    id: item.receiving_line_id,
    receiving_id: null,
    tracking_number: item.tracking_number_raw,
    tracking_source: item.tracking_number_raw ? 'shipment' : null,
    carrier: item.carrier,
    shipment_status: 'DELIVERED',
    is_delivered: true,
    delivered_at: item.delivered_at,
    zoho_item_id: null,
    zoho_line_item_id: null,
    zoho_purchase_receive_id: null,
    zoho_purchaseorder_id: item.zoho_purchaseorder_id,
    zoho_purchaseorder_number: item.po_number,
    item_name: item.item_name ?? (item.po_number ? `PO ${item.po_number}` : 'Delivered · not unboxed'),
    sku: item.sku,
    quantity_received: 0,
    quantity_expected: null,
    qa_status: 'PENDING',
    workflow_status: (item.workflow_status as ReceivingLineRow['workflow_status']) ?? 'EXPECTED',
    disposition_code: 'HOLD',
    condition_grade: 'BRAND_NEW',
    disposition_audit: [],
    needs_test: false,
    assigned_tech_id: null,
    zoho_sync_source: null,
    zoho_last_modified_time: null,
    zoho_synced_at: null,
    receiving_type: 'PO',
    notes: null,
    delivery_state: item.was_scanned ? 'DELIVERED_NOT_UNBOXED' : 'DELIVERED_UNOPENED',
    po_date: item.po_date,
    expected_delivery_date: item.expected_delivery_date,
    vendor_name: item.vendor_name,
    created_at: item.delivered_at,
    last_activity_at: item.delivered_at,
    image_url: null,
    source_platform: null,
    is_priority: false,
    priority_tier: null,
    receiving_source: 'unmatched',
    serials: [],
  };
}
