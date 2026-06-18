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
import { GlobalHeader } from '@/components/layout/GlobalHeader';
import { GlobalDesktopSkuScanner } from '@/components/layout/GlobalDesktopSkuScanner';
import { usePhoneScanBridge } from '@/hooks/usePhoneScanBridge';
import { useGlobalWedgeScanner } from '@/hooks/useGlobalWedgeScanner';
import { OfflineBanner } from '@/components/layout/OfflineBanner';
import { ReceivingPhoneBridgeMount } from '@/components/mobile/receiving/ReceivingPhoneBridgeMount';

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

  // `/m/*` routes are inherently mobile — the edge proxy only ever serves them
  // to phones. Device detection (useDeviceMode) is client-only, so on a fresh
  // load/refresh it reports `desktop` for the first render(s); without this the
  // page would flash the desktop layout (top header, no bottom nav) and then
  // snap to mobile once detection resolves — a refresh-only layout jump. Treat
  // `/m` paths as mobile deterministically so SSR + first paint match the final
  // layout (no blank gate, no desktop→mobile flip).
  const onMobileRoute = !!pathname && pathname.startsWith('/m');

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

  // Skip the pre-mount blank for `/m` routes — they render the mobile shell
  // deterministically (see `onMobileRoute`), so there's nothing to wait for and
  // the blank would just be an extra refresh flash.
  if (!mounted && !onMobileRoute) {
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
            className="fixed inset-0 z-panelBackdrop bg-black/40 backdrop-blur-[2px]"
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
            className="fixed inset-y-0 left-0 z-panel w-full max-w-xs shadow-2xl"
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
  // `/m` routes always use the mobile shell, even before client detection
  // resolves, so a refresh never flashes the desktop frame.
  if (!isMobile && !onMobileRoute) {
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

  // ── Mobile layout: content only ──
  //
  // Chrome-light: bottom nav lives in /m/layout.tsx (admin-gated). No global
  // overlay FABs — scan is the centre tab; quick access lives in page headers
  // where a route ships its own mobile chrome.
  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      {/* Mirror of desktop: subscribe to phone:{staffId} so any device the
          user is signed in on can service the lookup. */}
      <PhoneScanBridgeMount />
      <ReceivingPhoneBridgeMount />

      {/* Same wedge scanner listener as desktop — works for HID-over-USB on
          tablets and Bluetooth ring scanners paired to a phone. */}
      <GlobalWedgeScannerMount />
      <OfflineBanner />

      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {children}
      </main>
    </div>
  );
}
