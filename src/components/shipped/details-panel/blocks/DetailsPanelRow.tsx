'use client';

import type { ReactNode } from 'react';
import { DetailLineRow } from '@/design-system/components';

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
    <DetailLineRow
      label={label}
      headerAccessory={headerAccessory}
      actions={actions}
      className={className}
      contentClassName={contentClassName}
      dividerClassName={dividerClassName}
    >
      {children}
    </DetailLineRow>
  );
}
