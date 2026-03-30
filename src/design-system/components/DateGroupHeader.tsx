'use client';

export type DateGroupVariant = 'default' | 'blue' | 'emerald' | 'orange' | 'purple';

const variantClasses: Record<DateGroupVariant, { bg: string; border: string }> = {
  default: { bg: 'bg-gray-50/80', border: 'border-gray-300' },
  blue: { bg: 'bg-blue-50/80', border: 'border-blue-200' },
  emerald: { bg: 'bg-emerald-50/80', border: 'border-emerald-200' },
  orange: { bg: 'bg-orange-50/80', border: 'border-orange-200' },
  purple: { bg: 'bg-purple-50/80', border: 'border-purple-200' },
};

export interface DateGroupHeaderProps {
  /** Raw date string — passed to formatDate if provided, otherwise rendered directly */
  date: string;
  /** Number of items in this group */
  count: number;
  /** Optional date formatter — defaults to identity */
  formatDate?: (date: string) => string;
  /** Color variant for tonal background */
  variant?: DateGroupVariant;
  className?: string;
}

/**
 * Sticky date group header for tables and lists.
 * Renders a row with formatted date + count badge.
 *
 * Exposes `data-day-header`, `data-date`, `data-count` attributes
 * for scroll-tracking integration.
 *
 * Uses: typography.sectionLabel pattern, density.compact spacing
 */
export function DateGroupHeader({
  date,
  count,
  formatDate,
  variant = 'default',
  className = '',
}: DateGroupHeaderProps) {
  const v = variantClasses[variant];
  const displayDate = formatDate ? formatDate(date) : date;

  return (
    <div
      data-day-header
      data-date={date}
      data-count={count}
      className={`${v.bg} border-y ${v.border} px-2 py-1 flex items-center justify-between z-10 ${className}`.trim()}
    >
      <p className="text-[11px] font-black text-gray-900 uppercase tracking-widest">
        {displayDate}
      </p>
      <p className="text-[11px] font-black text-gray-700 tabular-nums">
        {count}
      </p>
    </div>
  );
}
