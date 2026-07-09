'use client';

import { SidebarNavOverlaySlider } from '@/components/sidebar/SidebarNavOverlaySlider';
import { SUPPORT_MODE_ITEMS, type SupportMode } from '@/components/sidebar/support/support-sidebar-shared';

interface SupportModeToggleProps {
  value: SupportMode;
  onChange: (next: SupportMode) => void;
}

/** Top-level Tickets / Voicemail / Calls switcher for /support. */
export function SupportModeToggle({ value, onChange }: SupportModeToggleProps) {
  return (
    <SidebarNavOverlaySlider
      items={SUPPORT_MODE_ITEMS}
      value={value}
      onChange={(id) => onChange(id as SupportMode)}
      aria-label="Support mode"
    />
  );
}
