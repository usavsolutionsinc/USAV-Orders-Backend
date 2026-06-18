'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { usePathname } from 'next/navigation';
import { RedesignedBottomNav } from './RedesignedBottomNav';
import { MobileTopBar } from './MobileTopBar';
import { TOKENS } from './DesignSystem';
import { ReceivingPhoneBridgeMount } from '@/components/mobile/receiving/ReceivingPhoneBridgeMount';

/**
 * Global Mobile Shell for 2026 Redesign
 */

// The primary tab pages share ONE identical header (goal chip + global actions).
// It's rendered once here — outside the route-keyed transition — so it persists
// across tab navigation instead of re-mounting (and re-fetching the goal) per
// page. Detail pages (/m/r/*, /m/orders/*, photos…) ship their own headers, so
// the shared bar is gated to these exact routes.
const HEADER_ROUTES = new Set(['/m/home', '/m/receiving', '/m/scan', '/m/receive', '/m/pick', '/m/pack']);

export const RedesignedMobileShell = ({ children }: { children: React.ReactNode }) => {
  const pathname = usePathname();

  // Paths that should hide the bottom nav (e.g., the sign-in screen).
  //
  // NOTE: on phone-class devices the edge proxy rewrites /signin → /m/signin
  // (see src/proxy.ts MOBILE_UA_REWRITES). A rewrite keeps the *browser* URL as
  // /signin, so usePathname() here reports '/signin', not '/m/signin'. We must
  // list BOTH or the nav leaks onto the sign-in page. (RedesignedBottomNav also
  // returns null when there's no signed-in user, as a belt-and-suspenders gate.)
  const hideNavPaths = [
    '/signin',
    '/m/signin',
  ];

  // Capture flows (any `…/photos` route) are full-screen camera surfaces — hide
  // the bottom nav so it never shows behind/over the camera or the upload list.
  const isCaptureRoute = !!pathname && pathname.endsWith('/photos');
  const showNav = !isCaptureRoute && !hideNavPaths.some(p => pathname?.startsWith(p));
  const showHeader = !!pathname && HEADER_ROUTES.has(pathname);

  return (
    <div className={`flex h-[100dvh] min-h-0 flex-col ${TOKENS.colors.background} font-sans antialiased overflow-hidden`}>
      {/* Shared header — rendered once, persists across tab navigation. */}
      {showHeader && <MobileTopBar />}

      {/* Page Content with Transitions */}
      <main className="relative flex-1 min-h-0 overflow-y-auto overscroll-contain pb-safe">
        <AnimatePresence mode="wait">
          <motion.div
            key={pathname}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{
              duration: 0.15,
              ease: [0.23, 1, 0.32, 1] // Custom ease-out
            }}
            className="h-full"
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Shared Bottom Nav */}
      {showNav && <RedesignedBottomNav />}

      {/* Phone↔desktop receiving bridge (scan → camera, share → sheet). */}
      <ReceivingPhoneBridgeMount />
    </div>
  );
};
