'use client';

import { useSearchParams } from 'next/navigation';
import { RepairSidebarPanel } from './RepairSidebarPanel';
import { SalesSidebarPanel } from './SalesSidebarPanel';

interface WalkInSidebarPanelProps {
  embedded?: boolean;
  hideSectionHeader?: boolean;
}

type WalkInMode = 'repairs' | 'sales';

export function WalkInSidebarPanel({ embedded = false, hideSectionHeader = false }: WalkInSidebarPanelProps) {
  const searchParams = useSearchParams();

  // Repairs ↔ Sales is now switched from the master-nav mode rail (?mode=sales),
  // so this panel just renders the surface the rail selected — no in-panel pill row.
  const mode: WalkInMode = searchParams.get('mode') === 'sales' ? 'sales' : 'repairs';

  const content = (
    <div className="flex h-full flex-col overflow-hidden bg-white">
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
