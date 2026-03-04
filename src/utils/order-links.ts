import { getOrderPlatformLabel } from './order-platform';
export { getTrackingUrl } from './tracking';

export function getOrderIdUrl(orderId: string): string | null {
  if (!orderId || orderId === 'Not available' || orderId === 'N/A') return null;
  if (/^\d{3}-\d+-\d+$/.test(orderId)) {
    return `https://sellercentral.amazon.com/orders-v3/order/${orderId}`;
  }
  if (/^\d{4}$/.test(orderId)) {
    return `https://my.ecwid.com/store/16593703#order:id=${orderId}&use_cache=true&return=orders`;
  }
  return null;
}

export function getAccountSourceLabel(orderId: string, accountSource: string | null | undefined): string {
  return getOrderPlatformLabel(orderId, accountSource);
}
