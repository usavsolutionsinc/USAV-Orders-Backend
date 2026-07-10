'use client';

/**
 * Unbox sub-view pills (Unboxed / Queue / Viewed) pinned at the top of the rail.
 * Mirrors the triage Found/Unfound toggle. URL-backed via `unboxview` (handled
 * by the parent's useReceivingMode). Extracted from ReceivingSidebarPanel.
 */

import { HorizontalButtonSlider } from '@/components/ui/HorizontalButtonSlider';
import { PackageOpen, History, Layers } from '@/components/Icons';
import { sidebarNavOverlayBandClass } from '@/components/layout/header-shell';
import { StaffFilterButton } from '@/components/ui/StaffFilterButton';
import { cn } from '@/utils/_cn';
import type { UnboxView } from '@/components/sidebar/receiving/useReceivingMode';

interface UnboxViewToggleProps {
  value: UnboxView;
  onChange: (next: UnboxView) => void;
}

export function UnboxViewToggle({ value, onChange }: UnboxViewToggleProps) {
  return (
    <div className={cn(sidebarNavOverlayBandClass, 'gap-1.5')}>
      <HorizontalButtonSlider
        className="min-w-0 flex-1"
        items={[
          { id: 'recent', label: 'Unboxed', icon: PackageOpen },
          { id: 'queue', label: 'Queue', icon: Layers },
          { id: 'viewed', label: 'Viewed', icon: History },
        ]}
        value={value}
        onChange={(id) => onChange(id as UnboxView)}
        variant="nav"
        dense
        overlay
        aria-label="Unbox queue view"
      />
      {/* Shared `?staff=` picker (P1-WORK-02) — Unboxed + Queue feeds read it. */}
      <StaffFilterButton iconOnly align="end" />
    </div>
  );
}
