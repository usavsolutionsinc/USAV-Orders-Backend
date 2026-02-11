import { ShippedOrder } from '@/lib/neon/orders-queries';
import { getStaffName } from './staff';

export function parseShippedDate(dateStr: string): Date {
  if (dateStr.includes('/')) {
    const [datePart, timePart] = dateStr.split(' ');
    const [m, d, y] = datePart.split('/').map(Number);
    const [h, min, s] = timePart.split(':').map(Number);
    return new Date(y, m - 1, d, h, min, s);
  }
  return new Date(dateStr);
}

export function formatShippedDateTime(dateStr: string | null | undefined): string {
  if (!dateStr || dateStr === '1') return 'N/A';
  return parseShippedDate(dateStr)
    .toLocaleString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
    .replace(',', '');
}

export function buildShippedCopyInfo(shipped: ShippedOrder): string {
  const formattedDateTime = formatShippedDateTime(shipped.pack_date_time);
  return `Serial: ${shipped.serial_number || 'N/A'}
Order ID: ${shipped.order_id || 'Not available'}
Tracking: ${shipped.shipping_tracking_number || 'Not available'}
Product: ${shipped.product_title || 'Not provided'}
Condition: ${shipped.condition || 'Not set'}
Tested By: ${getStaffName(shipped.tested_by)}
Packed By: ${getStaffName(shipped.packed_by)}
Shipped: ${formattedDateTime}`;
}
