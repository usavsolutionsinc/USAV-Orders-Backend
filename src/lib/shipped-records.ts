import type { PackerRecord } from '@/hooks/usePackerLogs';
import { isStalled } from '@/components/shipping/ShipmentStatusBadge';
import {
  deriveOutboundState,
  hasLeftWarehouse,
  effectiveShipTime,
  type WithOutboundState,
} from '@/lib/outbound-state';

export type DerivedPackerRecord = PackerRecord & WithOutboundState;

// FBA records are identified by scan_ref matching Amazon's FBA shipment ID format
// (FBAxxxxxxxx) or by tracking_type being 'FBA' / 'FNSKU'.
// NOTE: equivalent logic is also inlined in hooks/station/usePackerTableController.ts
// and lib/shipped/pickup-report.ts — candidates for a future single-SoT dedup.
const FBA_SHIPMENT_ID_RE = /^FBA[0-9A-Z]{8,}$/i;

export function isFbaPackerRecord(record: { scan_ref?: string | null; tracking_type?: string | null }): boolean {
  const scanRef = String(record.scan_ref || '').trim();
  const ttype = String(record.tracking_type || '').toUpperCase();
  return FBA_SHIPMENT_ID_RE.test(scanRef) || ttype === 'FBA' || ttype === 'FNSKU';
}

// SKU records are identified by tracking_type === 'SKU' (set by packer_logs.tracking_type)
// or by scan_ref containing ':' (the "SKU_VALUE:QUANTITY" format used at the pack station).
export function isSkuPackerRecord(record: { scan_ref?: string | null; tracking_type?: string | null }): boolean {
  const ttype = String(record.tracking_type || '').toUpperCase();
  if (ttype === 'SKU') return true;
  const scanRef = String(record.scan_ref || '').trim();
  return scanRef.includes(':');
}

export function hasLinkedOrder(record: { order_row_id?: number | null; order_id?: string | null }): boolean {
  if (record.order_row_id != null) return true;
  return String(record.order_id || '').trim().length > 0;
}

export function isExceptionPackerRecord(record: { row_source?: string | null; exception_reason?: string | null }): boolean {
  return String(record.row_source || '').trim().toLowerCase() === 'exception'
    || !!String(record.exception_reason || '').trim();
}

/**
 * Collapse duplicate scans of the SAME package, while keeping a multi-package
 * order as one row PER package (they ship at different times). Shared by the
 * table and the scan-out sidebar so both count/show the same set.
 */
export function dedupeShippedRecords(records: PackerRecord[]): PackerRecord[] {
  const seen = new Map<string, PackerRecord>();
  [...records].sort((a, b) => a.id - b.id).forEach((record) => {
    const orderKey = String(record.order_id || '').trim();
    const shipKey = record.shipment_id != null ? String(record.shipment_id) : '';
    const key = orderKey
      ? shipKey
        ? `${orderKey}::${shipKey}`
        : orderKey
      : (record.shipping_tracking_number || record.scan_ref || String(record.id)).trim();
    seen.set(key, record);
  });
  return Array.from(seen.values());
}

/** Attach the derived outbound state (packed-time vs left-warehouse-time) to a record. */
export function deriveShippedRecord(r: PackerRecord): DerivedPackerRecord {
  const stalled = isStalled({
    isTerminal: r.is_terminal ?? null,
    category: r.latest_status_category ?? null,
    latestEventAt: r.latest_event_at ?? null,
  });
  const input = {
    packedAt: r.created_at,
    shipConfirmedAt: r.ship_confirmed_at ?? null,
    latestStatusCategory: r.latest_status_category ?? null,
    isTerminal: r.is_terminal ?? null,
    hasException: r.has_exception ?? null,
    stalled,
  };
  return {
    ...r,
    outboundState: deriveOutboundState(input),
    hasLeft: hasLeftWarehouse(input),
    effShipTime: effectiveShipTime(input),
  };
}
