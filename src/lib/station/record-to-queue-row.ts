/**
 * Station record → queue-row mappers (station-table-unification-plan §5.5).
 *
 * The Tech + Packer cutover (Phase 2) renders station logs through the SAME
 * `OrdersQueueTableRow` the Unshipped board uses, so station rows match the
 * Unshipped row anatomy (success criterion #1). These pure adapters shape a
 * {@link TechRecord} / {@link PackerRecord} into the {@link QueueRowRecord}
 * (ShippedOrder-shaped) the row + grouping consume — mapping the fields the row
 * reads and stashing the ORIGINAL record under a well-known key so the row's
 * detail-open and TSV-copy can recover the domain record without a second fetch.
 *
 * Banding: station rows band by `created_at` (the scan timestamp), so both
 * `created_at` and `deadline_at` are set to it (the queue bands by deadline for
 * non-`newest` sorts — see `useOrdersQueueRows`).
 */

import type { QueueRowRecord } from '@/components/dashboard/orders-queue/helpers';
import type { TechRecord } from '@/hooks/useTechLogs';
import type { PackerRecord } from '@/hooks/usePackerLogs';

/** Key under which the original domain record rides along on the mapped row. */
export const STATION_SOURCE_RECORD_KEY = '__stationSourceRecord';
/** Key carrying which station produced the row (`tech` | `packer`). */
export const STATION_SOURCE_KIND_KEY = '__stationSourceKind';

export type StationSourceKind = 'tech' | 'packer';

export function techRecordToQueueRow(record: TechRecord): QueueRowRecord {
  return {
    id: record.id,
    order_id: record.order_id ?? '',
    product_title: record.product_title ?? 'Unknown Product',
    quantity: record.quantity ?? '1',
    item_number: record.item_number ?? null,
    condition: record.condition ?? '',
    shipment_id: record.shipment_id ?? null,
    shipping_tracking_number: record.shipping_tracking_number ?? null,
    tracking_numbers: record.tracking_numbers ?? null,
    tracking_number_rows: record.tracking_number_rows ?? null,
    serial_number: record.serial_number ?? '',
    sku: record.sku ?? '',
    tester_id: record.tested_by ?? null,
    tested_by: record.tested_by ?? null,
    test_date_time: record.created_at,
    packer_id: null,
    packed_by: null,
    packed_at: null,
    packer_photos_url: null,
    tracking_type: null,
    account_source: record.account_source ?? null,
    notes: record.notes ?? '',
    status_history: record.status_history ?? null,
    // Band by the scan timestamp (see file header).
    created_at: record.created_at,
    deadline_at: record.created_at,
    // Station-specific fields the row's tech chip column + detail read.
    fnsku: record.fnsku ?? null,
    fnsku_log_id: record.fnsku_log_id ?? null,
    source_kind: record.source_kind ?? null,
    source_row_id: record.source_row_id ?? null,
    has_sku_serial_source: record.has_sku_serial_source ?? null,
    [STATION_SOURCE_KIND_KEY]: 'tech' satisfies StationSourceKind,
    [STATION_SOURCE_RECORD_KEY]: record,
  } as QueueRowRecord;
}

export function packerRecordToQueueRow(record: PackerRecord): QueueRowRecord {
  return {
    id: record.id,
    order_id: record.order_id ?? '',
    product_title: record.product_title ?? record.item_number ?? record.sku ?? 'Unknown Product',
    quantity: record.quantity ?? '1',
    item_number: record.item_number ?? null,
    condition: record.condition ?? '',
    shipment_id: record.shipment_id ?? null,
    shipping_tracking_number: record.shipping_tracking_number ?? null,
    tracking_numbers: record.tracking_numbers ?? null,
    tracking_number_rows: record.tracking_number_rows ?? null,
    serial_number: record.serial_number ?? '',
    sku: record.sku ?? '',
    tester_id: record.tester_id ?? record.tested_by ?? null,
    tested_by: record.tested_by ?? null,
    test_date_time: record.test_date_time ?? null,
    packer_id: record.packed_by ?? null,
    packed_by: record.packed_by ?? null,
    packed_at: record.created_at,
    packer_photos_url: record.packer_photos_url ?? null,
    tracking_type: record.tracking_type ?? null,
    account_source: record.account_source ?? null,
    notes: record.notes ?? '',
    status_history: record.status_history ?? null,
    created_at: record.created_at,
    deadline_at: record.deadline_at ?? record.created_at,
    // Station-specific fields: packer rows show the FNSKU in the tracking column
    // for FBA (no serial column) — see PackerRecordRow.
    scan_ref: record.scan_ref ?? null,
    fnsku: record.fnsku ?? null,
    fnsku_log_id: record.fnsku_log_id ?? null,
    row_source: record.row_source ?? null,
    tested_by_name: record.tested_by_name ?? null,
    tester_name: record.tester_name ?? null,
    packed_by_name: record.packed_by_name ?? null,
    [STATION_SOURCE_KIND_KEY]: 'packer' satisfies StationSourceKind,
    [STATION_SOURCE_RECORD_KEY]: record,
  } as QueueRowRecord;
}

/** Recover the original domain record stashed on a mapped queue row (detail/copy). */
export function getStationSourceRecord<T>(row: QueueRowRecord): T | undefined {
  return row[STATION_SOURCE_RECORD_KEY] as T | undefined;
}

/** Which station produced a mapped row, if any. */
export function getStationSourceKind(row: QueueRowRecord): StationSourceKind | undefined {
  return row[STATION_SOURCE_KIND_KEY] as StationSourceKind | undefined;
}
