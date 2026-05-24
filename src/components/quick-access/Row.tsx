'use client';

import type { ReactNode } from 'react';

interface RowProps {
  icon: ReactNode;
  iconBg?: string;
  label: string;
  subLabel?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  active?: boolean;
  ariaCurrent?: boolean;
}

/**
 * Shared row used by Actions, Pinned, and Recent sections. Compact 2026
 * styling: 32×32 icon container, two lines of text, optional trailing slot.
 */
export function Row({ icon, iconBg = 'bg-gray-900', label, subLabel, trailing, onClick, active, ariaCurrent }: RowProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.();
        }
      }}
      aria-current={ariaCurrent ? 'page' : undefined}
      className={`group flex w-full cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
        active ? 'bg-blue-50' : 'hover:bg-gray-50 active:bg-gray-100'
      }`}
    >
      <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-white ${iconBg}`}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-sm font-semibold ${active ? 'text-blue-700' : 'text-gray-900'}`}>
          {label}
        </span>
        {subLabel && (
          <span className="block truncate text-caption font-medium text-gray-500">{subLabel}</span>
        )}
      </span>
      {trailing && <span className="ml-2 flex-shrink-0">{trailing}</span>}
    </div>
  );
}

export default Row;
