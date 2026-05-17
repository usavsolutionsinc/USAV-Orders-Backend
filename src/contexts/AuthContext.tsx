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
import { usePathname, useRouter } from 'next/navigation';

// Mirror of PUBLIC_PATHS in src/proxy.ts. Kept in sync by hand — small and
// stable. Used by the client-side guard below to avoid bouncing the user
// off /signin or the enrollment landing while their session is null.
const CLIENT_PUBLIC_PATHS: ReadonlyArray<RegExp> = [
  /^\/signin(?:$|\/)/,
  /^\/not-authorized(?:$|\/)/,
  /^\/m\/enroll\//,
  /^\/offline(?:$|\/)/,
];

function isClientPublicPath(pathname: string | null): boolean {
  if (!pathname) return false;
  return CLIENT_PUBLIC_PATHS.some((re) => re.test(pathname));
}

export interface AuthSessionUser {
  staffId: number;
  role: string;
  permissions: string[];
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
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthCtx = createContext<AuthContextValue>({
  user: null,
  isLoaded: false,
  has: () => false,
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
    try {
      const r = await fetch('/api/auth/session', {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!r.ok) {
        setUser(null);
      } else {
        const data = (await r.json()) as { user: AuthSessionUser | null };
        setUser(data.user ?? null);
      }
    } catch {
      setUser(null);
    } finally {
      setIsLoaded(true);
    }
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

  // Phase F: one-shot wipe of legacy localStorage keys that used to store
  // per-page staff identity. Cookie is the source of truth now. Safe to
  // remove this block once the rollout has soaked and most clients have
  // hydrated at least once.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const legacyKeys = [
      'last-tech-station-href',
      'last-packer-station-href',
      'fba-staff-id',
    ];
    for (const key of legacyKeys) {
      try { window.localStorage.removeItem(key); } catch { /* ignore */ }
    }
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const perms = new Set(user?.permissions ?? []);
    return {
      user,
      isLoaded,
      has: (perm: string) => perms.has(perm),
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
        <p className="text-[11px] font-bold uppercase tracking-widest">Redirecting to sign-in…</p>
      </div>
    </div>
  );
}

export function useAuth(): AuthContextValue {
  return useContext(AuthCtx);
}
