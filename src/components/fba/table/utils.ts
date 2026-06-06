import type { ShipmentTrackingEntry } from './types';

export function getPlanId(item: { plan_id?: number | null; shipment_id?: number | null }): number {
  const direct = Number(item.plan_id);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const legacy = Number(item.shipment_id);
  if (Number.isFinite(legacy) && legacy > 0) return legacy;
  return 0;
}

export function getPrimaryTrackingNumber(item: { tracking_numbers?: ShipmentTrackingEntry[] | null }): string {
  const trackingNumbers = Array.isArray(item.tracking_numbers) ? item.tracking_numbers : [];
  const upsTracking = trackingNumbers.find(
    (entry) => String(entry.carrier || '').toUpperCase() === 'UPS' && String(entry.tracking_number || '').trim()
  );
  const fallbackTracking = trackingNumbers.find((entry) => String(entry.tracking_number || '').trim());
  return String((upsTracking ?? fallbackTracking)?.tracking_number || '').trim();
}
