'use client';

import { Suspense } from 'react';
import { RouteShell } from '@/design-system/components/RouteShell';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { OutboundSidebarPanel } from '@/components/sidebar/OutboundSidebarPanel';
import { OutboundWorkspace } from '@/components/outbound/OutboundWorkspace';
import { useRealtimeInvalidation } from '@/hooks/useRealtimeInvalidation';

function OutboundPageContent() {
  useRealtimeInvalidation({ dashboard: true });

  return (
    <div className="hidden h-full w-full overflow-hidden bg-surface-card md:flex">
      <RouteShell
        actions={<OutboundSidebarPanel />}
        history={<OutboundWorkspace />}
      />
    </div>
  );
}

export default function OutboundPage() {
  return (
    <Suspense
      fallback={(
        <div className="flex h-full w-full items-center justify-center bg-surface-card">
          <LoadingSpinner size="lg" className="text-violet-600" />
        </div>
      )}
    >
      <OutboundPageContent />
    </Suspense>
  );
}
