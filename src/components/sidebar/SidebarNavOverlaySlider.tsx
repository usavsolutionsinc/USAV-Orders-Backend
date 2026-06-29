'use client';

import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { sidebarNavOverlayBandClass } from '@/components/layout/header-shell';
import { cn } from '@/utils/_cn';

interface SidebarNavOverlaySliderProps {
  items: HorizontalSliderItem[];
  value: string;
  onChange: (id: string) => void;
  'aria-label': string;
  className?: string;
}

/**
 * Sticky nav pills over a scrolling sidebar body — pairs
 * `sidebarNavOverlayBandClass` with `HorizontalButtonSlider overlay` so active
 * pill shadows aren't clipped (same contract as UnboxViewToggle).
 */
export function SidebarNavOverlaySlider({
  items,
  value,
  onChange,
  'aria-label': ariaLabel,
  className,
}: SidebarNavOverlaySliderProps) {
  return (
    <div className={cn(sidebarNavOverlayBandClass, className)}>
      <HorizontalButtonSlider
        className="w-full"
        items={items}
        value={value}
        onChange={onChange}
        variant="nav"
        dense
        overlay
        aria-label={ariaLabel}
      />
    </div>
  );
}
