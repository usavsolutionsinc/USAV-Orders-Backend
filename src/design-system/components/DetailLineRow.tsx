'use client';

import type { ReactNode } from 'react';

interface DetailLineRowProps {
  label: ReactNode;
  headerAccessory?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  dividerClassName?: string;
  interactive?: boolean;
}

export function DetailLineRow({
  label,
  headerAccessory,
  actions,
  children,
  className = '',
  contentClassName = '',
  dividerClassName = 'border-b border-gray-300/20',
  interactive = true,
}: DetailLineRowProps) {
  return (
    <div
      className={[
        dividerClassName,
        'py-3 transition-colors duration-150 ease-out',
        interactive ? 'hover:bg-slate-50/70' : '',
        className,
      ].join(' ').trim()}
    >
      <div className="mb-1 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[9px] font-black uppercase tracking-[0.10rem] leading-none text-gray-500">
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
