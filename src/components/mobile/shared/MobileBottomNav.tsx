'use client';

/**
 * Bottom tab bar for the mobile cockpit.
 *
 * The mobile device is locked to a tight allowlist (see
 * `isMobileAllowedPath` in `sidebar-navigation.ts`) — receiving, packing,
 * testing, picks, and the scan-first /m/home cockpit. Almost everything
 * else redirects to /m/home. So the nav surfaces only what's genuinely
 * navigable from anywhere:
 *
 *   • Home     — back to the cockpit
 *   • Scan     — raised centre button, opens /m/scan (the headline action)
 *   • Picks    — picker queue at /m/pick
 *   • Sign out — exits the session
 *
 * Stations (Receiving / Testing) are reached from tiles on /m/home —
 * they're role-gated and the cockpit is the right place to choose.
 */

import { useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Barcode,
  LayoutDashboard,
  Lock,
  ShoppingCart,
} from '@/components/Icons';
import { useAuth } from '@/contexts/AuthContext';

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

export function MobileBottomNav() {
  const router = useRouter();
  const pathname = usePathname();
  const { signOut } = useAuth();

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

  return (
    <nav
      role="navigation"
      aria-label="Mobile main navigation"
      className="relative shrink-0 border-t border-gray-200 bg-white pb-[max(0.5rem,env(safe-area-inset-bottom))]"
    >
      <div className="grid grid-cols-5 items-end px-1 pt-1.5">
        {/* Home */}
        <NavTab
          label="Home"
          icon={LayoutDashboard}
          active={isActive('/m/home')}
          onClick={() => router.push('/m/home')}
        />

        {/* Spacer (keeps the centre tab visually isolated from Home) */}
        <span aria-hidden />

        {/* Raised centre — Scan */}
        <div className="relative flex items-end justify-center">
          <button
            type="button"
            onClick={() => router.push('/m/scan')}
            aria-current={isActive('/m/scan') ? 'page' : undefined}
            aria-label="Open scanner"
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

        {/* Picks — bottom-right of nav per request. Sits next to Sign out. */}
        <NavTab
          label="Picks"
          icon={ShoppingCart}
          active={isActive('/m/pick')}
          onClick={() => router.push('/m/pick')}
        />

        {/* Sign out */}
        <NavTab
          label="Sign out"
          icon={Lock}
          active={false}
          onClick={handleSignOut}
        />
      </div>
    </nav>
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
