'use client';

/**
 * Layout shared by every /m/* route. Renders the page below a bottom
 * MobileBottomNav (with the raised centre scan button) on the surfaces
 * that benefit from it — home, scan, history, etc. — and hides the bar
 * on single-purpose camera flows (receiving, picking) and on signin /
 * enrollment.
 *
 * See `shouldShowMobileNav()` for the exact path rules.
 */

import { usePathname } from 'next/navigation';
import { MobileBottomNav, shouldShowMobileNav } from '@/components/mobile/shared/MobileBottomNav';

export default function MobileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const showNav = shouldShowMobileNav(pathname);

  return (
    <div className="flex h-[100dvh] min-h-0 flex-col bg-white">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {children}
      </div>
      {showNav && <MobileBottomNav />}
    </div>
  );
}
