'use client';

import { WorkOrdersDashboard } from '@/components/work-orders/WorkOrdersDashboard';

export default function WorkOrdersPage() {
  return (
    <div className="flex h-full w-full overflow-hidden">
      <WorkOrdersDashboard />
    </div>
  );
}
