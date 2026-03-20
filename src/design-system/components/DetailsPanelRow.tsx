'use client';

import type { ReactNode } from 'react';
import { DetailLineRow } from './DetailLineRow';

export interface DetailsPanelRowProps {
  label: ReactNode;
  headerAccessory?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  dividerClassName?: string;
}

/**
 * Ledger row for sidebars and details panels: uppercase label row, optional accessory + actions, then value body.
 * Default divider matches shipped / FBA panel stacks (`border-gray-100`).
 */
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
