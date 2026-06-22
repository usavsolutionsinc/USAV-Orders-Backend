/**
 * Shipment-anchored "delivered, no dock scan yet" boxes (incoming-only). The
 * endpoint resolves each box's Zoho PO from its tracking#, so PO#, vendor,
 * dates and the product/item name ride along — these render with the same
 * fidelity as any other incoming PO row.
 *
 * Extracted from `ReceivingLinesTable.tsx`; the synthetic-id encode/decode pair
 * and the row remapper live here so the table + the incoming details panel
 * (which needs the decode for its delete path) share one source of truth.
 */

import type { ReceivingLineRow } from './receiving-line-row';

export interface DeliveredUnscanned {
  shipment_id: number;
  carrier: string;
  tracking_number_raw: string;
  tracking_number_normalized: string;
  delivered_at: string | null;
  source_system: string | null;
  zoho_purchaseorder_id: string | null;
  po_number: string | null;
  vendor_name: string | null;
  expected_delivery_date: string | null;
  po_date: string | null;
  first_item_name: string | null;
  first_sku: string | null;
  item_count: number | null;
}

export interface DeliveredUnscannedResponse {
  success: boolean;
  count: number;
  window_days: number;
  items: DeliveredUnscanned[];
}

/**
 * Synthetic-row id base for shipment-anchored "delivered · not scanned" boxes.
 * They have no receiving_line, so we mint a negative, collision-free id from the
 * shipment id: `id = BASE - shipment_id`. Keep the encode ({@link deliveredUnscannedToRow})
 * and decode ({@link shipmentIdFromDeliveredUnscannedRow}) in lockstep so the
 * incoming details panel can recover the real shipment id for its delete path.
 */
export const DELIVERED_UNSCANNED_SYNTHETIC_ID_BASE = -2_000_000;

/**
 * Recover the `shipping_tracking_numbers.id` from a synthetic delivered-unscanned
 * row, or null if `row` isn't one. A delivered-unscanned row is the only producer
 * of `tracking_source === 'shipment'` with a negative id (see {@link deliveredUnscannedToRow}).
 */
export function shipmentIdFromDeliveredUnscannedRow(row: ReceivingLineRow): number | null {
  if (row.tracking_source !== 'shipment' || row.id >= 0) return null;
  const shipmentId = DELIVERED_UNSCANNED_SYNTHETIC_ID_BASE - row.id; // inverse of id = BASE - shipment_id
  return Number.isFinite(shipmentId) && shipmentId > 0 ? shipmentId : null;
}

/**
 * Remap a shipment-anchored "delivered but not dock-scanned" box onto the
 * standard {@link ReceivingLineRow} shape so the "Delivered · not scanned"
 * facet renders through the very same date-grouping + ReceivingLineOrderRow
 * pipeline as every other history/incoming row — no bespoke pane. Mirrors the
 * server's `buildUnmatchedEmptyReceivingLine` placeholder: there's no PO line
 * yet, so quantities are zero and the carton reads as an unmatched delivery.
 */
export function deliveredUnscannedToRow(item: DeliveredUnscanned): ReceivingLineRow {
  // Product title: the PO's first line item, with a "+N more" hint when the PO
  // spans several lines. Falls back to the PO# (or a generic label) when the
  // line names aren't synced yet.
  const itemCount = item.item_count ?? 0;
  const productTitle = item.first_item_name
    ? itemCount > 1
      ? `${item.first_item_name} +${itemCount - 1} more`
      : item.first_item_name
    : item.po_number
      ? `PO ${item.po_number}`
      : 'Delivered · needs receiving';

  return {
    id: DELIVERED_UNSCANNED_SYNTHETIC_ID_BASE - item.shipment_id,
    receiving_id: null,
    tracking_number: item.tracking_number_raw,
    tracking_source: 'shipment',
    carrier: item.carrier,
    shipment_status: 'DELIVERED',
    is_delivered: true,
    delivered_at: item.delivered_at,
    zoho_item_id: null,
    zoho_line_item_id: null,
    zoho_purchase_receive_id: null,
    zoho_purchaseorder_id: item.zoho_purchaseorder_id,
    zoho_purchaseorder_number: item.po_number,
    item_name: productTitle,
    sku: item.first_sku,
    quantity_received: 0,
    quantity_expected: itemCount > 0 ? itemCount : null,
    qa_status: 'PENDING',
    workflow_status: 'EXPECTED',
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
    delivery_state: 'DELIVERED_UNOPENED',
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
    photo_count: 0,
    zendesk_ticket: null,
  };
}
