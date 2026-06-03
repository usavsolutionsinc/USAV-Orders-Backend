'use client';

import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { SidebarSection } from '@/components/layout/SidebarSection';
import type { SidebarModeItem } from '@/lib/sidebar-navigation';
import { cn } from '@/utils/_cn';

/**
 * L2 icon-only mode switcher (plan §3.4). Uses `HorizontalButtonSlider`
 * `segmented` + `segmentedFlush` inside a 40px `SidebarSection` band so the white
 * track is square and bleeds to the sidebar edges (no rounded inset bubble).
 * Renders nothing for single-surface pages (≤1 mode).
 */
export function ModeRail({
  modes,
  activeModeId,
  onSelect,
  className,
}: {
  modes: SidebarModeItem[];
  activeModeId: string;
  onSelect: (modeId: string) => void;
  className?: string;
}) {
  if (!modes || modes.length <= 1) return null;
  const items: HorizontalSliderItem[] = modes.map((m) => ({ id: m.id, label: m.label, icon: m.icon }));
  return (
    <SidebarSection band className={cn('-mx-1.5 px-0', className)}>
      <HorizontalButtonSlider
        items={items}
        value={activeModeId}
        onChange={onSelect}
        variant="segmented"
        segmentedFlush
        aria-label="Mode"
        className="h-full w-full"
      />
    </SidebarSection>
  );
}
