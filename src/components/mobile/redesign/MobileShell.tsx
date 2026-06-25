'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePathname } from 'next/navigation';
import { MobileTopBar } from './MobileTopBar';
import { MobileSidebarDrawer } from './MobileSidebarDrawer';
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
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Navigation now lives in the left slide-over drawer, opened from the menu
  // button in the shared MobileTopBar. The bar (and thus the menu button) only
  // renders on the primary header routes below, so capture flows (`…/photos`
  // full-screen camera surfaces) and the sign-in screen never get the toggle.
  const showHeader = !!pathname && HEADER_ROUTES.has(pathname);

  return (
    <div className={`flex h-[100dvh] min-h-0 flex-col ${TOKENS.colors.background} font-sans antialiased overflow-hidden`}>
      {/* Shared header — rendered once, persists across tab navigation. The
          menu button opens the left navigation drawer. */}
      {showHeader && <MobileTopBar onMenu={() => setSidebarOpen(true)} />}

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

      {/* Left navigation drawer (replaces the old fixed bottom nav). */}
      <MobileSidebarDrawer open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Phone↔desktop receiving bridge (scan → camera, share → sheet). */}
      <ReceivingPhoneBridgeMount />
    </div>
  );
};
