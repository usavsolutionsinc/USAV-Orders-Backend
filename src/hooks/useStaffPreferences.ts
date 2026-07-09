'use client';

import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import type { StaffPreferences } from '@/lib/neon/staff-preferences-queries';
import type { StaffPreferencesPutBody } from '@/lib/schemas/staff-preferences';

export const STAFF_PREFERENCES_QUERY_KEY = ['staff-preferences'] as const;
const QUERY_KEY = STAFF_PREFERENCES_QUERY_KEY;

/**
 * The logged-in staffer's UI preferences (server-backed, cross-device).
 *
 * Gated on an authenticated session so it never fires on public pages. The
 * focus-scan hotkey rides on this; see {@link useScanHotkey} for the live
 * binding (which hydrates from here but stays instant via localStorage).
 */
export function useStaffPreferences() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const enabled = !!user?.staffId;

  const query = useQuery({
    queryKey: QUERY_KEY,
    enabled,
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<StaffPreferences> => {
      const res = await fetch('/api/staff-preferences');
      if (!res.ok) throw new Error(`staff-preferences ${res.status}`);
      const data = (await res.json()) as { prefs: StaffPreferences };
      return data.prefs ?? {};
    },
  });

  const mutation = useMutation({
    mutationFn: async (patch: StaffPreferencesPutBody): Promise<StaffPreferences> => {
      const res = await fetch('/api/staff-preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`staff-preferences PUT ${res.status}`);
      const data = (await res.json()) as { prefs: StaffPreferences };
      return data.prefs ?? {};
    },
    onSuccess: (prefs) => queryClient.setQueryData(QUERY_KEY, prefs),
  });

  const update = useCallback(
    (patch: StaffPreferencesPutBody) => mutation.mutate(patch),
    [mutation],
  );

  return {
    prefs: query.data,
    isLoading: query.isLoading,
    update,
  };
}
