import { detectCarrier, normalizeTrackingNumber } from './normalize';
import { registerAndSyncShipment } from './sync-shipment';

/**
 * For a raw scan input, returns:
 * - { shipmentId: number, scanRef: null }  — recognized carrier tracking number
 * - { shipmentId: null, scanRef: string }  — non-carrier scan (SKU, FNSKU, garbage)
 */
export async function resolveShipmentId(rawInput: string): Promise<{
  shipmentId: number | null;
  scanRef: string | null;
}> {
  const trimmed = rawInput.trim();
  if (!trimmed) return { shipmentId: null, scanRef: null };

  const normalized = normalizeTrackingNumber(trimmed);
  const carrier = detectCarrier(normalized);
  if (!carrier) {
    return { shipmentId: null, scanRef: trimmed };
  }

  try {
    const shipment = await registerAndSyncShipment({
      trackingNumber: trimmed,
      carrier,
      sourceSystem: 'scan',
    });
    return { shipmentId: shipment.id, scanRef: null };
  } catch {
    return { shipmentId: null, scanRef: trimmed };
  }
}
