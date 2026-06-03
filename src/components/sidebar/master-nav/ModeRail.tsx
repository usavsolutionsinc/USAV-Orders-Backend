'use client';

import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { SidebarSection } from '@/components/layout/SidebarSection';
import type { SidebarModeItem } from '@/lib/sidebar-navigation';

/**
 * L2 icon-only mode switcher (plan §3.4). Renders exactly like the dashboard
 * order-view switcher: the shared `HorizontalButtonSlider` `segmented` variant
 * inside a 40px `SidebarSection band`. The segmented control IS the rounded,
 * outlined "bubble" (recessed grey track, `ring-1` outline, `p-1` padding,
 * `h-8` tabs) — the whole row fits the 40px band, no extra wrapper height.
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
    <SidebarSection band className={className}>
      <HorizontalButtonSlider
        items={items}
        value={activeModeId}
        onChange={onSelect}
        variant="segmented"
        aria-label="Mode"
        className="w-full"
      />
    </SidebarSection>
  );
}
