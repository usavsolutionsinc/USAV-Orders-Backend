'use client';

/**
 * Staging context for triage rail rows (A3, §3.1/E10) — the "Staged" badge on
 * the combined Triage tab AND the shelf/lane popover chip for any carton with
 * a shelf/lane assigned. Reuses the SAME `/api/receiving/triage/staging-map`
 * endpoint the Done tab and the "Staged" badge both need, indexed by
 * `receiving_id` — mirrors the B3 Zoho-sync-exception dot pattern
 * (`useTriageUnfoundExceptions`): a read-only side-channel annotation query,
 * degrading to an empty map on failure so it never blocks the rail.
 */

import { useQuery } from '@tanstack/react-query';

export interface TriageStagingContext {
  receivingId: number;
  locationLabel: string | null;
  lane: string | null;
  complete: boolean;
}

interface StagingMapApiRow {
  id: number;
  location_name: string | null;
  location_room: string | null;
  priority_lane: string | null;
  triage_complete: boolean;
}

export function useTriageStagingMap(): Map<number, TriageStagingContext> {
  const { data } = useQuery<Map<number, TriageStagingContext>>({
    queryKey: ['receiving', 'triage', 'staging-map'] as const,
    staleTime: 15_000,
    queryFn: async () => {
      const res = await fetch('/api/receiving/triage/staging-map', { cache: 'no-store' });
      if (!res.ok) return new Map<number, TriageStagingContext>();
      const json = (await res.json()) as { rows?: StagingMapApiRow[] };
      const map = new Map<number, TriageStagingContext>();
      for (const r of json.rows ?? []) {
        const id = Number(r.id);
        if (!Number.isFinite(id) || id <= 0) continue;
        map.set(id, {
          receivingId: id,
          locationLabel: r.location_room ? `${r.location_room} · ${r.location_name}` : r.location_name,
          lane: r.priority_lane,
          complete: !!r.triage_complete,
        });
      }
      return map;
    },
  });
  return data ?? new Map<number, TriageStagingContext>();
}
