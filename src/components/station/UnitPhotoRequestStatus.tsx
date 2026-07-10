'use client';

import { useScopedUnitPhotos } from '@/hooks/useScopedUnitPhotos';
import { useUnitPhotosRealtimeRefresh } from '@/hooks/useUnitPhotosRealtimeRefresh';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Compact station-card status line: after a genuine unit-label scan fires a
 * `unit_photo_request` to the phone, this shows "Photo request sent → phone" and
 * a live captured count that bumps as the phone's uploads land (via
 * `useUnitPhotosRealtimeRefresh`). Follows the house "status = small dot + text"
 * pattern — ambient chrome, not a toast.
 * See docs/todo/packer-testing-photo-scan-timeline-plan.md.
 */
export function UnitPhotoRequestStatus({
  serialUnitId,
  unitKey,
}: {
  serialUnitId: number;
  unitKey: string | null;
}) {
  const { user } = useAuth();
  const staffId = user?.staffId ?? 0;
  const { photos, query } = useScopedUnitPhotos(serialUnitId);
  useUnitPhotosRealtimeRefresh(serialUnitId, staffId, () => void query.refetch());
  const count = photos.length;

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border-hairline bg-surface-card px-2.5 py-1.5">
      <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
      <p className="min-w-0 flex-1 truncate text-caption font-semibold text-text-muted">
        Photo request sent → phone
        {unitKey ? <span className="text-text-faint"> · {unitKey}</span> : null}
      </p>
      <span className="shrink-0 text-micro font-bold tabular-nums text-text-faint">
        {count} captured
      </span>
    </div>
  );
}
