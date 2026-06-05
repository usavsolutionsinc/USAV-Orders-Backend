'use client';

/**
 * Server state for the StaffAccessDetail view: the detail envelope (one GET)
 * plus every mutation the cards trigger. Replaces ~200 lines of hand-rolled
 * `useState`/`fetch`/`setBusy`/`await refresh()`/`notifyList()` plumbing with
 * a query + `useResourceMutation`s that invalidate the shared cache.
 *
 * Mutations that change something the sidebar roster shows (name, role,
 * status, PIN) also re-emit the legacy `admin-access-refresh` window event,
 * because AccessSidebarPanel still listens for it. Once that panel reads the
 * `qk.staffAccess.list` cache directly the event can be dropped.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  HttpError,
  emitAppEvent,
  jsonOrThrow,
  useResourceMutation,
} from '@/hooks';
import { qk } from '@/queries/keys';
import type { DetailEnvelope, StationKey } from './staff-access-shared';

const ADMIN_ACCESS_REFRESH = 'admin-access-refresh';

const jsonHeaders = { 'content-type': 'application/json' } as const;

export function useStaffAccessDetail(staffId: number) {
  const queryClient = useQueryClient();
  const detailKey = qk.staffAccess.detail(staffId);

  const detail = useQuery<DetailEnvelope>({
    queryKey: detailKey,
    queryFn: async () => {
      const r = await fetch(`/api/admin/staff/${staffId}/detail`, {
        credentials: 'include',
      });
      if (!r.ok) {
        throw new HttpError(
          r.status === 401 || r.status === 403
            ? "You don't have admin access."
            : 'Could not load staff.',
          r.status,
        );
      }
      return (await r.json()) as DetailEnvelope;
    },
  });

  // Mutations that the roster cares about invalidate the detail and notify the
  // sidebar; the rest only invalidate the detail.
  const notifyRoster = () => emitAppEvent(ADMIN_ACCESS_REFRESH);
  const detailOnly = { invalidates: [detailKey] as const };
  const detailAndRoster = { invalidates: [detailKey] as const, onSuccess: notifyRoster };

  const patchBasic = useResourceMutation(
    (patch: Record<string, unknown>) =>
      fetch(`/api/admin/staff/${staffId}`, {
        method: 'PATCH', credentials: 'include', headers: jsonHeaders,
        body: JSON.stringify(patch),
      }).then((r) => jsonOrThrow(r, 'Save failed.')),
    detailAndRoster,
  );

  const patchPermissions = useResourceMutation(
    (next: { add: string[]; remove: string[] }) =>
      fetch(`/api/admin/staff/${staffId}/permissions`, {
        method: 'PATCH', credentials: 'include', headers: jsonHeaders,
        body: JSON.stringify(next),
      }).then((r) => jsonOrThrow(r, 'Permission save failed.')),
    detailOnly,
  );

  const setRoles = useResourceMutation(
    (roleIds: number[]) =>
      fetch(`/api/admin/staff/${staffId}/roles`, {
        method: 'PUT', credentials: 'include', headers: jsonHeaders,
        body: JSON.stringify({ roleIds }),
      }).then((r) => jsonOrThrow(r, 'Role assignment failed.')),
    detailAndRoster,
  );

  const resetPin = useResourceMutation(
    () =>
      fetch(`/api/admin/staff/${staffId}/reset-pin`, {
        method: 'POST', credentials: 'include',
      }).then((r) => jsonOrThrow<{ url: string; expiresAt: string }>(r, 'Reset failed.')),
    detailAndRoster,
  );

  const setPin = useResourceMutation(
    (pin: string) =>
      fetch(`/api/admin/staff/${staffId}/set-pin`, {
        method: 'POST', credentials: 'include', headers: jsonHeaders,
        body: JSON.stringify({ pin }),
      }).then((r) => jsonOrThrow(r, 'Could not set PIN.')),
    detailAndRoster,
  );

  const revokePasskey = useResourceMutation(
    (pid: number) =>
      fetch(`/api/admin/staff/${staffId}/passkeys/${pid}`, {
        method: 'DELETE', credentials: 'include',
      }).then((r) => jsonOrThrow(r, 'Revoke failed.')),
    detailOnly,
  );

  const revokeSession = useResourceMutation(
    (sid: string) =>
      fetch(`/api/admin/sessions/${encodeURIComponent(sid)}`, {
        method: 'DELETE', credentials: 'include',
      }).then((r) => jsonOrThrow(r, 'Revoke failed.')),
    detailOnly,
  );

  const revokeAllSessions = useResourceMutation(
    () =>
      fetch(`/api/admin/staff/${staffId}/sessions`, {
        method: 'DELETE', credentials: 'include',
      }).then((r) => jsonOrThrow(r, 'Revoke failed.')),
    detailOnly,
  );

  const patchMobileConfig = useResourceMutation(
    (config: unknown) =>
      fetch(`/api/admin/staff/${staffId}/mobile-display-config`, {
        method: 'PATCH', credentials: 'include', headers: jsonHeaders,
        body: JSON.stringify({ config }),
      }).then((r) => jsonOrThrow(r, 'Mobile save failed.')),
    detailOnly,
  );

  const mutations = {
    patchBasic, patchPermissions, setRoles, resetPin, setPin,
    revokePasskey, revokeSession, revokeAllSessions, patchMobileConfig,
  };

  // First in-flight mutation error, surfaced as a dismissible strip without
  // unmounting the cards (the legacy code replaced the whole view on error).
  const actionError =
    Object.values(mutations).find((m) => m.error)?.error?.message ?? null;
  const anyBusy = Object.values(mutations).some((m) => m.isPending);

  return { detail, mutations, actionError, anyBusy, detailKey, queryClient };
}

export type StaffAccessMutations = ReturnType<typeof useStaffAccessDetail>['mutations'];
export type { StationKey };
