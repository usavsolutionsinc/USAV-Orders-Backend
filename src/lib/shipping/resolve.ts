import { looksLikeFnsku } from '@/lib/scan-resolver';
import type { OrgId } from '@/lib/tenancy/constants';
import { detectCarrier, normalizeTrackingNumber } from './normalize';
import { getShipmentByTracking } from './repository';
import { registerAndSyncShipment } from './sync-shipment';

/**
 * For a raw scan input, returns:
 * - { shipmentId: number, scanRef: null }  — recognized carrier tracking number
 * - { shipmentId: null, scanRef: string }  — non-carrier scan (SKU, FNSKU, garbage)
 *
 * For unknown carriers the function still queries shipping_tracking_numbers by
 * normalized value so that orders previously registered through import scripts
 * (which may have created the row via a different code path) are found even
 * when the live carrier API cannot be used for syncing.
 */
export async function resolveShipmentId(
  rawInput: string,
  // OPTIONAL tenant scope. When present, the shipping_tracking_numbers /
  // shipment_tracking_events lookups + register/sync run under the org GUC by
  // threading orgId through to the sibling helpers (both tables are
  // tenant-owned-NEEDS-COL → GUC-scoped, no inline org column to filter on).
  // When omitted, behavior is byte-identical to before (raw pool path) so the
  // many un-migrated callers keep working unchanged.
  orgId?: OrgId,
): Promise<{
  shipmentId: number | null;
  scanRef: string | null;
}> {
  const trimmed = rawInput.trim();
  if (!trimmed) return { shipmentId: null, scanRef: null };

  // Canonical FNSKU / ASIN scans (X0... / B0...) must never resolve to carrier shipment rows;
  // tech station treats them as FNSKU context (scanRef only), same as deduped tracking elsewhere.
  if (looksLikeFnsku(trimmed)) {
    return { shipmentId: null, scanRef: trimmed };
  }

  const normalized = normalizeTrackingNumber(trimmed);
  const carrier = detectCarrier(normalized);

  if (!carrier) {
    // Unknown carrier — still try a DB lookup so that existing rows are found
    try {
      const existing =
        orgId != null
          ? await getShipmentByTracking(normalized, orgId)
          : await getShipmentByTracking(normalized);
      if (existing) return { shipmentId: existing.id, scanRef: null };
    } catch {
      // ignore lookup error; fall through to scanRef
    }
    return { shipmentId: null, scanRef: trimmed };
  }

  try {
    const shipment =
      orgId != null
        ? await registerAndSyncShipment(
            {
              trackingNumber: trimmed,
              carrier,
              sourceSystem: 'scan',
            },
            orgId,
          )
        : await registerAndSyncShipment({
            trackingNumber: trimmed,
            carrier,
            sourceSystem: 'scan',
          });
    return { shipmentId: shipment.id, scanRef: null };
  } catch {
    // Registration/sync failed — try a plain DB lookup as fallback
    try {
      const existing =
        orgId != null
          ? await getShipmentByTracking(normalized, orgId)
          : await getShipmentByTracking(normalized);
      if (existing) return { shipmentId: existing.id, scanRef: null };
    } catch {
      // ignore
    }
    return { shipmentId: null, scanRef: trimmed };
  }
}
