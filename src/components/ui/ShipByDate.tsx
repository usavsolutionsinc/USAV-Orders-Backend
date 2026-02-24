import { Calendar } from '../Icons';
import { formatShortDate } from '@/utils/date';

interface ShipByDateProps {
  date: string | null | undefined;
  className?: string;
  showPrefix?: boolean;
}

export function ShipByDate({ date, className = '', showPrefix = true }: ShipByDateProps) {
  if (!date) return null;
  
  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <Calendar className="w-3 h-3 text-blue-600" />
      <span className="text-[9px] font-bold text-blue-700">
        {showPrefix ? `Ship By: ${formatShortDate(date)}` : formatShortDate(date)}
      </span>
    </div>
  );
}
