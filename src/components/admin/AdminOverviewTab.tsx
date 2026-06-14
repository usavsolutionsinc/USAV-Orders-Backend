'use client';

import { GoalsCard } from './overview/cards/GoalsCard';
import { StaffCard } from './overview/cards/StaffCard';
import { ConnectionsCard } from './overview/cards/ConnectionsCard';
import { RecentAuditCard } from './overview/cards/RecentAuditCard';

export function AdminOverviewTab() {
  return (
    <div className="h-full overflow-auto bg-slate-50 p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="space-y-1">
          <h1 className="sr-only">Overview</h1>
          <p className="text-sm text-slate-600">
            A glanceable snapshot of system health and the most common admin actions. Each card links to its full section.
          </p>
        </header>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          <GoalsCard />
          <StaffCard />
          <ConnectionsCard />
          <RecentAuditCard />
        </div>
      </div>
    </div>
  );
}
