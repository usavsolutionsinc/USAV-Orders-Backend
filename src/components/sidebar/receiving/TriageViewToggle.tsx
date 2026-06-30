'use client';

/**
 * Triage sub-view pills (Triage / Prioritize / Unfound) pinned above the rail.
 * Mirrors {@link UnboxViewToggle}. URL-backed via `triview` (handled by
 * {@link useReceivingMode}).
 */

import { HorizontalButtonSlider } from '@/components/ui/HorizontalButtonSlider';
import { AlertTriangle, Flag, Layers } from '@/components/Icons';
import { sidebarNavOverlayBandClass } from '@/components/layout/header-shell';
import { cn } from '@/utils/_cn';
import type { TriageView } from '@/components/sidebar/receiving/TriageSidebarBody';

const TABS = [
  { id: 'triage', label: 'Triage', icon: Layers },
  { id: 'found', label: 'Prioritize', icon: Flag },
  { id: 'unfound', label: 'Unfound', icon: AlertTriangle },
] as const;

interface TriageViewToggleProps {
  value: TriageView;
  onChange: (next: TriageView) => void;
}

export function TriageViewToggle({ value, onChange }: TriageViewToggleProps) {
  return (
    <div className={cn(sidebarNavOverlayBandClass)}>
      <HorizontalButtonSlider
        className="w-full"
        items={[...TABS]}
        value={value}
        onChange={(id) => onChange(id as TriageView)}
        variant="nav"
        dense
        overlay
        aria-label="Triage view"
      />
    </div>
  );
}
