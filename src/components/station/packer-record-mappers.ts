import { type PackerRecord } from '@/hooks/usePackerLogs';

/**
 * Map a packer-log record into the shared shipped-details payload shape
 * consumed by the details panel (`open-shipped-details` event detail).
 */
export function packerRecordToDetail(record: PackerRecord) {
  return {
    id: record.id,
    ship_by_date: '',
    order_id: record.order_id || '',
    product_title: record.product_title || '',
    item_number: null,
    condition: record.condition || '',
    shipping_tracking_number: record.shipping_tracking_number || '',
    tracking_numbers: record.tracking_numbers || [],
    tracking_number_rows: record.tracking_number_rows || [],
    serial_number: '',
    sku: record.sku || '',
    tester_id: null,
    tested_by: null,
    test_date_time: null,
    packer_id: record.packed_by || null,
    packed_by: record.packed_by || null,
    packed_at: record.created_at || null,
    packer_photos_url: record.packer_photos_url || [],
    tracking_type: record.tracking_type || null,
    account_source: record.account_source || null,
    notes: '',
    status_history: [],
    is_shipped: undefined,
    created_at: record.created_at || null,
    quantity: record.quantity || '1',
    packer_log_id: record.packer_log_id ?? null,
    station_activity_log_id: record.id,
    fnsku:
      record.fnsku ||
      (String(record.tracking_type || '').toUpperCase() === 'FNSKU'
        ? String(record.scan_ref || '').trim() || null
        : null),
    fnsku_log_id: record.fnsku_log_id ?? null,
  };
}

/** Stable detail id for a packer record (matches the dispatched payload's id). */
export function getPackerDetailId(record: PackerRecord): number {
  return Number(packerRecordToDetail(record).id);
}
