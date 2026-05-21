'use client';

import { Suspense, useCallback } from 'react';
import ReceivingDashboard from '@/components/ReceivingDashboard';
import { ReceivingSidebarPanel } from '@/components/sidebar/ReceivingSidebarPanel';
import { RouteShell } from '@/design-system/components/RouteShell';
import { MobileReceivingList } from '@/components/mobile/receiving/MobileReceivingList';
import { Menu } from '@/components/Icons';
import { QuickAccessButton } from '@/components/layout/QuickAccessButton';

// Mobile vs desktop selection is done with CSS visibility, not a JS branch.
// That way old browsers that can't hydrate the app (iOS ≤13, older Android)
// still render the correct view from the SSR HTML. Both subtrees mount; the
// inactive one is display:none and its data-fetching components still run,
// which is the accepted tradeoff for hydration-independent layout.
function ReceivingPageInner() {
  const openDrawer = useCallback(() => {
    window.dispatchEvent(new CustomEvent('open-mobile-drawer'));
  }, []);

  return (
    <>
      {/* Mobile (<768px) — photo-only feed with camera FAB. */}
      <div className="flex h-full w-full flex-col overflow-hidden bg-white md:hidden">
        <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-gray-100 bg-white px-3">
          <button
            type="button"
            onClick={openDrawer}
            aria-label="Open navigation"
            className="flex h-11 w-11 items-center justify-center rounded-xl text-gray-700 active:bg-gray-100 transition-colors outline-none"
          >
            <Menu className="h-6 w-6" />
          </button>
          
          <h1 className="flex-1 text-[17px] font-black tracking-tight text-gray-900">
            Receiving
          </h1>

          <QuickAccessButton className="h-10 w-10" />
        </header>

        <div className="min-h-0 flex-1">
          <MobileReceivingList />
        </div>
      </div>

      {/* Desktop (≥768px) — sidebar + form flows. */}
      <div className="hidden h-full w-full overflow-hidden bg-[linear-gradient(180deg,#f5fbfa_0%,#ffffff_22%)] md:flex">
        <RouteShell
          actions={<ReceivingSidebarPanel />}
          history={<ReceivingDashboard />}
        />
      </div>
    </>
  );
}

export default function ReceivingPage() {
  return (
    <Suspense>
      <ReceivingPageInner />
    </Suspense>
  );
}
