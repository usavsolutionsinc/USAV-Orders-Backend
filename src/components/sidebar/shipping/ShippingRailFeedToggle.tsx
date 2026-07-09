'use client';

/**
 * Shipping rail feed pills (Up Next / Out of Stock) pinned at the top of the
 * scrollable rail — mirrors {@link TestingRailFeedToggle}.
 */

import { HorizontalButtonSlider } from '@/components/ui/HorizontalButtonSlider';
import { AlertCircle, Truck } from '@/components/Icons';
import { sidebarNavOverlayBandClass } from '@/components/layout/header-shell';
import { cn } from '@/utils/_cn';

export type ShippingRailFeed = 'queue' | 'stock';

interface ShippingRailFeedToggleProps {
  value: ShippingRailFeed;
  onChange: (next: ShippingRailFeed) => void;
}

export function ShippingRailFeedToggle({ value, onChange }: ShippingRailFeedToggleProps) {
  return (
    <div className={cn(sidebarNavOverlayBandClass)}>
      <HorizontalButtonSlider
        className="w-full"
        items={[
          { id: 'queue', label: 'Up Next', icon: Truck },
          { id: 'stock', label: 'Out of Stock', icon: AlertCircle },
        ]}
        value={value}
        onChange={(id) => onChange(id as ShippingRailFeed)}
        variant="nav"
        dense
        overlay
        aria-label="Shipping rail feed"
      />
    </div>
  );
}
