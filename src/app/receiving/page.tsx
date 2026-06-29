'use client';

import { Suspense, useCallback } from 'react';
import ReceivingDashboard from '@/components/ReceivingDashboard';
import { ReceivingSidebarPanel } from '@/components/sidebar/ReceivingSidebarPanel';
import { RouteShell } from '@/design-system/components/RouteShell';
import { MobileReceivingList } from '@/components/mobile/receiving/MobileReceivingList';
import { MobileReceivingViewPills } from '@/components/mobile/receiving/MobileReceivingViewPills';
import { Menu } from '@/components/Icons';
import { IconButton } from '@/design-system/primitives';
import { QuickAccessButton } from '@/components/layout/QuickAccessButton';
import { ZohoSplitPane } from '@/components/receiving/workspace/ZohoSplitPane';

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
        <header className="sticky top-0 z-header flex min-h-14 items-center gap-3 border-b border-gray-100 bg-white px-3 pt-[env(safe-area-inset-top)]">
          <IconButton
            type="button"
            onClick={openDrawer}
            ariaLabel="Open navigation"
            icon={<Menu className="h-6 w-6" />}
            className="flex h-11 w-11 items-center justify-center rounded-xl text-gray-700 active:bg-gray-100 outline-none"
          />
          
          <h1 className="flex-1 text-lg font-black tracking-tight text-gray-900">
            Receiving
          </h1>

          <QuickAccessButton className="h-10 w-10" />
        </header>

        <div className="relative min-h-0 flex-1">
          {/* Floating overlay above the list — pills sit on top, list scrolls behind. */}
          <div className="pointer-events-none absolute top-0 left-0 right-0 z-30 px-3 pt-2 pb-3">
            <div className="pointer-events-auto">
              <MobileReceivingViewPills active="lines" />
            </div>
          </div>

          <MobileReceivingList limit={20} />
        </div>
      </div>

      {/* Desktop (≥768px) — sidebar + form flows. */}
      <div className="hidden h-full w-full overflow-hidden bg-[linear-gradient(180deg,#f5fbfa_0%,#ffffff_22%)] md:flex">
        <RouteShell
          actions={<ReceivingSidebarPanel />}
          history={<ReceivingDashboard />}
        />
      </div>

      {/* Electron-only: right-side Zoho viewer triggered by the per-line
          "Open in Zoho" action. Hidden until activated; no-op in a browser. */}
      <ZohoSplitPane />
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
