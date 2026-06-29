'use client';

import { SidebarNavOverlaySlider } from '@/components/sidebar/SidebarNavOverlaySlider';
import { OPERATIONS_MODE_ITEMS, type OperationsMode } from '@/components/sidebar/operations/operations-sidebar-shared';

interface OperationsModeToggleProps {
  value: OperationsMode;
  onChange: (next: OperationsMode) => void;
}

/** Top-level Live / Analytics / Insights / History switcher for /operations. */
export function OperationsModeToggle({ value, onChange }: OperationsModeToggleProps) {
  return (
    <SidebarNavOverlaySlider
      items={OPERATIONS_MODE_ITEMS}
      value={value}
      onChange={(id) => onChange(id as OperationsMode)}
      aria-label="Operations mode"
    />
  );
}
