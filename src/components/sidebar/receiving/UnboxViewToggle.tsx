'use client';

/**
 * Unbox sub-view pills (Unboxed / Queue / Viewed) pinned at the top of the rail.
 * Mirrors the triage Found/Unfound toggle. URL-backed via `unboxview` (handled
 * by the parent's useReceivingMode). Extracted from ReceivingSidebarPanel.
 */

import { HorizontalButtonSlider } from '@/components/ui/HorizontalButtonSlider';
import { PackageOpen, History, Layers } from '@/components/Icons';
import { SIDEBAR_GUTTER } from '@/components/layout/header-shell';
import { cn } from '@/utils/_cn';
import type { UnboxView } from '@/components/sidebar/receiving/useReceivingMode';

interface UnboxViewToggleProps {
  value: UnboxView;
  onChange: (next: UnboxView) => void;
}

export function UnboxViewToggle({ value, onChange }: UnboxViewToggleProps) {
  return (
    <div
      className={cn(
        'sticky top-0 z-10 flex h-[40px] shrink-0 items-center overflow-visible bg-white/90 backdrop-blur',
        SIDEBAR_GUTTER,
      )}
    >
      <HorizontalButtonSlider
        className="w-full"
        items={[
          { id: 'recent', label: 'Unboxed', icon: PackageOpen },
          { id: 'queue', label: 'Queue', icon: Layers },
          { id: 'viewed', label: 'Viewed', icon: History },
        ]}
        value={value}
        onChange={(id) => onChange(id as UnboxView)}
        variant="nav"
        dense
        aria-label="Unbox queue view"
      />
    </div>
  );
}
