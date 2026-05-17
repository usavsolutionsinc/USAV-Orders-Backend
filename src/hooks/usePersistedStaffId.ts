'use client';

/**
 * DEPRECATED — kept as a session-backed shim during the Phase D rollout.
 *
 * Was: URL → localStorage → fallback bridge. The URL/localStorage paths are
 * gone (Phase F). Now returns the signed-in staff's ID from AuthContext,
 * with the original `fallback` honoured when there's no session yet.
 *
 * The setter is a no-op (staff switching happens via the FAB → Switch
 * staff sheet, not via per-page mutation). Existing callers compile but
 * stop driving identity from the page level.
 *
 * Delete this file once all callsites have been migrated to `useAuth()`
 * directly (Phase H).
 */

import { useAuth } from '@/contexts/AuthContext';

const DEFAULT_STAFF_ID = 8;

interface PersistedStaffIdOptions {
  /** Ignored; previously the localStorage key. Kept for type compatibility. */
  storageKey?: string;
  /** Returned when no session is active. */
  fallback?: number;
}

let warnedOnce = false;

export function usePersistedStaffId(
  options?: PersistedStaffIdOptions,
): [staffId: number, setStaffId: (id: number) => void] {
  const { fallback = DEFAULT_STAFF_ID } = options ?? {};
  const { user } = useAuth();

  if (typeof window !== 'undefined' && !warnedOnce) {
    warnedOnce = true;
    // eslint-disable-next-line no-console
    console.warn(
      '[usePersistedStaffId] deprecated — read useAuth().user?.staffId. ' +
      'This shim returns the signed-in staff from the session cookie.',
    );
  }

  const staffId = user?.staffId ?? fallback;
  const setStaffId = (_id: number) => {
    if (typeof window !== 'undefined') {
      // eslint-disable-next-line no-console
      console.warn('[usePersistedStaffId.set] no-op — switch staff via the FAB.');
    }
  };
  return [staffId, setStaffId];
}
