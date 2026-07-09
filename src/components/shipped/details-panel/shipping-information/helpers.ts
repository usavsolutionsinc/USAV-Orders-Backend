import { ShippedOrder } from '@/lib/neon/orders-queries';
import { normalizeTrackingKey } from '@/lib/tracking-format';
import { toPSTDateKey, formatDateTimePST, getDaysLateNumber } from '@/utils/date';
import { getStaffName } from '@/utils/staff';
import { parseSerialRows } from '../serial-helpers';
import type { EditableShippingFields, FlatTrackingRow, TrackingRow } from './types';

export function normalizeTrackingRows(raw: unknown): TrackingRow[] {
  if (!Array.isArray(raw)) return [];
  const out: TrackingRow[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const item = row as any;
    const tracking = String(item.tracking_number_raw || item.tracking || '').trim();
    if (!tracking) continue;
    const shipmentIdNum = Number(item.shipment_id);
    out.push({
      shipmentId: Number.isFinite(shipmentIdNum) && shipmentIdNum > 0 ? shipmentIdNum : null,
      tracking,
      isPrimary: Boolean(item.is_primary),
    });
  }
  return out;
}

export function normalizeShipByDraft(value: string | null | undefined): string {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  if (/^\d{1,2}-\d{1,2}(?:-\d{2,4})?$/.test(trimmed)) return trimmed;
  const pstDateKey = toPSTDateKey(trimmed);
  if (!pstDateKey) return '';
  const [year, month, day] = pstDateKey.split('-').map(Number);
  return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}-${String(year % 100).padStart(2, '0')}`;
}

/**
 * Build a single flat list of ALL tracking numbers for this order.
 * No primary vs secondary distinction — just Tracking 1, 2, 3, etc.
 */
export function buildAllTrackingRows(
  shipped: ShippedOrder,
  editableShippingFields?: EditableShippingFields,
): FlatTrackingRow[] {
  const fromRows = normalizeTrackingRows((shipped as any).tracking_number_rows);
  const seen = new Set<string>();
  const out: FlatTrackingRow[] = [];

  // Start with whatever tracking_number_rows the query returned (already
  // includes primary + linked + sibling tracking from the UNION query).
  if (fromRows.length > 0) {
    for (const row of fromRows) {
      const key = normalizeTrackingKey(row.tracking);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ tracking: row.tracking, shipmentId: row.shipmentId });
    }
  }

  // If the query didn't return rows, fall back to the primary tracking field.
  if (out.length === 0) {
    const primary = String(
      editableShippingFields?.trackingNumber ?? shipped.shipping_tracking_number ?? ''
    ).trim();
    if (primary) {
      const primaryShipmentId = shipped.shipment_id != null ? Number(shipped.shipment_id) : null;
      out.push({
        tracking: primary,
        shipmentId: primaryShipmentId != null && Number.isFinite(primaryShipmentId) && primaryShipmentId > 0
          ? primaryShipmentId
          : null,
      });
    }
  }

  return out;
}

export function serialNumberRowsFromShipped(shipped: ShippedOrder): string[] {
  return parseSerialRows(shipped.serial_number)
    .map((row) => row.trim())
    .filter(Boolean);
}

export interface ShippingDisplayMeta {
  daysLate: number;
  /** Packed timestamp source (pack-activity preferred over packed_at), or null. */
  packedAtSource: string | null;
  shippedAtDisplay: string;
  testedAtDateTimeDisplay: string;
  isScannedOut: boolean;
  scannedOutDisplay: string;
  scannedOutByDisplay: string | null;
  packerNameDisplay: string;
  techNameDisplay: string;
  /** Combined return/provenance block as one clipboard payload. */
  returnsCopyText: string;
}

/**
 * Derive the Return / Shipping block display values for an order — the packed /
 * tested / scanned-out names + timestamps, days-late count, and the combined
 * copy-all payload. Pure: name resolution falls back through the SAL/packer-log
 * name columns to {@link getStaffName}; timestamps format in PST.
 */
export function deriveShippingDisplayMeta(
  shipped: ShippedOrder,
  serialNumberRows: string[],
): ShippingDisplayMeta {
  const daysLate = getDaysLateNumber(shipped.ship_by_date || shipped.created_at || null);

  const packedAtSource =
    (shipped.pack_activity_at && shipped.pack_activity_at !== '1' ? shipped.pack_activity_at : null)
    ?? (shipped.packed_at && shipped.packed_at !== '1' ? shipped.packed_at : null);
  const shippedAtDisplay = packedAtSource ? formatDateTimePST(packedAtSource) : 'N/A';
  const testedAtDateTimeDisplay = shipped.test_date_time
    ? formatDateTimePST(shipped.test_date_time)
    : 'N/A';

  const isScannedOut = Boolean(shipped.ship_confirmed_at && shipped.ship_confirmed_at !== '1');
  const scannedOutDisplay = isScannedOut
    ? formatDateTimePST(shipped.ship_confirmed_at as string)
    : 'N/A';
  // Who scanned it out at the dock — SAL SHIP_CONFIRM staff, surfaced for parity
  // with the Packed / Tested By rows (and for staff reporting).
  const scannedOutByDisplay = isScannedOut
    ? (String(
        (shipped as any).shipped_out_by_name
        || getStaffName((shipped as any).shipped_out_by ?? null)
      ).trim() || 'Not specified')
    : null;

  // Packer from actual SAL/packer_logs scan data only — not from work_assignment packer_id
  const packerNameDisplay = String(
    (shipped as any).packed_by_name
    || (shipped as any).packer_name
    || getStaffName((shipped as any).packed_by ?? null)
  ).trim() || 'Not specified';
  const techNameDisplay = String(
    (shipped as any).tester_name
    || (shipped as any).tested_by_name
    || getStaffName((shipped as any).tested_by ?? (shipped as any).tester_id ?? null)
  ).trim() || 'Not specified';

  const returnsCopyText = [
    `Order ID: ${shipped.order_id || 'N/A'}`,
    `Serials: ${serialNumberRows.length ? serialNumberRows.join(', ') : 'N/A'}`,
    `Tested By: ${techNameDisplay} ${testedAtDateTimeDisplay}`,
    `Packed By: ${packerNameDisplay} ${shippedAtDisplay}`,
    `Scanned Out: ${scannedOutByDisplay ?? 'N/A'} ${scannedOutDisplay}`,
  ].join('\n');

  return {
    daysLate,
    packedAtSource,
    shippedAtDisplay,
    testedAtDateTimeDisplay,
    isScannedOut,
    scannedOutDisplay,
    scannedOutByDisplay,
    packerNameDisplay,
    techNameDisplay,
    returnsCopyText,
  };
}
