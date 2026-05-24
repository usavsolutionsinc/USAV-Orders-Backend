'use client';

import { useCallback } from 'react';
import { Menu } from '@/components/Icons';
import { QuickAccessButton } from '@/components/layout/QuickAccessButton';
import { MobileReceivingList } from '@/components/mobile/receiving/MobileReceivingList';
import { MobileReceivingViewPills } from '@/components/mobile/receiving/MobileReceivingViewPills';

// Default landing for mobile receiving. The edge proxy rewrites `/receiving`
// to `/m/receiving` for phone UAs, so this is what users see when they tap
// "Receiving" from the drawer — the Live feed by default. The History/search
// surface lives at `/m/receiving/history`.
export default function MobileReceivingLivePage() {
  const openDrawer = useCallback(() => {
    window.dispatchEvent(new CustomEvent('open-mobile-drawer'));
  }, []);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-white">
      <header className="sticky top-0 z-40 flex min-h-14 items-center gap-3 border-b border-gray-100 bg-white px-3 pt-[env(safe-area-inset-top)]">
        <button
          type="button"
          onClick={openDrawer}
          aria-label="Open navigation"
          className="flex h-11 w-11 items-center justify-center rounded-xl text-gray-700 active:bg-gray-100 transition-colors outline-none"
        >
          <Menu className="h-6 w-6" />
        </button>

        <h1 className="flex-1 text-lg font-black tracking-tight text-gray-900">
          Receiving
        </h1>

        <QuickAccessButton className="h-10 w-10" />
      </header>

      <div className="relative min-h-0 flex-1">
        <div className="pointer-events-none absolute top-0 left-0 right-0 z-30 px-3 pt-2 pb-3">
          <div className="pointer-events-auto">
            <MobileReceivingViewPills active="lines" />
          </div>
        </div>

        <MobileReceivingList />
      </div>
    </div>
  );
}
