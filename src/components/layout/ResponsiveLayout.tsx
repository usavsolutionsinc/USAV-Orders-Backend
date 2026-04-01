'use client';

import { type ReactNode, useState, useCallback, useEffect, useRef } from 'react';
import { Suspense } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import DashboardSidebar from '@/components/DashboardSidebar';
import { CommandBar } from '@/components/CommandBar';
import { useUIMode } from '@/design-system/providers/UIModeProvider';
import { Menu, X } from '@/components/Icons';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ResponsiveLayoutProps {
  children: ReactNode;
}

// ─── Drawer animation ────────────────────────────────────────────────────────

const backdropVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

const drawerVariants = {
  hidden: { x: '-100%' },
  visible: { x: 0 },
};

const drawerTransition = {
  type: 'spring' as const,
  damping: 28,
  stiffness: 320,
  mass: 0.8,
};

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * ResponsiveLayout — wraps the main app frame.
 *
 * Desktop: permanent sidebar on the left + main content (unchanged).
 * Mobile:  sidebar hidden by default, accessible as a slide-out drawer
 *          from the left. Hamburger button exposed via `useSidebarDrawer`.
 */
export function ResponsiveLayout({ children }: ResponsiveLayoutProps) {
  const { isMobile } = useUIMode();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // Close drawer on route change (user tapped a nav item)
  useEffect(() => {
    if (!isMobile) {
      setDrawerOpen(false);
    }
  }, [isMobile]);

  // Lock body scroll when drawer is open
  useEffect(() => {
    if (drawerOpen) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [drawerOpen]);

  // ── Desktop layout (unchanged) ──
  if (!isMobile) {
    return (
      <div className="flex h-full w-full overflow-hidden">
        <Suspense fallback={null}>
          <DashboardSidebar />
        </Suspense>
        <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden relative">
          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {children}
          </main>
        </div>
        <CommandBar />
      </div>
    );
  }

  // ── Mobile layout: full-width content + drawer sidebar ──
  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      {/* Hamburger trigger — fixed top-left, only shown when no page toolbar overrides it */}
      <button
        type="button"
        onClick={openDrawer}
        aria-label="Open navigation"
        className="fixed top-[max(0.5rem,env(safe-area-inset-top))] left-3 z-40 h-11 w-11 flex items-center justify-center rounded-xl bg-white/90 backdrop-blur-sm shadow-md border border-gray-100 active:scale-95 transition-transform"
      >
        <Menu className="h-5 w-5 text-gray-700" />
      </button>

      {/* Main content — full width */}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {children}
      </main>

      {/* Drawer overlay + sidebar */}
      <AnimatePresence>
        {drawerOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              key="drawer-backdrop"
              variants={backdropVariants}
              initial="hidden"
              animate="visible"
              exit="hidden"
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]"
              onClick={closeDrawer}
              aria-hidden
            />

            {/* Drawer panel */}
            <motion.div
              ref={drawerRef}
              key="drawer-panel"
              variants={drawerVariants}
              initial="hidden"
              animate="visible"
              exit="hidden"
              transition={drawerTransition}
              className="fixed inset-y-0 left-0 z-50 w-full shadow-2xl"
            >
              {/* Close button — sits in the safe-area-inset-top zone */}
              <button
                type="button"
                onClick={closeDrawer}
                aria-label="Close navigation"
                className="absolute top-[max(0.5rem,env(safe-area-inset-top))] right-3 z-10 h-11 w-11 flex items-center justify-center rounded-xl bg-gray-100 text-gray-700 active:scale-95 active:bg-gray-200 transition-transform"
              >
                <X className="h-5 w-5" />
              </button>

              <Suspense fallback={null}>
                <DashboardSidebar inDrawer onNavigate={closeDrawer} />
              </Suspense>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* CommandBar is desktop-only — cmd+k search has no mobile equivalent */}
    </div>
  );
}
