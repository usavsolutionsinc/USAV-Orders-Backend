'use client';

import { DashboardShippedTable } from '@/components/shipped/DashboardShippedTable';

/**
 * Mobile shipped queue — thin shell over {@link DashboardShippedTable} with `embedded`
 * so it is not double-wrapped (no extra MobileShell + padding). Week strip matches {@link WeekHeader} primitives.
 */
export function MobileShippedDashboard({ testedBy }: { testedBy?: number }) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-white">
      <DashboardShippedTable testedBy={testedBy} embedded />
    </div>
  );
}
