'use client';

import { useEffect, useState } from 'react';
import { usePersistedStaffId } from '@/hooks/usePersistedStaffId';

export type ClientStaffRole =
  | 'packer'
  | 'receiving'
  | 'technician'
  | 'sales'
  | 'admin'
  | 'readonly'
  | 'unknown';

const ADMIN_TIER: ReadonlySet<ClientStaffRole> = new Set(['admin']);

// Memoized so opening multiple sheets doesn't fan out parallel queries for
// the same staff. Roles are stable across a session.
const cache = new Map<number, Promise<ClientStaffRole>>();

async function loadRole(staffId: number): Promise<ClientStaffRole> {
  const existing = cache.get(staffId);
  if (existing) return existing;
  const promise = fetch(`/api/staff?id=${staffId}`, { cache: 'no-store' })
    .then((res) => (res.ok ? res.json() : null))
    .then((data): ClientStaffRole => {
      const role = String(data?.staff?.role ?? data?.role ?? '')
        .trim()
        .toLowerCase();
      return role === 'packer' ||
        role === 'receiving' ||
        role === 'technician' ||
        role === 'sales' ||
        role === 'admin' ||
        role === 'readonly'
        ? (role as ClientStaffRole)
        : 'unknown';
    })
    .catch(() => 'unknown' as ClientStaffRole);
  cache.set(staffId, promise);
  return promise;
}

export interface UseStaffRoleResult {
  role: ClientStaffRole;
  isAdmin: boolean;
  isReadonly: boolean;
  loading: boolean;
}

/**
 * Client-side role resolver. Reads `?staffId=` (via the existing hook),
 * then fetches the role from /api/staff. Cached in module scope so multiple
 * sheets share one request.
 *
 * Used to hide destructive UI affordances for non-admins. Note: this is a
 * UX nicety — the server-side gates in /lib/auth/permissions.ts are the
 * actual security boundary.
 */
export function useStaffRole(): UseStaffRoleResult {
  const [staffId] = usePersistedStaffId();
  const [role, setRole] = useState<ClientStaffRole>('unknown');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!staffId || staffId <= 0) {
      setRole('unknown');
      setLoading(false);
      return;
    }
    setLoading(true);
    loadRole(staffId).then((r) => {
      if (cancelled) return;
      setRole(r);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [staffId]);

  return {
    role,
    isAdmin: ADMIN_TIER.has(role),
    isReadonly: role === 'readonly',
    loading,
  };
}
