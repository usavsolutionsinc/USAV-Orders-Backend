import { type TechRecord } from '@/hooks/useTechLogs';
import { hasUsableProductTitle } from '@/hooks/station/useTechTableController';

/** Trim a product title to a clean string (empty when missing). */
export function normalizeProductTitle(value: string | null | undefined): string {
  return String(value || '').trim();
}

/**
 * Map a tech-log record into the shared shipped-details payload shape consumed
 * by the details panel (`open-shipped-details` event detail).
 */
export function techRecordToDetail(record: TechRecord) {
  // Normalize deadline to YYYY-MM-DD — field is sourced from work_assignments.deadline_at (TIMESTAMPTZ)
  const shipByDate = record.ship_by_date
    ? String(record.ship_by_date).split('T')[0]
    : '';

  return {
    id: record.order_db_id ?? record.id,
    ship_by_date: shipByDate,
    order_id: record.order_id || '',
    product_title: hasUsableProductTitle(record.product_title) ? normalizeProductTitle(record.product_title) : '',
    item_number: record.item_number || null,
    condition: record.condition || '',
    shipping_tracking_number: record.shipping_tracking_number || '',
    tracking_numbers: record.tracking_numbers || [],
    tracking_number_rows: record.tracking_number_rows || [],
    serial_number: record.serial_number || '',
    sku: record.sku || '',
    tester_id: null,
    tested_by: record.tested_by || null,
    test_date_time: record.created_at || null,
    packer_id: null,
    packed_by: null,
    packed_at: null,
    packer_photos_url: [],
    tracking_type: record.fnsku ? 'FNSKU' : null,
    account_source: record.account_source || null,
    notes: record.notes || '',
    status_history: record.status_history || [],
    is_shipped: !!record.is_shipped,
    created_at: record.created_at || null,
    quantity: record.quantity || '1',
    shipment_id: record.shipment_id ?? null,
    status: record.status ?? null,
    tech_serial_id: record.tech_serial_id ?? (record.source_kind === 'tech_serial' ? record.id : undefined),
    source_row_id: record.source_row_id ?? null,
    source_kind: record.source_kind ?? null,
    fnsku: record.fnsku || null,
    fnsku_log_id: record.fnsku_log_id ?? null,
    sal_id: record.source_row_id ?? record.id,
  };
}

/** Stable detail id for a tech record (matches the dispatched payload's id). */
export function getTechDetailId(record: TechRecord): number {
  const detail = techRecordToDetail(record);
  return Number(detail.id ?? detail.shipment_id ?? record.id);
}
