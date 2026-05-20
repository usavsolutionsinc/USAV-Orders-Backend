'use client';

import Link from 'next/link';
import { Suspense } from 'react';
import ReceivingDashboard from '@/components/ReceivingDashboard';
import { ReceivingSidebarPanel } from '@/components/sidebar/ReceivingSidebarPanel';
import { RouteShell } from '@/design-system/components/RouteShell';
import { MobileReceivingList } from '@/components/mobile/receiving/MobileReceivingList';
import { useUIModeOptional } from '@/design-system/providers/UIModeProvider';
import { ChevronRight } from '@/components/Icons';

function ReceivingPageInner() {
  const { isMobile } = useUIModeOptional();

  // Mobile is photo-only — single reversed list of receiving lines, most
  // recent pinned at the bottom in an expanded card with a camera FAB.
  // RouteShell + sidebar form flows are desktop only.
  if (isMobile) {
    return (
      <div className="flex h-full w-full flex-col overflow-hidden bg-white">
        {/* Opt-in entry to the new PO-grouped pipeline. The route is additive
            and stable; flipping MOBILE_RECEIVING_PIPELINE_V2 server-side later
            can promote this from "Try" to default. */}
        <Link
          href="/m/receiving"
          prefetch={false}
          className="flex items-center gap-3 border-b border-gray-100 bg-gradient-to-r from-blue-50 to-white px-4 py-2.5 active:bg-blue-100"
        >
          <span className="grid h-7 w-7 place-items-center rounded-full bg-blue-600 text-[10px] font-black uppercase tracking-widest text-white">
            New
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] font-black tracking-tight text-gray-900">
              Try the PO pipeline view
            </span>
            <span className="block truncate text-[10px] font-bold uppercase tracking-wider text-gray-500">
              Group by purchase order · photo per item
            </span>
          </span>
          <ChevronRight className="h-4 w-4 text-gray-400" />
        </Link>
        <div className="min-h-0 flex-1">
          <MobileReceivingList />
        </div>
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
