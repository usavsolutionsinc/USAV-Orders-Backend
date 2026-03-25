export const FBA_ID_RE = /^FBA[0-9A-Z]{8,}$/i;
export const UPS_RE = /^1Z[A-Z0-9]{16}$/i;

export const FBA_TRACKING_PATCH_EVENT = 'fba-print-tracking-patch';

export function normalizeFbaId(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

export function normalizeUps(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

export function dispatchFbaTrackingPatch(detail: { shipmentId: number; amazon?: string; ups?: string }) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(FBA_TRACKING_PATCH_EVENT, { detail }));
}

export async function persistAmazonShipmentId(shipmentId: number, amazonRaw: string): Promise<boolean> {
  const amazon = normalizeFbaId(amazonRaw);
  if (!FBA_ID_RE.test(amazon)) return false;
  const res = await fetch(`/api/fba/shipments/${shipmentId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amazon_shipment_id: amazon }),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.success && !res.ok) return false;
  dispatchFbaTrackingPatch({ shipmentId, amazon });
  window.dispatchEvent(new CustomEvent('fba-print-queue-refresh'));
  return true;
}

export async function persistUpsTracking(shipmentId: number, upsRaw: string): Promise<boolean> {
  const tracking_number = normalizeUps(upsRaw);
  if (!UPS_RE.test(tracking_number)) return false;
  const res = await fetch(`/api/fba/shipments/${shipmentId}/tracking`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tracking_number, carrier: 'UPS', label: 'Print queue' }),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.success && !res.ok) return false;
  dispatchFbaTrackingPatch({ shipmentId, ups: tracking_number });
  window.dispatchEvent(new CustomEvent('fba-print-queue-refresh'));
  return true;
}
