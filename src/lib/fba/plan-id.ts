const AMAZON_FBA_SHIPMENT_ID_RE = /^FBA[0-9A-Z]{8,}$/i;

/**
 * Parse the internal `fba_shipments.id` used by `/api/fba/shipments/[id]`.
 * This route never accepts Amazon's external FBA shipment id.
 */
export function parseFbaPlanId(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const normalized = Math.floor(parsed);
  return normalized > 0 ? normalized : null;
}

export function getInvalidFbaPlanIdMessage(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return 'Missing plan id';
  if (AMAZON_FBA_SHIPMENT_ID_RE.test(raw)) {
    return 'Expected internal plan id (fba_shipments.id), not Amazon FBA shipment id';
  }
  return 'Invalid plan id';
}
