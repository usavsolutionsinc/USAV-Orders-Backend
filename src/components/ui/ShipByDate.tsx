import type { ComponentType } from 'react';
import { Calendar } from '../Icons';
import { formatDatePST, formatShortDate } from '@/utils/date';

interface ShipByDateProps {
  date: string | null | undefined;
  className?: string;
  showPrefix?: boolean;
  showYear?: boolean;
  icon?: ComponentType<{ className?: string }>;
  iconClassName?: string;
  textClassName?: string;
}

export function ShipByDate({
  date,
  className = '',
  showPrefix = true,
  showYear = true,
  icon: Icon = Calendar,
  iconClassName = 'w-3 h-3 text-blue-600',
  textClassName = 'text-[9px] font-bold text-blue-700',
}: ShipByDateProps) {
  if (!date) return null;

  const formattedDate = showYear
    ? formatShortDate(date)
    : formatDatePST(date, { withLeadingZeros: true }).replace(/\/\d{4}$/, '');
  
  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <Icon className={iconClassName} />
      <span className={textClassName}>
        {showPrefix ? `Ship By: ${formattedDate}` : formattedDate}
      </span>
    </div>
  );
}
