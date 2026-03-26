'use client';

import { PanelRow, type PanelRowProps } from '../primitives';

export interface DetailLineRowProps extends PanelRowProps {}

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
    <PanelRow
      label={label}
      headerAccessory={headerAccessory}
      actions={actions}
      className={className}
      contentClassName={contentClassName}
      dividerClassName={dividerClassName}
      interactive={interactive}
    >
      {children}
    </PanelRow>
  );
}
