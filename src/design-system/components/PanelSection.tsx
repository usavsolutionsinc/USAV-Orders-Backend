'use client';

import type { ReactNode } from 'react';

export interface PanelSectionProps {
  /** Section title (e.g. “Shipping Information”, “Pipeline”). */
  title?: ReactNode;
  /** Right side of the title row (e.g. Copy all button). */
  headerRight?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Extra classes on the inner `space-y-0` row stack. */
  bodyClassName?: string;
}

/**
 * Groups stacked `DetailsPanelRow` blocks with the standard panel heading rhythm
 * (see shipped details + FBA sidebar).
 */
export function PanelSection({ title, headerRight, children, className = '', bodyClassName = '' }: PanelSectionProps) {
  const showHeader = title != null || headerRight != null;

  return (
    <div className={`space-y-3 ${className}`.trim()}>
      {showHeader ? (
        <div className="flex items-center justify-between gap-2">
          {title != null ? (
            typeof title === 'string' ? (
              <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gray-900">{title}</h3>
            ) : (
              <div className="min-w-0">{title}</div>
            )
          ) : (
            <span />
          )}
          {headerRight}
        </div>
      ) : null}
      <div className={`space-y-0 ${bodyClassName}`.trim()}>{children}</div>
    </div>
  );
}
