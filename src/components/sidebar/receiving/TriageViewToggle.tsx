'use client';

/**
 * Triage sub-view pills (Triage / Prioritize / Unfound) pinned above the rail.
 * Mirrors {@link UnboxViewToggle}. URL-backed via `triview` (handled by
 * {@link useReceivingMode}).
 */

import { HorizontalButtonSlider } from '@/components/ui/HorizontalButtonSlider';
import { AlertTriangle, Check, Flag, Layers } from '@/components/Icons';
import { sidebarNavOverlayBandClass } from '@/components/layout/header-shell';
import { StaffFilterButton } from '@/components/ui/StaffFilterButton';
import { cn } from '@/utils/_cn';
import type { TriageView } from '@/components/sidebar/receiving/TriageSidebarBody';

const TABS = [
  { id: 'triage', label: 'Triage', icon: Layers },
  { id: 'found', label: 'Prioritize', icon: Flag },
  { id: 'unfound', label: 'Unfound', icon: AlertTriangle },
  { id: 'done', label: 'Done', icon: Check },
] as const;

interface TriageViewToggleProps {
  value: TriageView;
  onChange: (next: TriageView) => void;
}

export function TriageViewToggle({ value, onChange }: TriageViewToggleProps) {
  return (
    <div className={cn(sidebarNavOverlayBandClass, 'gap-1.5')}>
      <HorizontalButtonSlider
        className="min-w-0 flex-1"
        items={[...TABS]}
        value={value}
        onChange={(id) => onChange(id as TriageView)}
        variant="nav"
        dense
        overlay
        aria-label="Triage view"
      />
      {/* Shared `?staff=` picker (P1-WORK-02) — the triage feeds already read it. */}
      <StaffFilterButton iconOnly align="end" />
    </div>
  );
}
