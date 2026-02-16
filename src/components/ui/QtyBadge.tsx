'use client';

interface QtyBadgeProps {
  quantity?: string | number | null;
  className?: string;
}

export function QtyBadge({ quantity, className = '' }: QtyBadgeProps) {
  const parsed = parseInt(String(quantity ?? '1'), 10);
  const qty = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  const isMulti = qty > 1;

  return (
    <span
      className={[
        'px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider border',
        isMulti
          ? 'bg-yellow-300 text-yellow-900 border-yellow-400'
          : 'bg-gray-100 text-gray-600 border-gray-200',
        className
      ].join(' ')}
    >
      qty:{qty}
    </span>
  );
}
