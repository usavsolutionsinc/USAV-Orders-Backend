'use client';

/**
 * Bottom tab bar for the mobile cockpit.
 *
 * Visibility is admin-gated per staff. /m/layout.tsx renders this only when
 * `mobileDisplayConfig.bottomNav.enabled` is true for the signed-in staff
 * (see resolveMobileDisplayConfig). Default seed: the 'technician', 'picker',
 * and 'admin' roles have it on; everyone else is locked to a single page
 * until an admin opts them in from /admin?section=access.
 *
 * The tab set is also per-staff configurable. Available tab IDs:
 *
 *   • home    — back to the /m/home cockpit (recent scans)
 *   • scan    — raised centre: opens `/m/scan`; on that route toggles camera
 *     preview (`/m/scan` vs `/m/scan?cam=off`). Always rendered centre when
 *     present in the list, regardless of its position in the array.
 *   • picks   — picker queue at /m/pick
 *   • signout — exits the session
 *
 * Stations (Receiving / Testing) are reached from tiles on /m/home —
 * they're role-gated and the cockpit is the right place to choose.
 */

import { Suspense, useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  Barcode,
  LayoutDashboard,
  Lock,
  ShoppingCart,
} from '@/components/Icons';
import { useAuth } from '@/contexts/AuthContext';
import type { MobileNavTabId } from '@/lib/auth/mobile-display-config';

const HIDDEN_PREFIXES = [
  '/m/signin',
  '/m/enroll',
  // Single-purpose camera/photo flows — nav bar would compete with the
  // viewfinder for tap targets.
  '/m/receiving',
  '/receiving',
  '/packer',
  '/tech',
  // Single-record contextual detail flows — back-nav owns the chrome.
  '/m/r/',
  '/m/l/',
  '/m/u/',
  '/m/b/',
  '/m/p/',
  '/m/rs/',
  // Picking session itself (one order) — trailing slash so the queue
  // landing at exactly /m/pick stays nav-visible while /m/pick/<id> goes
  // full-screen for scan/confirm.
  '/m/pick/',
];

// Note: `/m/pick` (queue) keeps the nav visible. `/m/pick/<id>` matches
// the trailing-slash prefix above and hides the bar so the picking
// session has the whole viewport for scan-confirm flow.

export function shouldShowMobileNav(pathname: string | null): boolean {
  if (!pathname) return false;
  return !HIDDEN_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p.endsWith('/') ? p : `${p}/`),
  );
}

interface MobileBottomNavProps {
  /** Tab IDs to render in display order. Scan stays centred when present. */
  tabs?: ReadonlyArray<MobileNavTabId>;
}

const DEFAULT_TABS: ReadonlyArray<MobileNavTabId> = ['home', 'scan', 'picks', 'signout'];

