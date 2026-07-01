'use client';

/**
 * useTriageStaging — data + actions for the Stage step (§4, A1/A2/A3):
 * shelf assignment (reuses the existing `locations` catalog, no parallel
 * table — G7) + priority lane (auto-suggested via `resolveTriageLane`, manual
 * override always wins — §4.2/D3).
 *
 * Self-contained (not folded into `useUnboxLineController`) because staging is
 * triage-only state; unbox never reads it. Persists through the general carton
 * PATCH route (`PATCH /api/receiving/[id]`), which already owns
 * source_platform/intake_type the same way.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import { dispatchLineUpdated } from '@/components/station/ReceivingLinesTable';
import { invalidateReceivingFeeds } from '@/lib/queries/receiving-queries';
import { resolveTriageLane, type TriageLane } from '@/lib/receiving/triage-lane-policy';
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
  const [priorityLane, setPriorityLane] = useState(row.priority_lane ?? null);
  useEffect(() => {
    setStagingLocationId(row.staging_location_id ?? null);
    setPriorityLane(row.priority_lane ?? null);
  }, [row.id, row.staging_location_id, row.priority_lane]);

  // The auto-routed default (D3) — shown as a hint until the operator picks a
  // lane manually. Never overwrites a manual pick.
  const suggestedLane = useMemo<TriageLane | null>(
    () =>
      resolveTriageLane(null, {
        isReturn: isReturnIntake(row),
        isPriority: !!row.is_priority,
      }),
    [row],
  );

  const [savingLocation, setSavingLocation] = useState(false);
  const [savingLane, setSavingLane] = useState(false);

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
      const ok = await patchStaging({ staging_location_id: locationId });
      if (!ok) setStagingLocationId(row.staging_location_id ?? null);
      setSavingLocation(false);
    },
    [patchStaging, row.staging_location_id],
  );

  const selectLane = useCallback(
    async (lane: TriageLane | null) => {
      setPriorityLane(lane);
      setSavingLane(true);
      const ok = await patchStaging({ priority_lane: lane });
      if (!ok) setPriorityLane(row.priority_lane ?? null);
      setSavingLane(false);
    },
    [patchStaging, row.priority_lane],
  );

  return {
    locations,
    locationsLoading: locationsQuery.isLoading,
    stagingLocationId,
    priorityLane,
    suggestedLane,
    selectShelf,
    selectLane,
    savingLocation,
    savingLane,
  };
}

export type TriageStagingController = ReturnType<typeof useTriageStaging>;
