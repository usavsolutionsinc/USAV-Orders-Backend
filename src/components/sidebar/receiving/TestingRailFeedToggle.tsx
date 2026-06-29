'use client';

/**
 * Testing rail feed pills (Recent / To Test) pinned at the top of the scrollable
 * rail — mirrors the Unbox Unboxed/Queue/Viewed toggle. Recent is first and the
 * default; To Test shows the needs-test queue.
 */

import { HorizontalButtonSlider } from '@/components/ui/HorizontalButtonSlider';
import { ClipboardList, History } from '@/components/Icons';
import { sidebarNavOverlayBandClass } from '@/components/layout/header-shell';
import { cn } from '@/utils/_cn';

export type TestingRailFeed = 'queue' | 'tested';

interface TestingRailFeedToggleProps {
  value: TestingRailFeed;
  onChange: (next: TestingRailFeed) => void;
}

export function TestingRailFeedToggle({ value, onChange }: TestingRailFeedToggleProps) {
  return (
    <div className={cn(sidebarNavOverlayBandClass)}>
      <HorizontalButtonSlider
        className="w-full"
        items={[
          { id: 'tested', label: 'Recent', icon: History },
          { id: 'queue', label: 'To Test', icon: ClipboardList },
        ]}
        value={value}
        onChange={(id) => onChange(id as TestingRailFeed)}
        variant="nav"
        dense
        overlay
        aria-label="Testing rail feed"
      />
    </div>
  );
}
