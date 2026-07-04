'use client';

import type { ReactNode } from 'react';

export interface PanelRowProps {
  label: ReactNode;
  headerAccessory?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  dividerClassName?: string;
  interactive?: boolean;
}

export function PanelRow({
  label,
  headerAccessory,
  actions,
  children,
  className = '',
  contentClassName = '',
  dividerClassName = 'border-b border-border-default/20',
  interactive = true,
}: PanelRowProps) {
  return (
    <div
      className={[
        dividerClassName,
        'py-3 transition-colors duration-150 ease-out',
        interactive ? 'hover:bg-surface-canvas/70' : '',
        className,
      ].join(' ').trim()}
    >
      <div className="mb-1 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-eyebrow font-black uppercase tracking-[0.10rem] leading-none text-text-soft">
            {label}
          </span>
          {headerAccessory}
        </div>
        {actions}
      </div>
      <div className={contentClassName}>{children}</div>
    </div>
  );
}
