'use client';

import type { ReactNode } from 'react';

export function MetricLineRow({
  label,
  value,
  meta,
  action,
  className = '',
  interactive = true,
}: {
  label: ReactNode;
  value: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
  className?: string;
  interactive?: boolean;
}) {
  return (
    <div
      className={[
        'flex items-start justify-between gap-4 border-b border-gray-400/20 py-3 transition-colors duration-150 ease-out',
        interactive ? 'hover:bg-gray-50/70' : '',
        className,
      ].join(' ').trim()}
    >
      <div className="min-w-0">
        <p className="text-[9px] font-black uppercase tracking-[0.10rem] leading-none text-gray-500">
          {label}
        </p>
        <div className="mt-1 text-[13px] font-bold text-gray-900">{value}</div>
        {meta ? <div className="mt-1 text-[10px] text-gray-600">{meta}</div> : null}
      </div>
      {action}
    </div>
  );
}
