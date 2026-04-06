'use client';

import { getDaysLateNumber } from '@/utils/date';

type DaysLateVariant = 'full' | 'number';

interface DaysLateBadgeProps {
  shipByDate: string | null | undefined;
  fallbackDate?: string | null | undefined;
  variant?: DaysLateVariant;
  className?: string;
}

export function DaysLateBadge({
  shipByDate,
  fallbackDate,
  variant = 'full',
  className = '',
}: DaysLateBadgeProps) {
  const daysLate = getDaysLateNumber(shipByDate, fallbackDate);

  const tone =
    daysLate > 1
      ? 'bg-red-100 text-red-800 border-red-200'
      : daysLate === 1
        ? 'bg-yellow-100 text-yellow-800 border-yellow-200'
        : 'bg-emerald-100 text-emerald-800 border-emerald-200';

  const content = variant === 'number' ? String(daysLate) : `Days Late:${daysLate}`;

  return (
    <span
      className={[
        'inline-flex h-8 items-center justify-center rounded-lg border px-2.5 text-[10px] font-black uppercase tracking-wider whitespace-nowrap',
        tone,
        className,
      ].join(' ')}
      title={`Days late: ${daysLate}`}
      aria-label={`Days late: ${daysLate}`}
    >
      {content}
    </span>
  );
}
