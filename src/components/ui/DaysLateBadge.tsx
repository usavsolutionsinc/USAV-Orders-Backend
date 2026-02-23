'use client';

import { getCurrentPSTDateKey, toPSTDateKey } from '@/lib/timezone';

type DaysLateVariant = 'full' | 'number';

interface DaysLateBadgeProps {
  shipByDate: string | null | undefined;
  fallbackDate?: string | null | undefined;
  variant?: DaysLateVariant;
  className?: string;
}

function toDayIndex(dateKey: string): number {
  const [year, month, day] = dateKey.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

function getDaysLateValue(shipByDate: string | null | undefined, fallbackDate?: string | null | undefined): number {
  const shipByKey = toPSTDateKey(shipByDate) || toPSTDateKey(fallbackDate);
  const todayKey = getCurrentPSTDateKey();
  if (!shipByKey || !todayKey) return 0;

  const delta = toDayIndex(todayKey) - toDayIndex(shipByKey);
  return delta > 0 ? delta : 0;
}

export function DaysLateBadge({
  shipByDate,
  fallbackDate,
  variant = 'full',
  className = '',
}: DaysLateBadgeProps) {
  const daysLate = getDaysLateValue(shipByDate, fallbackDate);

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

