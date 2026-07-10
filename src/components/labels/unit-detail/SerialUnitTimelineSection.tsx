'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TimelineSection } from '@/components/ui/TimelineSection';
import { unitPhotosToTimeline, type UnitTimelinePhotoRow } from '@/lib/timeline';
import { useAuth } from '@/contexts/AuthContext';
import { useUnitPhotosRealtimeRefresh } from '@/hooks/useUnitPhotosRealtimeRefresh';

/**
 * The unit's PHOTO timeline — testing-scan captures paired with the receiving
 * UNBOX photos of the same physical unit (joined via serial_unit_provenance),
 * newest-first, thumbnails inline. Built on the canonical `TimelineSection` /
 * `EventTimeline` primitive; the adapter attaches media, the renderer stays
 * domain-free. Live-refreshes on `unit_photo_uploaded` / `unit-photo.changed`.
 *
 * Distinct from the event-history `TimelineCard` above it: this is the paired
 * photo display the packer testing-photo scan produces.
 * See docs/todo/packer-testing-photo-scan-timeline-plan.md.
 */
export function SerialUnitTimelineSection({ serialUnitId }: { serialUnitId: number }) {
  const { user } = useAuth();
  const staffId = user?.staffId ?? 0;

  const query = useQuery({
    queryKey: ['unit-timeline-photos', serialUnitId],
    queryFn: async (): Promise<{ photos: UnitTimelinePhotoRow[] }> => {
      const res = await fetch(`/api/serial-units/${serialUnitId}/timeline-photos`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      return { photos: Array.isArray(body?.photos) ? body.photos : [] };
    },
    enabled: Number.isFinite(serialUnitId) && serialUnitId > 0,
    staleTime: 15_000,
  });

  useUnitPhotosRealtimeRefresh(serialUnitId, staffId, () => void query.refetch());

  const items = useMemo(
    () => unitPhotosToTimeline(query.data?.photos ?? []),
    [query.data?.photos],
  );

  // Hide entirely when a settled unit has no paired photos — keeps the pane
  // uncluttered for units that never went through testing-photo capture.
  if (!query.isLoading && items.length === 0) return null;

  return (
    <TimelineSection
      title="Photos"
      items={items}
      loading={query.isLoading}
      emptyMessage="No unit photos yet."
      density="comfortable"
      className="border-t border-border-hairline pt-4"
    />
  );
}
