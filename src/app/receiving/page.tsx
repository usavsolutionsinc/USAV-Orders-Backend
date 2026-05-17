'use client';

import { Suspense } from 'react';
import ReceivingDashboard from '@/components/ReceivingDashboard';
import { ReceivingSidebarPanel } from '@/components/sidebar/ReceivingSidebarPanel';
import { RouteShell } from '@/design-system/components/RouteShell';
import { MobileReceivingList } from '@/components/mobile/receiving/MobileReceivingList';
import { useUIModeOptional } from '@/design-system/providers/UIModeProvider';

function ReceivingPageInner() {
  const { isMobile } = useUIModeOptional();

  // Mobile is photo-only — single reversed list of receiving lines, most
  // recent pinned at the bottom in an expanded card with a camera FAB.
  // RouteShell + sidebar form flows are desktop only.
  if (isMobile) {
    return (
      <div className="flex h-full w-full overflow-hidden bg-white">
        <MobileReceivingList />
      </div>
    );
  }

  return (
    <div className="flex h-full w-full overflow-hidden bg-[linear-gradient(180deg,#f5fbfa_0%,#ffffff_22%)]">
      <RouteShell
        actions={<ReceivingSidebarPanel />}
        history={<ReceivingDashboard />}
      />
    </div>
  );
}

export default function ReceivingPage() {
  return (
    <Suspense>
      <ReceivingPageInner />
    </Suspense>
  );
}
