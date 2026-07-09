'use client';

/**
 * useTriageStaging — shelf assignment for triage (locations catalog).
 * Priority lane is auto-routed on shelf save via `resolveTriageLane` — no UI picker.
 */

import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import { dispatchLineUpdated } from '@/components/station/ReceivingLinesTable';
import { invalidateReceivingFeeds } from '@/lib/queries/receiving-queries';
import { resolveTriageLane } from '@/lib/receiving/triage-lane-policy';
import { isReturnIntake } from '@/lib/receiving/triage-intake-kind';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';
import type { Location } from '@/lib/neon/location-queries';

interface LocationsResponse {
  locations: Location[];
}

export function useTriageStaging(row: ReceivingLineRow) {
  const queryClient = useQueryClient();

  const locationsQuery = useQuery<Location[]>({
    queryKey: ['locations', 'active'] as const,
    staleTime: 60_000,
    queryFn: async () => {
      const res = await fetch('/api/locations', { cache: 'no-store' });
      if (!res.ok) return [];
      const data = (await res.json()) as LocationsResponse;
      // Real bins only — a room/zone parent (no row/col) isn't a scannable shelf.
      return (data.locations ?? []).filter((l) => l.row_label != null && l.col_label != null);
    },
  });
  const locations = locationsQuery.data ?? [];

  const [stagingLocationId, setStagingLocationId] = useState(row.staging_location_id ?? null);
  useEffect(() => {
    setStagingLocationId(row.staging_location_id ?? null);
  }, [row.id, row.staging_location_id]);

  const [savingLocation, setSavingLocation] = useState(false);

  const patchStaging = useCallback(
    async (patch: { staging_location_id?: number | null; priority_lane?: string | null }) => {
      if (row.receiving_id == null) return false;
      try {
        const res = await fetch(`/api/receiving/${row.receiving_id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.success) {
          toast.error(data?.error || 'Could not save staging');
          return false;
        }
        dispatchLineUpdated({ id: row.id, ...patch });
        invalidateReceivingFeeds(queryClient);
        return true;
      } catch {
        toast.error('Could not save staging');
        return false;
      }
    },
    [row.receiving_id, row.id, queryClient],
  );

  const selectShelf = useCallback(
    async (locationId: number | null) => {
      setStagingLocationId(locationId);
      setSavingLocation(true);
      const autoLane = resolveTriageLane(row.priority_lane ?? null, {
        isReturn: isReturnIntake(row),
        isPriority: !!row.is_priority,
      });
      const ok = await patchStaging({
        staging_location_id: locationId,
        ...(autoLane ? { priority_lane: autoLane } : {}),
      });
      if (!ok) setStagingLocationId(row.staging_location_id ?? null);
      setSavingLocation(false);
    },
    [patchStaging, row],
  );

  return {
    locations,
    locationsLoading: locationsQuery.isLoading,
    stagingLocationId,
    selectShelf,
    savingLocation,
  };
}

export type TriageStagingController = ReturnType<typeof useTriageStaging>;
