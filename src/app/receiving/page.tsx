'use client';

import { Suspense } from 'react';
import ReceivingDashboard from '@/components/ReceivingDashboard';
import { ReceivingSidebarPanel } from '@/components/sidebar/ReceivingSidebarPanel';
import { RouteShell } from '@/design-system/components/RouteShell';

export default function ReceivingPage() {
  return (
    <Suspense>
      <div className="flex h-full w-full overflow-hidden bg-[linear-gradient(180deg,#f5fbfa_0%,#ffffff_22%)]">
        <RouteShell
          actions={<ReceivingSidebarPanel />}
          history={<ReceivingDashboard />}
        />
      </div>
    </Suspense>
  );
}
