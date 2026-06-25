'use client';

import { useState, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePathname } from 'next/navigation';
import { MobileTopBar } from './MobileTopBar';
import { MobileSidebarDrawer } from './MobileSidebarDrawer';
import { TOKENS } from './DesignSystem';
import { ReceivingPhoneBridgeMount } from '@/components/mobile/receiving/ReceivingPhoneBridgeMount';
import { ErrorBoundary } from '@/components/error/ErrorBoundary';

/**
 * Phone fallback when a page subtree throws. Without this, a render crash bubbles
 * to global-error and blanks the whole app to a WHITE SCREEN with nothing to act
 * on. Here it degrades to a readable, retryable card (house "degrade-not-fail")
 * and `ErrorBoundary` logs the true cause to the console for diagnosis.
 */
function MobilePageError(error: Error, reset: () => void) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="w-full max-w-sm rounded-xl border border-dashed border-rose-200 bg-rose-50 px-4 py-6">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-rose-700">
          This screen hit an error
        </p>
        <p className="mt-2 break-words text-caption font-semibold text-rose-600">
          {error.message || 'Something went wrong rendering this page.'}
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-4 inline-flex h-10 items-center justify-center rounded-xl bg-rose-600 px-5 text-label font-black uppercase tracking-[0.18em] text-white transition-transform active:scale-95"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

/**
 * Global Mobile Shell for 2026 Redesign.
 * Fullscreen photo flows live under `app/m/(immersive)` and do not mount this shell.
 */

const HEADER_ROUTES = new Set(['/m/home', '/m/receiving', '/m/scan', '/m/receive', '/m/pick', '/m/pack']);

export const RedesignedMobileShell = ({ children }: { children: React.ReactNode }) => {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const showHeader = !!pathname && HEADER_ROUTES.has(pathname);

  return (
    <div
      className={`flex h-full min-h-0 flex-col overflow-hidden font-sans antialiased safe-area-padding ${TOKENS.colors.background}`}
    >
      {showHeader && <MobileTopBar onMenu={() => setSidebarOpen(true)} />}

      <main className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <AnimatePresence mode="wait">
          <motion.div
            key={pathname}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{
              duration: 0.15,
              ease: [0.23, 1, 0.32, 1],
            }}
            className="h-full"
          >
            <ErrorBoundary key={pathname} label="mobile-page" fallback={MobilePageError}>
              {children}
            </ErrorBoundary>
          </motion.div>
        </AnimatePresence>
      </main>

      <Suspense fallback={null}>
        <MobileSidebarDrawer open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      </Suspense>

      <ReceivingPhoneBridgeMount />
    </div>
  );
};
