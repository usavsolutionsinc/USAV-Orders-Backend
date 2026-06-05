'use client';

/**
 * Client-side auth context. Hydrates from /api/auth/session on mount, then
 * lets the rest of the app read role + permissions synchronously via
 * useAuth() / <Can perm="...">.
 *
 * This is intentionally cheap to mount even when no session exists — it
 * returns { user: null, isLoaded: true } and the rest of the app just
 * renders public chrome. Pages that REQUIRE a user use requirePermission()
 * in their server component instead.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { usePathname, useRouter } from 'next/navigation';
import {
  DEFAULT_MOBILE_DISPLAY_CONFIG,
  type MobileDisplayConfig,
} from '@/lib/auth/mobile-display-config';

// Mirror of PUBLIC_PATHS in src/proxy.ts. Kept in sync by hand — small and
// stable. Used by the client-side guard below to avoid bouncing the user
// off /signin or the enrollment landing while their session is null.
const CLIENT_PUBLIC_PATHS: ReadonlyArray<RegExp> = [
  /^\/signin(?:$|\/)/,
  /^\/m\/signin(?:$|\/)/,
  /^\/not-authorized(?:$|\/)/,
  /^\/m\/enroll\//,
  /^\/offline(?:$|\/)/,
  // GS1 Digital Link resolver — server-side redirects anon callers to
  // the storefront before any client-side guard runs, but listing the
  // patterns here keeps the contract symmetric with src/proxy.ts.
  /^\/gs1\/resolve(?:$|\/)/,
  /^\/01\/[0-9]+(?:$|\/)/,
  /^\/414\/[0-9]+\/254\/[A-Za-z0-9]+(?:$|\/)/,
];

function isClientPublicPath(pathname: string | null): boolean {
  if (!pathname) return false;
  return CLIENT_PUBLIC_PATHS.some((re) => re.test(pathname));
}

export interface AuthSessionUser {
  staffId: number;
  name: string;
  role: string;
  permissions: string[];
  mobileDisplayConfig?: MobileDisplayConfig;
  session: {
    sid: string;
    deviceKind: 'station' | 'personal' | 'phone';
    deviceLabel: string | null;
    expiresAt: string;
  };
}

export interface AuthContextValue {
  user: AuthSessionUser | null;
  isLoaded: boolean;
  has: (perm: string) => boolean;
  /** Resolved per-staff mobile UI config. Falls back to defaults when no user. */
  mobileDisplayConfig: MobileDisplayConfig;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthCtx = createContext<AuthContextValue>({
  user: null,
  isLoaded: false,
  has: () => false,
  mobileDisplayConfig: DEFAULT_MOBILE_DISPLAY_CONFIG,
  refresh: async () => {},
  signOut: async () => {},
});

interface ProviderProps {
  initial?: AuthSessionUser | null;
  children: React.ReactNode;
}

export function AuthProvider({ initial = null, children }: ProviderProps) {
  const [user, setUser] = useState<AuthSessionUser | null>(initial);
  const [isLoaded, setIsLoaded] = useState<boolean>(initial !== null);
  const router = useRouter();
  const pathname = usePathname();

  const refresh = useCallback(async () => {
    // We have to compute the next state outside the React-render path so
    // that flushSync below can commit it synchronously. The reason:
    // callers do `await refreshAuth(); router.replace('/dashboard');` —
    // a plain setUser() returns before React commits, so the next
    // navigation reads the OLD provider value (`user: null`) and the
    // post-render `mustRedirect` effect bounces back to /signin. This
    // was the "second sign-in loop" the signin page comment warned about.
    let nextUser: AuthSessionUser | null = null;
    try {
      const r = await fetch('/api/auth/session', {
        credentials: 'include',
        cache: 'no-store',
      });
      if (r.ok) {
        const data = (await r.json()) as { user: AuthSessionUser | null };
        nextUser = data.user ?? null;
      }
    } catch {
      nextUser = null;
    }
    // flushSync forces React to commit BEFORE this function resolves, so
    // `await refresh()` is genuinely "AuthContext is up to date now".
    flushSync(() => {
      setUser(nextUser);
      setIsLoaded(true);
    });
  }, []);

  const signOut = useCallback(async () => {
    try {
      await fetch('/api/auth/signout', { method: 'POST', credentials: 'include' });
    } catch {
      // swallow — even if the server call fails, drop the local user
    }
    setUser(null);
    if (typeof window !== 'undefined') {
      window.location.href = '/signin';
    }
  }, []);

  useEffect(() => {
    if (initial === null) {
      void refresh();
    }
  }, [initial, refresh]);

  // Client-side fallback gate. The Next.js proxy at src/proxy.ts is the source
  // of truth, but it can only check for cookie *presence* — a stale cookie
  // that points to a revoked/expired/idle-killed session sails past the proxy.
  // When AuthContext hydrates with user:null on a non-public path, bounce to
  // /signin and preserve the current path as ?next= so we land back here.
  const onPublicPath = isClientPublicPath(pathname);
  const mustRedirect = isLoaded && !user && !onPublicPath;

  useEffect(() => {
    if (!mustRedirect) return;
    const target = pathname || '/';
    router.replace(`/signin?next=${encodeURIComponent(target)}`);
  }, [mustRedirect, pathname, router]);

  const value = useMemo<AuthContextValue>(() => {
    const perms = new Set(user?.permissions ?? []);
    return {
      user,
      isLoaded,
      has: (perm: string) => perms.has(perm),
      mobileDisplayConfig: user?.mobileDisplayConfig ?? DEFAULT_MOBILE_DISPLAY_CONFIG,
      refresh,
      signOut,
    };
  }, [user, isLoaded, refresh, signOut]);

  return (
    <AuthCtx.Provider value={value}>
      {mustRedirect ? <RedirectingSplash /> : children}
    </AuthCtx.Provider>
  );
}

/**
 * Shown for the brief moment between AuthContext resolving user:null and the
 * router.replace() landing on /signin. Without this, the page (and the FAB
 * with its "Sign in" branch) would render for ~1 frame before disappearing.
 */
function RedirectingSplash() {
  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-white">
      <div className="flex flex-col items-center gap-3 text-gray-500">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-200 border-t-gray-700" />
        <p className="text-caption font-bold uppercase tracking-widest">Redirecting to sign-in…</p>
      </div>
    </div>
  );
}

export function useAuth(): AuthContextValue {
  return useContext(AuthCtx);
}
