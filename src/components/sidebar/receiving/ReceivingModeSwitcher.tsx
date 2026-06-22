'use client';

/**
 * Top mode-switcher pills (Incoming · Receiving · Unbox · Local Pickup ·
 * History) for the receiving sidebar. Hidden when the master-nav dropdown is
 * enabled (it owns mode switching there). Extracted from ReceivingSidebarPanel.
 */

import { HorizontalButtonSlider } from '@/components/ui/HorizontalButtonSlider';
import { sidebarHeaderPillRowClass } from '@/components/layout/header-shell';
import {
  RECEIVING_MODE_ITEMS,
  type ReceivingMode,
} from '@/components/sidebar/receiving/receiving-sidebar-shared';

interface ReceivingModeSwitcherProps {
  mode: ReceivingMode;
  onChange: (next: ReceivingMode) => void;
}

export function ReceivingModeSwitcher({ mode, onChange }: ReceivingModeSwitcherProps) {
  return (
    <div className={sidebarHeaderPillRowClass}>
      <HorizontalButtonSlider
        items={RECEIVING_MODE_ITEMS}
        value={mode}
        onChange={(next) => onChange(next as ReceivingMode)}
        variant="segmented"
        className="w-full"
        aria-label="Receiving mode"
      />
    </div>
  );
}
