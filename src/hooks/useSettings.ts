'use client';

import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import type { ResolvedSetting, SettingPage, SettingValue } from '@/lib/settings/types';

interface PageSettingsResponse {
  page: SettingPage;
  plan: string;
  canManageOrg: boolean;
  items: ResolvedSetting[];
}

export interface SetSettingArgs {
  key: string;
  value: SettingValue;
  /** 'staff' = personal override (default for staff-scope + personalizable); 'org' = the org default. */
  target?: 'org' | 'staff';
}

export type SettingsMutationError = Error & { feature?: string; status?: number };

/**
 * Read + write the Settings Registry values for one page. Backed by
 * /api/settings, which resolves effective values server-side (entitlement +
 * org→staff layering applied). The setter optimistically patches the cached
 * item from the server's re-resolved response.
 */
export function usePageSettings(page: SettingPage) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const enabled = !!user?.staffId;
  const queryKey = ['page-settings', page] as const;

  const query = useQuery({
    queryKey,
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<PageSettingsResponse> => {
      const res = await fetch(`/api/settings?page=${encodeURIComponent(page)}`);
      if (!res.ok) throw new Error(`settings ${res.status}`);
      return (await res.json()) as PageSettingsResponse;
    },
  });

  const mutation = useMutation({
    mutationFn: async (args: SetSettingArgs): Promise<ResolvedSetting> => {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        item?: ResolvedSetting;
        error?: string;
        feature?: string;
      };
      if (!res.ok || !data.item) {
        const err = new Error(data.error || `settings PUT ${res.status}`) as SettingsMutationError;
        err.feature = data.feature;
        err.status = res.status;
        throw err;
      }
      return data.item;
    },
    onSuccess: (item) => {
      queryClient.setQueryData<PageSettingsResponse>(queryKey, (prev) =>
        prev
          ? { ...prev, items: prev.items.map((it) => (it.key === item.key ? item : it)) }
          : prev,
      );
    },
  });

  const byKey = useCallback(
    (key: string): ResolvedSetting | undefined => query.data?.items.find((it) => it.key === key),
    [query.data],
  );

  const setSetting = useCallback(
    (args: SetSettingArgs) => mutation.mutateAsync(args),
    [mutation],
  );

  return {
    items: query.data?.items ?? [],
    canManageOrg: query.data?.canManageOrg ?? false,
    plan: query.data?.plan,
    isLoading: query.isLoading,
    isError: query.isError,
    byKey,
    setSetting,
    isSaving: mutation.isPending,
  };
}

/**
 * Convenience reader for a single setting's effective value + a typed setter,
 * for threading into a feature's decision point. Shares the page query cache
 * with usePageSettings.
 */
export function useSetting<T extends SettingValue = SettingValue>(page: SettingPage, key: string) {
  const ctx = usePageSettings(page);
  const resolved = ctx.byKey(key);
  const set = useCallback(
    (value: T, target?: 'org' | 'staff') => ctx.setSetting({ key, value, target }),
    [ctx, key],
  );
  return {
    value: resolved?.value as T | undefined,
    source: resolved?.source,
    locked: resolved?.locked ?? false,
    lockedOptions: resolved?.lockedOptions ?? [],
    isLoading: ctx.isLoading,
    set,
  };
}
