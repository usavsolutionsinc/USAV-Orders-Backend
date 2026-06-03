'use client';

import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import type { SidebarModeItem } from '@/lib/sidebar-navigation';
import { cn } from '@/utils/_cn';

/**
 * L2 icon-only mode switcher (plan §3.4). Wraps the shared
 * `HorizontalButtonSlider` `segmented` variant (its sliding `layoutId` pill is
 * per-instance, so multiple rails coexist). The grey strip is a FLUSH, full-bleed
 * fill — square corners, top hairline only — never a rounded bubble. Renders
 * nothing for single-surface pages (≤1 mode).
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
    <div
      className={cn(
        'flex items-center gap-1 border-t border-border-soft bg-surface-canvas px-2 py-1.5',
        className,
      )}
    >
      <HorizontalButtonSlider
        items={items}
        value={activeModeId}
        onChange={onSelect}
        variant="segmented"
        aria-label="Mode"
        className="w-full"
      />
    </div>
  );
}
