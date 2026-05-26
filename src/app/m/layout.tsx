'use client';

/**
 * Layout shared by every /m/* route. Renders the page below a bottom
 * MobileBottomNav on the surfaces that benefit from it — home, scan,
 * history, etc. — and hides the bar on single-purpose camera flows
 * (receiving, picking) and on signin / enrollment.
 *
 * Per-staff toggle: an admin can disable the bottom nav entirely for a
 * given staff member from /admin?section=access. That config lives in
 * AuthContext (mobileDisplayConfig). When disabled, this layout still
 * applies the same path-based hiding so individual flows keep their
 * full viewport.
 *
 * See `shouldShowMobileNav()` for the exact path rules.
 */

import { usePathname } from 'next/navigation';
import { MobileBottomNav, shouldShowMobileNav } from '@/components/mobile/shared/MobileBottomNav';
import { useAuth } from '@/contexts/AuthContext';

export default function MobileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { mobileDisplayConfig } = useAuth();
  const pathAllowsNav = shouldShowMobileNav(pathname);
  const showNav = pathAllowsNav && mobileDisplayConfig.bottomNav.enabled;

  return (
    <div className="flex h-[100dvh] min-h-0 flex-col bg-white">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
        {children}
      </div>
      {showNav && <MobileBottomNav tabs={mobileDisplayConfig.bottomNav.tabs} />}
    </div>
  );
}
