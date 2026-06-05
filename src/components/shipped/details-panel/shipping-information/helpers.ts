import { ShippedOrder } from '@/lib/neon/orders-queries';
import { normalizeTrackingKey } from '@/lib/tracking-format';
import { toPSTDateKey } from '@/utils/date';
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
