'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { sidebarHeaderPillRowClass } from '@/components/layout/header-shell';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { DollarSign, Tool } from '@/components/Icons';
import { RepairSidebarPanel } from './RepairSidebarPanel';
import { SalesSidebarPanel } from './SalesSidebarPanel';

const WALK_IN_MODE_ITEMS: HorizontalSliderItem[] = [
  { id: 'repairs', label: 'Repairs', icon: Tool },
  { id: 'sales',   label: 'Sales',   icon: DollarSign },
];

interface WalkInSidebarPanelProps {
  embedded?: boolean;
  hideSectionHeader?: boolean;
}

type WalkInMode = 'repairs' | 'sales';

export function WalkInSidebarPanel({ embedded = false, hideSectionHeader = false }: WalkInSidebarPanelProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const mode: WalkInMode = searchParams.get('mode') === 'sales' ? 'sales' : 'repairs';

  const handleModeChange = (newMode: string) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    if (newMode === 'repairs') {
      nextParams.delete('mode');
    } else {
      nextParams.set('mode', newMode);
    }
    // Clear sub-tabs when switching modes
    nextParams.delete('tab');
    nextParams.delete('search');
    const nextSearch = nextParams.toString();
    router.replace(nextSearch ? `${pathname}?${nextSearch}` : pathname || '/walk-in');
  };

  const content = (
    <div className="flex h-full flex-col overflow-hidden bg-white">
      {/* Mode pills (2nd row) */}
      <div className={sidebarHeaderPillRowClass}>
        <HorizontalButtonSlider
          items={WALK_IN_MODE_ITEMS}
          value={mode}
          onChange={handleModeChange}
          variant="nav"
          dense
          className="w-full"
          aria-label="Walk-in mode"
        />
      </div>

      {/* Mode content */}
      <div className="flex-1 overflow-hidden">
        {mode === 'repairs' ? (
          <RepairSidebarPanel embedded hideSectionHeader />
        ) : (
          <SalesSidebarPanel embedded hideSectionHeader />
        )}
      </div>
    </div>
  );

  if (embedded) {
    return <div className="h-full overflow-hidden bg-white">{content}</div>;
  }

  return (
    <aside className="h-full overflow-hidden border-r border-gray-200 bg-white">{content}</aside>
  );
}
