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
        'flex items-start justify-between gap-4 border-b border-border-emphasis/20 py-3 transition-colors duration-150 ease-out',
        interactive ? 'hover:bg-surface-canvas/70' : '',
        className,
      ].join(' ').trim()}
    >
      <div className="min-w-0">
        <p className="text-eyebrow font-black uppercase tracking-[0.10rem] leading-none text-text-soft">
          {label}
        </p>
        <div className="mt-1 text-sm font-bold text-text-default">{value}</div>
        {meta ? <div className="mt-1 text-micro text-text-muted">{meta}</div> : null}
      </div>
      {action}
    </div>
  );
}
