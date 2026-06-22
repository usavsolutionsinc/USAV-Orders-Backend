import type { PackerRecord } from '@/hooks/usePackerLogs';
import type { ShippedOrder } from '@/lib/neon/orders-queries';

/**
 * Pure shape-mappers between the two record types the Shipped table juggles:
 * the `PackerRecord` rows that come back from the week query / scan-out, and the
 * `ShippedOrder` shape the details panel expects. Extracted from
 * DashboardShippedTable so the table component stays composition-only.
 */

/** Build the details-panel `ShippedOrder` payload from a packer record. */
export function toDetailRecord(record: PackerRecord): ShippedOrder {
  return {
    id: record.order_row_id || record.id,
    deadline_at: record.deadline_at || null,
    ship_by_date: record.ship_by_date || null,
    order_id: record.order_id || '',
    product_title: record.product_title || '',
    quantity: record.quantity || '1',
    item_number: record.item_number || null,
    condition: record.condition || '',
    shipment_id: record.shipment_id ?? null,
    shipping_tracking_number: record.shipping_tracking_number || '',
    tracking_numbers: record.tracking_numbers || [],
    tracking_number_rows: (record as any).tracking_number_rows || [],
    serial_number: record.serial_number || '',
    sku: record.sku || '',
    tester_id: record.tester_id ?? null,
    tested_by: record.tested_by ?? null,
    test_date_time: record.test_date_time || null,
    packer_id: record.packed_by ?? null,
    packed_by: record.packed_by ?? null,
    packed_at: record.created_at || null,
    ship_confirmed_at: record.ship_confirmed_at ?? null,
    shipped_out_by: record.shipped_out_by ?? null,
    shipped_out_by_name: record.shipped_out_by_name ?? null,
    packer_photos_url: record.packer_photos_url || [],
    tracking_type: record.tracking_type || null,
    account_source: record.account_source || null,
    notes: record.notes || '',
    status_history: record.status_history || [],
    created_at: record.created_at || null,
    tested_by_name: record.tested_by_name || null,
    packed_by_name: record.packed_by_name || null,
    tester_name: record.tester_name || null,
    packer_log_id: record.packer_log_id ?? null,
    station_activity_log_id: record.id,
    row_source: ((record as any).row_source || 'order') as ShippedOrder['row_source'],
    exception_reason: (record as any).exception_reason || null,
    exception_status: (record as any).exception_status || null,
    fnsku: record.fnsku || null,
    fnsku_log_id: record.fnsku_log_id ?? null,
    carrier: record.carrier ?? null,
    latest_status_code: record.latest_status_code ?? null,
    latest_status_label: record.latest_status_label ?? null,
    latest_status_description: record.latest_status_description ?? null,
    latest_status_category: record.latest_status_category ?? null,
    latest_event_at: record.latest_event_at ?? null,
    has_exception: record.has_exception ?? null,
    exception_at: record.exception_at ?? null,
    is_terminal: record.is_terminal ?? null,
  } as ShippedOrder;
}

/** Stable detail id for a packer record (order row if linked, else log id). */
export function getDetailId(record: PackerRecord): number {
  return Number(record.order_row_id || record.id);
}

/** Map a search-result `ShippedOrder` back into the `PackerRecord` row shape the table renders. */
export function toSearchResultRecord(record: ShippedOrder): PackerRecord {
  return {
    id: Number(record.id),
    created_at: record.pack_activity_at || record.packed_at || record.created_at || null,
    scan_ref: record.shipping_tracking_number || '',
    shipping_tracking_number: record.shipping_tracking_number || '',
    tracking_numbers: Array.isArray((record as any).tracking_numbers) ? (record as any).tracking_numbers : [],
    tracking_number_rows: Array.isArray((record as any).tracking_number_rows) ? (record as any).tracking_number_rows : [],
    packed_by: record.packer_id ?? record.packed_by ?? null,
    packed_by_name: record.packed_by_name || null,
    tracking_type: record.tracking_type || null,
    packer_photos_url: record.packer_photos_url || [],
    order_row_id: Number(record.id),
    shipment_id: record.shipment_id ?? null,
    order_id: record.order_id || '',
    account_source: record.account_source || null,
    product_title: record.product_title || '',
    quantity: record.quantity || '1',
    item_number: record.item_number || null,
    condition: record.condition || '',
    sku: record.sku || '',
    notes: record.notes || '',
    status_history: record.status_history || [],
    serial_number: record.serial_number || '',
    tested_by: record.tested_by ?? null,
    tester_id: record.tester_id ?? null,
    test_date_time: record.test_date_time || null,
    tested_by_name: record.tested_by_name || null,
    tester_name: record.tester_name || null,
    row_source: (record as any).row_source || 'order',
    exception_reason: (record as any).exception_reason || null,
    exception_status: (record as any).exception_status || null,
    fnsku: record.fnsku ?? null,
    fnsku_log_id: record.fnsku_log_id ?? null,
    carrier: record.carrier ?? null,
    latest_status_code: record.latest_status_code ?? null,
    latest_status_label: record.latest_status_label ?? null,
    latest_status_description: record.latest_status_description ?? null,
    latest_status_category: record.latest_status_category ?? null,
    latest_event_at: record.latest_event_at ?? null,
    has_exception: record.has_exception ?? null,
    exception_at: record.exception_at ?? null,
    is_terminal: record.is_terminal ?? null,
  } as PackerRecord;
}