function MobileBottomNavInner({ tabs }: { tabs: ReadonlyArray<MobileNavTabId> }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { signOut } = useAuth();
  const scanCamOff = searchParams.get('cam') === 'off';

  const isActive = useCallback(
    (target: string) => pathname === target || pathname?.startsWith(`${target}/`),
    [pathname],
  );

  const handleSignOut = useCallback(async () => {
    try {
      await signOut();
    } catch {
      /* ignore — we still bounce to signin */
    }
    toast.success('Signed out');
    router.replace('/signin');
  }, [signOut, router]);

  // Scan owns the centre slot regardless of order; everything else fills
  // around it. Five-column grid: [left] [left] [scan] [right] [right].
  const nonScan = tabs.filter((t) => t !== 'scan');
  const showScan = tabs.includes('scan');
  const leftTabs = nonScan.slice(0, Math.min(2, Math.ceil(nonScan.length / 2)));
  const rightTabs = nonScan.slice(leftTabs.length, leftTabs.length + 2);

  const renderTab = (id: MobileNavTabId, key: string) => {
    switch (id) {
      case 'home':
        return (
          <NavTab
            key={key}
            label="Home"
            icon={LayoutDashboard}
            active={isActive('/m/home')}
            onClick={() => router.push('/m/home')}
          />
        );
      case 'picks':
        return (
          <NavTab
            key={key}
            label="Picks"
            icon={ShoppingCart}
            active={isActive('/m/pick')}
            onClick={() => router.push('/m/pick')}
          />
        );
      case 'signout':
        return (
          <NavTab
            key={key}
            label="Sign out"
            icon={Lock}
            active={false}
            onClick={handleSignOut}
          />
        );
      default:
        return <span key={key} aria-hidden />;
    }
  };

  // Pad with spacers so the 5-column grid stays aligned even when fewer
  // tabs are configured (e.g. just Home + Scan).
  const leftCells: React.ReactNode[] = [];
  for (let i = 0; i < 2; i++) {
    const id = leftTabs[i];
    leftCells.push(id ? renderTab(id, `l-${i}`) : <span key={`ls-${i}`} aria-hidden />);
  }
  const rightCells: React.ReactNode[] = [];
  for (let i = 0; i < 2; i++) {
    const id = rightTabs[i];
    rightCells.push(id ? renderTab(id, `r-${i}`) : <span key={`rs-${i}`} aria-hidden />);
  }

  return (
    <nav
      role="navigation"
      aria-label="Mobile main navigation"
      className="relative shrink-0 border-t border-gray-200 bg-white pb-[max(0.5rem,env(safe-area-inset-bottom))]"
    >
      <div className="grid grid-cols-5 items-end px-1 pt-1.5">
        {leftCells}

        {/* Raised centre — Scan */}
        {showScan ? (
          <div className="relative flex items-end justify-center">
            <button
              type="button"
              onClick={() => {
                if (pathname === '/m/scan') {
                  router.replace(scanCamOff ? '/m/scan' : '/m/scan?cam=off');
                  return;
                }
                router.push('/m/scan');
              }}
              aria-current={isActive('/m/scan') ? 'page' : undefined}
              aria-label={
                pathname === '/m/scan'
                  ? scanCamOff
                    ? 'Turn camera preview on'
                    : 'Turn camera preview off'
                  : 'Open scanner'
              }
              className={`
                -mt-7 flex h-16 w-16 items-center justify-center rounded-full
                bg-gradient-to-br from-blue-500 to-blue-700 text-white
                shadow-[0_8px_24px_rgba(37,99,235,0.45)] ring-4 ring-white
                transition-transform active:scale-95
                ${isActive('/m/scan') ? 'scale-[1.04]' : ''}
              `.trim()}
            >
              <Barcode className="h-7 w-7" />
            </button>
            <span
              className={`absolute -bottom-0.5 text-eyebrow font-black uppercase tracking-[0.14em] leading-none ${
                isActive('/m/scan') ? 'text-blue-600' : 'text-gray-500'
              }`}
            >
              Scan
            </span>
          </div>
        ) : (
          <span aria-hidden />
        )}

        {rightCells}
      </div>
    </nav>
  );
}

/** Bottom nav reads `cam=off` on `/m/scan` to toggle preview — suspense for `useSearchParams`. */
export function MobileBottomNav({ tabs = DEFAULT_TABS }: MobileBottomNavProps = {}) {
  return (
    <Suspense
      fallback={(
        <nav
          className="relative shrink-0 border-t border-gray-200 bg-white pb-[max(0.5rem,env(safe-area-inset-bottom))]"
          aria-label="Mobile main navigation"
          aria-hidden
        >
          <div className="h-[4.75rem]" />
        </nav>
      )}
    >
      <MobileBottomNavInner tabs={tabs} />
    </Suspense>
  );
}

interface NavTabProps {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  onClick: () => void;
}

function NavTab({ label, icon: Icon, active, onClick }: NavTabProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`
        relative flex flex-col items-center gap-0.5 py-1.5 rounded-xl transition-colors duration-100
        ${active ? 'text-blue-600' : 'text-gray-400 active:text-gray-600'}
      `.trim()}
    >
      {active && (
        <span className="absolute -top-0.5 h-[3px] w-5 rounded-full bg-blue-600" />
      )}
      <span className="flex h-6 w-6 items-center justify-center">
        <Icon className="h-5 w-5" />
      </span>
      <span className={`text-eyebrow font-black uppercase tracking-[0.12em] leading-none ${active ? 'text-blue-600' : 'text-gray-400'}`}>
        {label}
      </span>
    </button>
  );
}
