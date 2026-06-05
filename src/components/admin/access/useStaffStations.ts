'use client';

/**
 * Station assignment (header goal chip) for one staffer — its own GET/PUT pair,
 * separate from the main detail envelope just as it was before. Keeps the
 * legacy optimistic behaviour: the UI updates immediately on save and reverts
 * by refetch if the PUT fails.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { jsonOrThrow, useResourceMutation } from '@/hooks';
import { qk } from '@/queries/keys';
import type { StationAssignment } from './staff-access-shared';

const EMPTY: StationAssignment = { primary: null, secondary: [] };

export function useStaffStations(staffId: number) {
  const queryClient = useQueryClient();
  const key = qk.staffAccess.stations(staffId);

  const query = useQuery<StationAssignment>({
    queryKey: key,
    queryFn: async () => {
      const data = await fetch(`/api/admin/staff/${staffId}/stations`, {
        credentials: 'include',
      }).then((r) => jsonOrThrow<StationAssignment>(r, 'Could not load stations.'));
      return {
        primary: data.primary ?? null,
        secondary: Array.isArray(data.secondary) ? data.secondary : [],
      };
    },
  });

  const save = useResourceMutation(
    (next: StationAssignment) =>
      fetch(`/api/admin/staff/${staffId}/stations`, {
        method: 'PUT', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(next),
      }).then((r) => jsonOrThrow(r, 'Station save failed.')),
    {
      invalidates: [key],
      // Optimistic: reflect the new assignment instantly.
      onMutate: async (next: StationAssignment) => {
        await queryClient.cancelQueries({ queryKey: key });
        queryClient.setQueryData(key, next);
      },
      // Revert to the authoritative server state on failure.
      onError: () => {
        queryClient.invalidateQueries({ queryKey: key });
      },
    },
  );

  return { stations: query.data ?? EMPTY, save };
}
