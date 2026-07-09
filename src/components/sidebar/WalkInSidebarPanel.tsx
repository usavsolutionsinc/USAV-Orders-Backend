'use client';

import { useSearchParams } from 'next/navigation';
import { RepairSidebarPanel } from './RepairSidebarPanel';
import { SalesCartSidebar } from '@/components/walk-in/SalesCartSidebar';

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
    <div className="flex h-full flex-col overflow-hidden bg-surface-card">
      <div className="flex-1 overflow-hidden">
        {mode === 'repairs' ? (
          <RepairSidebarPanel embedded hideSectionHeader />
        ) : (
          <SalesCartSidebar />
        )}
      </div>
    </div>
  );

  if (embedded) {
    return <div className="h-full overflow-hidden bg-surface-card">{content}</div>;
  }

  return (
    <aside className="h-full overflow-hidden border-r border-border-soft bg-surface-card">{content}</aside>
  );
}
