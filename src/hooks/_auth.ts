import { useState, useCallback } from 'react';

/**
 * Lightweight auth state hook — replace the internals with your auth provider.
 * Reads from localStorage by default for session persistence.
 */
export function useAuthToken(): {
  token: string | null;
  setToken: (token: string | null) => void;
  clearToken: () => void;
  isAuthenticated: boolean;
} {
  const [token, setTokenState] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('auth_token');
  });

  const setToken = useCallback((t: string | null) => {
    setTokenState(t);
    if (t) {
      localStorage.setItem('auth_token', t);
    } else {
      localStorage.removeItem('auth_token');
    }
  }, []);

  const clearToken = useCallback(() => setToken(null), [setToken]);

  return {
    token,
    setToken,
    clearToken,
    isAuthenticated: token != null,
  };
}

/**
 * Checks if the current user has all of the given permissions.
 * Pass a permissions array from your session/JWT claims.
 */
export function usePermissions(userPermissions: string[]): {
  hasPermission: (permission: string) => boolean;
  hasAllPermissions: (permissions: string[]) => boolean;
  hasAnyPermission: (permissions: string[]) => boolean;
} {
  const set = new Set(userPermissions);

  const hasPermission = useCallback(
    (permission: string) => set.has(permission),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userPermissions.join(',')],
  );

  const hasAllPermissions = useCallback(
    (permissions: string[]) => permissions.every((p) => set.has(p)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userPermissions.join(',')],
  );

  const hasAnyPermission = useCallback(
    (permissions: string[]) => permissions.some((p) => set.has(p)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userPermissions.join(',')],
  );

  return { hasPermission, hasAllPermissions, hasAnyPermission };
}
