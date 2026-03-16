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
  dividerClassName = 'border-b border-red-100',
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
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
        <p className={`whitespace-pre-wrap break-words text-sm font-medium leading-5 text-gray-800 ${valueClassName}`.trim()}>
          {value || 'N/A'}
        </p>
      </div>
    </DetailLineRow>
  );
}
