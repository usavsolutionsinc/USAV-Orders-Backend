'use client';

import { type ReactNode, useState, useCallback, useEffect, useRef } from 'react';
import { Suspense } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { usePathname, useRouter } from 'next/navigation';
import DashboardSidebar from '@/components/DashboardSidebar';
import { CommandBar } from '@/components/CommandBar';
import { useUIMode } from '@/design-system/providers/UIModeProvider';
import { X } from '@/components/Icons';
import { getSidebarRouteKey, isMobileAllowedPath } from '@/lib/sidebar-navigation';
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
  const drawerRef = useRef<HTMLDivElement>(null);
  // Global floating hamburger removed — each page provides its own back arrow via `open-mobile-drawer` event.
  const routeKey = getSidebarRouteKey(pathname);
  // Mobile devices may only reach a narrow allowlist of routes (see
  // isMobileAllowedPath() in sidebar-navigation.ts). Any other path on a
  // phone bounces to /m/home — the scan-first cockpit — so the device
  // stays focused on the warehouse-floor jobs it was issued for.
  const mobileRouteRestricted = isMobile && !isMobileAllowedPath(pathname);

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

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

  useEffect(() => {
    if (!mobileRouteRestricted) return;
    router.replace('/m/home');
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

  // Drawer overlay is rendered regardless of which branch is active so pages
  // that ship their own mobile UI (e.g. /receiving uses `md:hidden`) can still
  // open the side nav at narrow viewports — useUIMode can return `desktop`
  // when device detection misses and we'd otherwise leave the drawer
  // unmounted. CSS-hides on real desktop widths.
  // On /operations the desktop sidebar is hidden and the drawer is the only
  // way into the app nav, so the overlay must render at every viewport (not
  // md:hidden). Elsewhere it stays mobile-only.
  const drawerVisibleOnDesktop = routeKey === 'operations';
  const drawerOverlay = (
    <AnimatePresence>
      {drawerOpen && (
        <div className={drawerVisibleOnDesktop ? '' : 'md:hidden'}>
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
    const hideDesktopSidebar = routeKey === 'operations';
    return (
      <div className="flex h-full w-full overflow-hidden">
        <GlobalWedgeScannerMount />
        <PhoneScanBridgeMount />
        <OfflineBanner />
        {!hideDesktopSidebar && (
          <Suspense fallback={null}>
            <DashboardSidebar />
          </Suspense>
        )}
        <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden relative">
          <GlobalHeader />
          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {children}
          </main>
        </div>
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
