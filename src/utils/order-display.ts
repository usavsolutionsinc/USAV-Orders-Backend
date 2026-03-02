export interface OrderDisplayValuesInput {
  sku?: string | null;
  condition?: string | null;
  trackingNumber?: string | null;
}

export interface OrderDisplayValues {
  sku: string | null;
  condition: string | null;
}

export function extractSkuFromTrackingValue(value: string | null | undefined): string | null {
  const raw = String(value || '').trim();
  if (!raw || !raw.includes(':')) return null;

  const [left] = raw.split(':');
  const sku = String(left || '').trim();
  return sku || null;
}

export function inferConditionFromSku(value: string | null | undefined): 'NEW' | 'USED' | null {
  const sku = String(value || '').trim();
  if (!sku) return null;
  return sku.toUpperCase().endsWith('-N') ? 'NEW' : 'USED';
}

export function getOrderDisplayValues({
  sku,
  condition,
  trackingNumber,
}: OrderDisplayValuesInput): OrderDisplayValues {
  const normalizedSku = String(sku || '').trim() || extractSkuFromTrackingValue(trackingNumber);
  const normalizedCondition = String(condition || '').trim() || inferConditionFromSku(normalizedSku);

  return {
    sku: normalizedSku || null,
    condition: normalizedCondition || null,
  };
}
