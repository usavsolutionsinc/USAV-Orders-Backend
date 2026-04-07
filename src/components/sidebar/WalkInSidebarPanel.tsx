'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { SidebarTabSwitchChrome, TabSwitch } from '@/components/ui/TabSwitch';
import { RepairSidebarPanel } from './RepairSidebarPanel';
import { SalesSidebarPanel } from './SalesSidebarPanel';

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
      {/* Top-level mode switcher */}
      <div className="shrink-0">
        <SidebarTabSwitchChrome>
          <TabSwitch
            tabs={[
              { id: 'repairs', label: 'Repairs', color: 'orange' },
              { id: 'sales', label: 'Sales', color: 'green' },
            ]}
            activeTab={mode}
            highContrast
            onTabChange={handleModeChange}
          />
        </SidebarTabSwitchChrome>
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
