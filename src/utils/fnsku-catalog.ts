import type { ShippedOrder } from '@/lib/neon/orders-queries';

/** True when the row should show FNSKU catalog product details (vs carrier tracking flow). */
export function isFnskuCatalogContext(shipped: ShippedOrder): boolean {
  const t = String(shipped.tracking_type || '').toUpperCase();
  if (t === 'FNSKU') return true;
  if (String(shipped.fnsku || '').trim()) return true;
  return false;
}

/** Primary FNSKU string for display and Quick Add — prefers `fnsku`, else scan stored on tracking field for FNSKU rows. */
export function getFnskuCatalogValue(shipped: ShippedOrder): string {
  const fromField = String(shipped.fnsku || '').trim();
  if (fromField) return fromField;
  if (String(shipped.tracking_type || '').toUpperCase() === 'FNSKU') {
    return String(shipped.shipping_tracking_number || '').trim();
  }
  return '';
}
