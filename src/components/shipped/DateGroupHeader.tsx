'use client';

interface DateGroupHeaderProps {
  date: string;
  total: number;
  formatDate: (date: string) => string;
}

export function DateGroupHeader({ date, total, formatDate }: DateGroupHeaderProps) {
  return (
    <div
      data-day-header
      data-date={date}
      data-count={total}
      className="bg-gray-50/80 border-y border-gray-100 px-2 py-1 flex items-center justify-between z-10"
    >
      <p className="text-[11px] font-black text-gray-900 uppercase tracking-widest">{formatDate(date)}</p>
      <p className="text-[11px] font-black text-gray-400 uppercase">Total: {total}</p>
    </div>
  );
}

