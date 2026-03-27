'use client';

import { type ReactNode } from 'react';

/**
 * Simple hover tooltip that appears above its trigger with a downward caret.
 *
 * Usage:
 *   <Tooltip label="Edit Planned Qty">
 *     <button>…</button>
 *   </Tooltip>
 *
 * The wrapper is `relative` so the tooltip positions itself correctly.
 * Use `className` to override the wrapper if needed.
 */
export function Tooltip({
  label,
  children,
  className = '',
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={`group relative inline-flex ${className}`.trim()}>
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover:opacity-100"
      >
        {/* Bubble */}
        <span className="block rounded-md bg-gray-900 px-2.5 py-1.5 text-[11px] font-semibold leading-none text-white shadow-md">
          {label}
        </span>
        {/* Downward caret */}
        <span className="absolute left-1/2 top-full -translate-x-1/2 border-x-4 border-b-0 border-t-4 border-x-transparent border-t-gray-900" />
      </span>
    </span>
  );
}
