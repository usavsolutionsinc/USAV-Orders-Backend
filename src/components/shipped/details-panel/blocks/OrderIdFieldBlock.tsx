'use client';

import { CopyableValueFieldBlock } from './CopyableValueFieldBlock';
import { getOrderIdUrl } from '@/utils/order-links';

interface OrderIdFieldBlockProps {
  orderId: string;
  accountSourceLabel?: string | null;
  variant?: 'card' | 'flat';
  trailingActions?: React.ReactNode;
}

export function OrderIdFieldBlock({
  orderId,
  accountSourceLabel,
  variant = 'card',
  trailingActions,
}: OrderIdFieldBlockProps) {
  return (
    <CopyableValueFieldBlock
      label="Order ID"
      value={orderId || 'Not available'}
      externalUrl={getOrderIdUrl(orderId)}
      externalLabel={/^\d{3}-\d+-\d+$/.test(orderId) ? 'Open Amazon order in Seller Central in new tab' : 'Open Ecwid order in new tab'}
      headerAccessory={
        accountSourceLabel ? (
          <span className="text-[10px] font-black tracking-wide text-blue-600">
            {accountSourceLabel}
          </span>
        ) : null
      }
      trailingActions={trailingActions}
      variant={variant}
    />
  );
}
