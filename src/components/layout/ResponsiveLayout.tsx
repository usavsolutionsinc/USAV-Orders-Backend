'use client';

import { type ReactNode, useState, useCallback, useEffect, useRef } from 'react';
import { Suspense } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { usePathname, useRouter } from 'next/navigation';
import DashboardSidebar from '@/components/DashboardSidebar';
import { CommandBar } from '@/components/CommandBar';
import { useUIMode } from '@/design-system/providers/UIModeProvider';
import { X } from '@/components/Icons';
import { getSidebarRouteKey, isSidebarRouteMobileRestricted, APP_SIDEBAR_NAV } from '@/lib/sidebar-navigation';
import { MobileDefaultTopBanner } from '@/components/mobile/shared/MobileDefaultTopBanner';
import { PhonePairFab } from '@/components/layout/PhonePairFab';
import { PhonePairModal } from '@/components/sidebar/PhonePairModal';
import { MobileScanFab } from '@/components/mobile/shared/MobileScanFab';

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

// ─── Mobile nav helpers ─────────────────────────────────────────────────────

/** Routes that render their own mobile top bar — skip the default banner. */
const SELF_NAV_PREFIXES = ['/tech', '/packer', '/sku-stock'];

function hasSelfNav(pathname: string | null): boolean {
  if (!pathname) return false;
  return SELF_NAV_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function getMobileTitle(pathname: string | null): string {
  const key = getSidebarRouteKey(pathname);
  const nav = APP_SIDEBAR_NAV.find((item) => item.id === key);
  return nav?.label || 'USAV';
}

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
  const pathname = usePathname();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  // Global floating hamburger removed — each page provides its own back arrow via `open-mobile-drawer` event.
  const routeKey = getSidebarRouteKey(pathname);
  const mobileRouteRestricted = isMobile && isSidebarRouteMobileRestricted(routeKey);

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Allow any component to open the mobile drawer via a global event
  useEffect(() => {
    const handler = () => setDrawerOpen(true);
    window.addEventListener('open-mobile-drawer', handler);
    return () => window.removeEventListener('open-mobile-drawer', handler);
  }, []);

  // Close drawer when the route changes (e.g. user picked a page in the drawer)
  useEffect(() => {
    if (!isMobile) return;
    setDrawerOpen(false);
  }, [pathname, isMobile]);

  useEffect(() => {
    if (!mobileRouteRestricted) return;
    router.replace('/dashboard');
  }, [mobileRouteRestricted, router]);

  // Lock body scroll when drawer is open
  useEffect(() => {
    if (drawerOpen) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [drawerOpen]);

  if (!mounted) {
    return <div className="flex h-full w-full bg-white" aria-hidden="true" />;
  }

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
        <PhonePairFab />
        <PhonePairModal />
      </div>
    );
  }

  if (mobileRouteRestricted) {
    return <div className="flex h-full w-full bg-white" aria-hidden="true" />;
  }

  // ── Mobile layout: full-width content + drawer sidebar ──
  const showDefaultBanner = !hasSelfNav(pathname);

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      {/* Default top banner for pages without their own */}
      {showDefaultBanner && (
        <MobileDefaultTopBanner
          title={getMobileTitle(pathname)}
          onBack={openDrawer}
        />
      )}

      {/* Main content — full width */}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {children}
      </main>

      {/* Drawer overlay + sidebar — same `DashboardSidebar inDrawer` as dashboard hamburger (also opened via `open-mobile-drawer` on tech/packer). */}
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

      {/* Global mobile scan FAB — opens route-specific sheet on tech / packer /
          sku-stock (via a window event), or the generic pair + PO sheet
          everywhere else. */}
      <MobileScanFab />
    </div>
  );
}
