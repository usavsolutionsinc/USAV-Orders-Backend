'use client';

import type { ReactNode } from 'react';

interface RowProps {
  icon?: ReactNode;
  label: string;
  subLabel?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  active?: boolean;
  ariaCurrent?: boolean;
}

/**
 * Shared quick-access row — flat, icon-paired, design-system anatomy.
 * Selection is background + ring only; no decorative icon circles.
 */
export function Row({
  icon,
  label,
  subLabel,
  trailing,
  onClick,
  active,
  ariaCurrent,
}: RowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={ariaCurrent ? 'page' : undefined}
      className={`group flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
        active
          ? 'bg-blue-50 ring-1 ring-inset ring-blue-400'
          : 'hover:bg-surface-hover active:bg-surface-sunken'
      }`}
    >
      {icon ? (
        <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center text-text-muted">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span
          className={`block truncate text-caption font-bold ${
            active ? 'text-blue-700' : 'text-text-default'
          }`}
        >
          {label}
        </span>
        {subLabel ? (
          <span className="block truncate text-eyebrow font-semibold uppercase tracking-widest text-text-soft">
            {subLabel}
          </span>
        ) : null}
      </span>
      {trailing ? <span className="ml-1 flex-shrink-0">{trailing}</span> : null}
    </button>
  );
}
