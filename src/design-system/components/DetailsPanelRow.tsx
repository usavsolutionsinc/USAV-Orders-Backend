'use client';

import { PanelRow, type PanelRowProps } from '../primitives';

export interface DetailsPanelRowProps extends Omit<PanelRowProps, 'interactive'> {}

/**
 * Ledger row for sidebars and details panels: uppercase label row, optional accessory + actions, then value body.
 * Default divider matches shipped / FBA panel stacks (`border-border-hairline`).
 */
export function DetailsPanelRow({
  label,
  headerAccessory,
  actions,
  children,
  className = '',
  contentClassName = '',
  dividerClassName = 'border-b border-border-hairline',
}: DetailsPanelRowProps) {
  return (
    <PanelRow
      label={label}
      headerAccessory={headerAccessory}
      actions={actions}
      className={className}
      contentClassName={contentClassName}
      dividerClassName={dividerClassName}
      interactive
    >
      {children}
    </PanelRow>
  );
}
