import type { PackerRecord } from '@/hooks/usePackerLogs';
import { isStalled } from '@/components/shipping/ShipmentStatusBadge';
import {
  deriveOutboundState,
  hasLeftWarehouse,
  effectiveShipTime,
  type WithOutboundState,
} from '@/lib/outbound-state';

export type DerivedPackerRecord = PackerRecord & WithOutboundState;

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
