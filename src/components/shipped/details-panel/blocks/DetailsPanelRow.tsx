'use client';

import type { ReactNode } from 'react';

interface DetailsPanelRowProps {
  label: ReactNode;
  headerAccessory?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  dividerClassName?: string;
}

export function DetailsPanelRow({
  label,
  headerAccessory,
  actions,
  children,
  className = '',
  contentClassName = '',
  dividerClassName = 'border-b border-gray-100',
}: DetailsPanelRowProps) {
  return (
    <div className={`${dividerClassName} py-3 ${className}`.trim()}>
      <div className="mb-1 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">{label}</span>
          {headerAccessory}
        </div>
        {actions}
      </div>
      <div className={contentClassName}>{children}</div>
    </div>
  );
}
