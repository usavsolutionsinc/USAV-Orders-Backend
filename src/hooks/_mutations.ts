'use client';

/**
 * Shared server-mutation primitives for the God-component cleanup.
 *
 * The large legacy components (StaffAccessDetail, StationFbaInput, LineEditPanel,
 * …) each hand-roll the same plumbing per mutation:
 *
 *     setBusy('basic');
 *     const r = await fetch(url, { method: 'PATCH', ... });
 *     if (!r.ok) { const d = await r.json().catch(() => ({})); setErr(d.error); return; }
 *     await refresh();          // full refetch
 *     notifyList();             // window.dispatchEvent(...) to poke siblings
 *     setBusy(null);
 *
 * That is `useMutation` + cache invalidation reimplemented by hand, badly: a
 * string `busy` sentinel instead of per-mutation `isPending`, a blanket
 * refetch instead of targeted invalidation, and a window event instead of the
 * shared query cache.
 *
 * `useResourceMutation` collapses all of that to one call. It is a thin wrapper
 * over TanStack's `useMutation` (already wired in Providers.tsx) that:
 *   - parses the server's `{ error }` envelope into a thrown `HttpError`;
 *   - invalidates a declared list of query keys on success;
 *   - otherwise behaves exactly like `useMutation` (isPending, mutate,
 *     mutateAsync, onError, …).
 *
 * NOTE: the legacy local-state `useMutation` in `_data.ts` is a different,
 * pre-TanStack helper. Do not confuse the two — new code should reach for
 * `useResourceMutation`.
 */

import { useCallback } from 'react';
import {
  useMutation,
  useQueryClient,
  type UseMutationOptions,
  type UseMutationResult,
} from '@tanstack/react-query';

/** Error carrying the HTTP status so callers can branch on 401/403 vs 5xx. */
export class HttpError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

/**
 * Resolve a fetch `Response` to JSON, throwing the server's `{ error }`
 * message (or `fallback`) as an `HttpError` when the response is not ok.
 * Tolerates empty bodies (e.g. 204 from DELETE endpoints).
 */
export async function jsonOrThrow<T = unknown>(
  res: Response,
  fallback = 'Request failed.',
): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new HttpError(String(body?.error || fallback), res.status);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

export interface ResourceMutationOptions<TData, TVars>
  extends Omit<UseMutationOptions<TData, Error, TVars>, 'mutationFn'> {
  /**
   * Query keys to invalidate on success. Each is passed to
   * `invalidateQueries({ queryKey })`, so a broad prefix (e.g. `qk.foo.all`)
   * matches every query beneath it. Prefer keys from the `qk` registry.
   */
  invalidates?: ReadonlyArray<readonly unknown[]>;
}

/**
 * A `useMutation` that auto-invalidates the given query keys on success.
 *
 * @example
 * const patchBasic = useResourceMutation(
 *   (patch: Record<string, unknown>) =>
 *     fetch(`/api/admin/staff/${staffId}`, {
 *       method: 'PATCH', credentials: 'include',
 *       headers: { 'content-type': 'application/json' },
 *       body: JSON.stringify(patch),
 *     }).then((r) => jsonOrThrow(r, 'Save failed.')),
 *   { invalidates: [qk.staffAccess.detail(staffId), qk.staffAccess.list] },
 * );
 * // …
 * <button disabled={patchBasic.isPending} onClick={() => patchBasic.mutate({ status })} />
 */
export function useResourceMutation<TData = unknown, TVars = void>(
  mutationFn: (vars: TVars) => Promise<TData>,
  options: ResourceMutationOptions<TData, TVars> = {},
): UseMutationResult<TData, Error, TVars> {
  const queryClient = useQueryClient();
  const { invalidates, onSuccess, ...rest } = options;

  return useMutation<TData, Error, TVars>({
    ...rest,
    mutationFn,
    // Rest-forward so the wrapper stays agnostic to the exact callback arity
    // across TanStack Query minor versions.
    onSuccess: (...args) => {
      invalidates?.forEach((queryKey) =>
        queryClient.invalidateQueries({ queryKey }),
      );
      onSuccess?.(...args);
    },
  });
}

/**
 * Gate an async action behind a `window.confirm()` prompt.
 *
 * Replaces the inline `if (!confirm('…')) return;` blocks that precede every
 * destructive mutation in the legacy components (revoke passkey/session,
 * reset PIN, delete line, …). Returns a stable callback that resolves to
 * `false` (and skips the action) when the user cancels, `true` otherwise.
 *
 * Compose it directly with a mutation's `mutateAsync`:
 *
 * @example
 * const revokeSession = useResourceMutation(
 *   (sid: string) => fetch(`/api/admin/sessions/${sid}`, { method: 'DELETE' }).then((r) => jsonOrThrow(r)),
 *   { invalidates: [qk.staffAccess.detail(staffId)] },
 * );
 * const confirmRevoke = useConfirmedAction(revokeSession.mutateAsync, 'Revoke this session?');
 * // <button onClick={() => confirmRevoke(sid)} />
 */
export function useConfirmedAction<Args extends unknown[]>(
  action: (...args: Args) => unknown | Promise<unknown>,
  message: string,
): (...args: Args) => Promise<boolean> {
  return useCallback(
    async (...args: Args): Promise<boolean> => {
      if (typeof window !== 'undefined' && !window.confirm(message)) return false;
      await action(...args);
      return true;
    },
    [action, message],
  );
}
