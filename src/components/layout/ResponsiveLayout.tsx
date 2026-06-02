'use client';

import { type ReactNode, useState, useCallback, useEffect, useRef } from 'react';
import { Suspense } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { usePathname, useRouter } from 'next/navigation';
import DashboardSidebar from '@/components/DashboardSidebar';
import { CommandBar } from '@/components/CommandBar';
import { useUIMode } from '@/design-system/providers/UIModeProvider';
import { useBodyScrollLock } from '@/design-system/hooks';
import { X } from '@/components/Icons';
import { isMobileAllowedPath } from '@/lib/sidebar-navigation';
import { QuickAccessFab } from '@/components/layout/QuickAccessFab';
import { GlobalHeader } from '@/components/layout/GlobalHeader';
import { GlobalDesktopSkuScanner } from '@/components/layout/GlobalDesktopSkuScanner';
import { MobileScanFab } from '@/components/mobile/shared/MobileScanFab';
import { usePhoneScanBridge } from '@/hooks/usePhoneScanBridge';
import { useGlobalWedgeScanner } from '@/hooks/useGlobalWedgeScanner';
import { OfflineBanner } from '@/components/layout/OfflineBanner';

/**
 * Mount-only component. Subscribes to phone-originated scans on
 * `phone:{staffId}` for the signed-in user and echoes lookups back on
 * `station:{staffId}`. Runs on both desktop and mobile so either side can
 * service a scan from the other.
 */
function PhoneScanBridgeMount() {
  usePhoneScanBridge();
  return null;
}

/**
 * Mount-only component. Listens for HID wedge / Bluetooth ring-scanner
 * keystrokes anywhere in the app. URL-shaped scans navigate; bare codes
 * fire a `wedge-scan` CustomEvent for page-level handlers.
 */
