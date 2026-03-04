'use client';

import { CopyableValueFieldBlock } from './CopyableValueFieldBlock';
import { getOrderIdUrl } from '@/utils/order-links';

interface OrderIdFieldBlockProps {
  orderId: string;
  accountSourceLabel?: string | null;
}

export function OrderIdFieldBlock({
  orderId,
  accountSourceLabel,
}: OrderIdFieldBlockProps) {
  return (
    <CopyableValueFieldBlock
      label="Order ID"
      value={orderId || 'Not available'}
      externalUrl={getOrderIdUrl(orderId)}
      externalLabel={/^\d{3}-\d+-\d+$/.test(orderId) ? 'Open Amazon order in Seller Central in new tab' : 'Open Ecwid order in new tab'}
      headerAccessory={
        accountSourceLabel ? (
          <span className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-100">
            {accountSourceLabel}
          </span>
        ) : null
      }
    />
  );
}
