'use client';

/**
 * <Can perm="receiving.scan_po">…</Can>
 *
 * Renders children only if the current user holds the given permission.
 * Pair with the same permission string in middleware / page-guard / withAuth
 * so a sidebar item that's hidden also fails to load the page that's hidden,
 * which fails the API call that's hidden — defense in depth without
 * duplicating logic.
 */

import { useAuth } from '@/contexts/AuthContext';

interface CanProps {
  perm: string;
  /** Render an alternative when the permission is missing. */
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

export function Can({ perm, fallback = null, children }: CanProps) {
  const { has, isLoaded } = useAuth();
  if (!isLoaded) return null;
  return has(perm) ? <>{children}</> : <>{fallback}</>;
}