function GlobalWedgeScannerMount() {
  useGlobalWedgeScanner();
  return null;
}

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
  const pathname = usePathname();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Desktop-only: collapse the permanent left sidebar via the global header's
  // top-left toggle so the main content can run full-width.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // Desktop-only: while collapsed, resting the pointer at the far-left edge for
  // ~2s re-opens the sidebar (it stays open until toggled again). `edgeArming`
  // drives the progress sliver that fills over the dwell as a "about to open" cue.
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [edgeArming, setEdgeArming] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  // Mobile devices may only reach a narrow allowlist of routes (see
  // isMobileAllowedPath() in sidebar-navigation.ts). Any other path on a
  // phone bounces to /m/home — the scan-first cockpit — so the device
  // stays focused on the warehouse-floor jobs it was issued for.
  const mobileRouteRestricted = isMobile && !isMobileAllowedPath(pathname);

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // Arm / cancel the 2-second left-edge dwell that re-opens the collapsed sidebar.
  const armSidebarPeek = useCallback(() => {
    if (peekTimer.current) clearTimeout(peekTimer.current);
    setEdgeArming(true);
    peekTimer.current = setTimeout(() => {
      setSidebarCollapsed(false);
      setEdgeArming(false);
    }, 2000);
  }, []);
  const cancelSidebarPeek = useCallback(() => {
    if (peekTimer.current) {
      clearTimeout(peekTimer.current);
      peekTimer.current = null;
    }
    setEdgeArming(false);
  }, []);

  // Pages that ship their own mobile header + quick-access trigger. We must
  // suppress the global `MobileAppHeader` and `QuickAccessFab` on these so the
  // operator doesn't see two stacked top bars and two FABs.
  //
  // Note: phone UAs that hit `/receiving` get edge-rewritten to `/m/receiving`,
  // but the browser URL stays `/receiving` — so `usePathname()` reports
  // `/receiving` on first land. The `isMobile`-gated arms below catch those
  // pre-rewrite URLs.
  const isMobileReceivingPage =
    (pathname?.startsWith('/m/receiving') ?? false) ||
    (isMobile && (pathname === '/receiving' || pathname === '/receiving/'));
  const isMobilePackerPage =
    isMobile && (pathname === '/packer' || pathname === '/packer/');
  const hideFabPage = isMobileReceivingPage || isMobilePackerPage;
  /** Quick access is embedded in {@link MobileAppHeader} on the mobile hub. */
  const isMobileCockpitHub =
    pathname === '/m/home' || pathname === '/m/home/';

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

  // Clear any pending left-edge dwell timer on unmount.
  useEffect(
    () => () => {
      if (peekTimer.current) clearTimeout(peekTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!mobileRouteRestricted) return;
    router.replace('/m/home');
  }, [mobileRouteRestricted, router]);

  // Lock body scroll when drawer is open (restores prior overflow on close).
  useBodyScrollLock(drawerOpen);

  if (!mounted) {
    return <div className="flex h-full w-full bg-white" aria-hidden="true" />;
  }

  // Drawer overlay is rendered regardless of which branch is active so pages
  // that ship their own mobile UI (e.g. /receiving uses `md:hidden`) can still
  // open the side nav at narrow viewports — useUIMode can return `desktop`
  // when device detection misses and we'd otherwise leave the drawer
  // unmounted. CSS-hides on real desktop widths — every desktop route now has
  // the permanent (collapsible) sidebar, so the drawer is mobile-only.
  const drawerOverlay = (
    <AnimatePresence>
      {drawerOpen && (
        <div className="md:hidden">
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
          <motion.div
            ref={drawerRef}
            key="drawer-panel"
            variants={drawerVariants}
            initial="hidden"
            animate="visible"
            exit="hidden"
            transition={drawerTransition}
            className="fixed inset-y-0 left-0 z-50 w-full max-w-xs shadow-2xl"
          >
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
        </div>
      )}
    </AnimatePresence>
  );

  // ── Desktop layout ──
  if (!isMobile) {
    return (
      <div className="flex h-full w-full overflow-hidden">
        <GlobalWedgeScannerMount />
        <PhoneScanBridgeMount />
        <OfflineBanner />
        {!sidebarCollapsed && (
          <Suspense fallback={null}>
            <DashboardSidebar />
          </Suspense>
        )}
        <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden relative">
          <GlobalHeader
            canCollapseSidebar
            sidebarCollapsed={sidebarCollapsed}
            onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
          />
          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {children}
          </main>
        </div>

        {/* Left-edge reveal — only when the sidebar is collapsed. Rest the
            pointer against the far-left edge for ~2s and the sidebar re-opens
            (and stays open until toggled again). */}
        {sidebarCollapsed && (
          <div
            className="fixed bottom-0 left-0 top-10 z-40 w-6"
            onMouseEnter={armSidebarPeek}
            onMouseLeave={cancelSidebarPeek}
            aria-hidden
          >
            <AnimatePresence>
              {edgeArming && (
                <motion.div
                  key="edge-arming"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="absolute inset-y-0 left-0 w-1 overflow-hidden rounded-r-full bg-gray-300/60"
                >
                  {/* Fills top→bottom over the 2s dwell — a progress cue that the
                      sidebar is about to open. */}
                  <motion.div
                    initial={{ scaleY: 0 }}
                    animate={{ scaleY: 1 }}
                    transition={{ duration: 2, ease: 'linear' }}
                    style={{ transformOrigin: 'top' }}
                    className="h-full w-full bg-blue-500"
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        <CommandBar />
        <Suspense fallback={null}>
          <GlobalDesktopSkuScanner />
        </Suspense>
        {drawerOverlay}
      </div>
    );
  }

  if (mobileRouteRestricted) {
    return <div className="flex h-full w-full bg-white" aria-hidden="true" />;
  }

  // ── Mobile layout: bottom nav + FAB only ──
  //
  // The drawer sidebar and top app header were removed in 2026-05-25 — mobile
  // is now intentionally chrome-light. Navigation lives in the bottom nav
  // (rendered by /m/layout.tsx, admin-gated per staff via mobileDisplayConfig)
  // plus the QuickAccess FAB. Stations are reached via the cockpit at /m/home
  // which surfaces recently-scanned items.
  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      {/* Mirror of desktop: subscribe to phone:{staffId} so any device the
          user is signed in on can service the lookup. */}
      <PhoneScanBridgeMount />

      {/* Same wedge scanner listener as desktop — works for HID-over-USB on
          tablets and Bluetooth ring scanners paired to a phone. */}
      <GlobalWedgeScannerMount />
      <OfflineBanner />

      {/* Main content — full width */}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {children}
      </main>

      {/* Global FAB — hide on specific pages where it conflicts with custom UI */}
      {!hideFabPage && !isMobileCockpitHub && <QuickAccessFab />}

      {/* Scan FAB — mobile entry into the scanner from any non-/m/* surface.
          Self-hides on /m/* (own nav bar with raised scan button) and on
          /packer / /receiving (single-purpose camera flows). */}
      {!hideFabPage && <MobileScanFab />}
    </div>
  );
}
