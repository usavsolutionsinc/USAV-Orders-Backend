'use client';

/**
 * /m/orders/[orderId] — mobile order detail.
 * Redesigned for 2026 Mobile Design System.
 */

import { useParams } from 'next/navigation';
import RedesignedMobileOrderDetail from '@/components/mobile/redesign/OrderDetail';

export default function MobileOrderDetailPage() {
  const params = useParams<{ orderId: string }>();
  const orderId = params?.orderId ? decodeURIComponent(params.orderId) : '';

  return <RedesignedMobileOrderDetail orderId={orderId} />;
}
