'use client';

import type { ReactNode } from 'react';

export function MetricLineRow({
  label,
  value,
  meta,
  action,
  className = '',
}: {
  label: ReactNode;
  value: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-start justify-between gap-4 border-b border-[var(--color-neutral-200)] py-3 ${className}`.trim()}>
      <div className="min-w-0">
        <p className="text-[var(--text-xs)] font-semibold uppercase tracking-[0.18em] text-[var(--color-neutral-700)]">
          {label}
        </p>
        <div className="mt-1 text-[var(--text-sm)] font-semibold text-[var(--color-neutral-900)]">{value}</div>
        {meta ? <div className="mt-1 text-[var(--text-xs)] text-[var(--color-neutral-700)]">{meta}</div> : null}
      </div>
      {action}
    </div>
  );
}
