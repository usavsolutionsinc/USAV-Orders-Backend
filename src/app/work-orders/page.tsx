'use client';

import { Suspense } from 'react';
import { Loader2 } from '@/components/Icons';
import { WorkOrdersDashboard } from '@/components/work-orders/WorkOrdersDashboard';

function WorkOrdersPageContent() {
  return (
    <div className="flex h-full w-full overflow-hidden">
      <WorkOrdersDashboard />
    </div>
  );
}

export default function WorkOrdersPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full w-full items-center justify-center bg-white">
          <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        </div>
      }
    >
      <WorkOrdersPageContent />
    </Suspense>
  );
}
