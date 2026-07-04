'use client';

import type { ReactNode } from 'react';

interface AdminPickerRowProps {
  selected: boolean;
  onPick: () => void;
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
}

export function AdminPickerRow({
  selected,
  onPick,
  leading,
  title,
  subtitle,
  trailing,
}: AdminPickerRowProps) {
  return (
    // ds-raw-button
    <button
      type="button"
      onClick={onPick}
      aria-current={selected ? 'true' : undefined}
      className={`group flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-all ${
        selected
          ? 'border-blue-200 bg-blue-50 ring-1 ring-blue-500/30 shadow-sm shadow-blue-200/40'
          : 'border-border-soft bg-surface-card hover:border-border-default hover:bg-surface-hover'
      }`}
    >
      {leading ? <div className="flex-shrink-0">{leading}</div> : null}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-text-default">{title}</div>
        {subtitle ? (
          <div className="truncate text-micro font-medium uppercase tracking-wider text-text-soft">
            {subtitle}
          </div>
        ) : null}
      </div>
      {trailing ? <div className="flex-shrink-0">{trailing}</div> : null}
    </button>
  );
}
