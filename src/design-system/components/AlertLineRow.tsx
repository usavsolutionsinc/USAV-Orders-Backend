'use client';

import type { ReactNode } from 'react';
import { AlertTriangle } from '@/components/Icons';
import { DetailLineRow } from './DetailLineRow';

interface AlertLineRowProps {
  label?: string;
  value: string;
  actions?: ReactNode;
  headerAccessory?: ReactNode;
  className?: string;
  dividerClassName?: string;
  valueClassName?: string;
}

export function AlertLineRow({
  label = 'Out of Stock',
  value,
  actions,
  headerAccessory,
  className = '',
  dividerClassName = 'border-b border-red-400/25',
  valueClassName = '',
}: AlertLineRowProps) {
  return (
    <DetailLineRow
      label={label}
      headerAccessory={headerAccessory}
      actions={actions}
      className={className}
      dividerClassName={dividerClassName}
    >
      <div className="flex items-start gap-1.5">
        <AlertTriangle className="mt-[2px] h-[14px] w-[14px] shrink-0 text-red-500" />
        <p
          className={`whitespace-pre-wrap break-words border-b-2 border-red-500/70 pb-0.5 text-[13px] font-bold leading-[1.35] text-gray-900 ${valueClassName}`.trim()}
        >
          {value || 'N/A'}
        </p>
      </div>
    </DetailLineRow>
  );
}
