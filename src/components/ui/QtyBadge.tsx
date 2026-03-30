'use client';

import { chipText } from '@/design-system/tokens/typography/presets';

function parseQty(value?: string | number | null): number {
  const parsed = parseInt(String(value ?? '1'), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

interface QtyBadgeProps {
  quantity?: string | number | null;
  className?: string;
}

export function QtyBadge({ quantity, className = '' }: QtyBadgeProps) {
  const qty = parseQty(quantity);
  const isMulti = qty > 1;

  return (
    <span
      className={[
        `px-2 py-0.5 rounded-md ${chipText} uppercase border`,
        isMulti
          ? 'bg-yellow-100 text-yellow-700 border-yellow-200'
          : 'bg-gray-100 text-gray-600 border-gray-200',
        className
      ].join(' ')}
    >
      qty:{qty}
    </span>
  );
}

/** Inline `x{qty}` prefix for card titles — renders yellow when qty >= 2, hidden otherwise. */
export function InlineQtyPrefix({ quantity, className = '' }: QtyBadgeProps) {
  const qty = parseQty(quantity);
  if (qty < 2) return null;
  return <span className={`text-yellow-500 ${className}`}>x{qty} </span>;
}
