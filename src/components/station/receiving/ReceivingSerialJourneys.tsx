'use client';

/**
 * The Timeline tab of the receiving carton detail panel: the per-serial journey
 * for every serialized unit in this carton.
 *
 * A receiving log is carton-level (no single serial), so this fetches the
 * carton's lines + serials (the same `?include=serials` endpoint the panel's
 * "Edit PO" already calls) and renders one {@link SerialJourneySection} per
 * distinct serial — each its own exportable, deep-linkable cross-station trail.
 * Fetches only when the tab is mounted (the parent renders this lazily).
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from '@/components/Icons';
import { Button } from '@/design-system/primitives';
import { SerialJourneySection } from '@/components/serial/SerialJourneySection';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';

async function fetchCartonSerials(receivingId: number): Promise<string[]> {
  const res = await fetch(`/api/receiving-lines?receiving_id=${receivingId}&include=serials`, {
    cache: 'no-store',
  });
  if (!res.ok) throw new Error('Failed to load carton serials');
  const data = await res.json().catch(() => null);
  const rows: ReceivingLineRow[] = Array.isArray(data?.receiving_lines) ? data.receiving_lines : [];
  const serials = rows.flatMap((r) =>
    (r.serials ?? [])
      .map((s) => String(s.serial_number || '').trim())
      .filter((s): s is string => s.length > 0),
  );
  return [...new Set(serials)];
}

export function ReceivingSerialJourneys({ receivingId }: { receivingId: number | string }) {
  const id = Number(receivingId);
  const enabled = Number.isFinite(id) && id > 0;

  const query = useQuery({
    queryKey: ['receiving-carton-serials', id],
    queryFn: () => fetchCartonSerials(id),
    enabled,
    staleTime: 30_000,
  });

  const serials = useMemo(() => query.data ?? [], [query.data]);

  if (query.isLoading) {
    return (
      <div className="flex items-center gap-2 px-1 py-6 text-caption font-medium text-gray-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading serials…
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="rounded-xl border border-dashed border-rose-200 bg-rose-50 px-4 py-6 text-center text-caption font-semibold text-rose-600">
        Could not load this carton&rsquo;s serials.
        <Button
          variant="ghost"
          onClick={() => query.refetch()}
          className="ml-2 inline h-auto p-0 align-baseline text-rose-600 underline decoration-dotted hover:bg-transparent hover:text-rose-700"
        >
          Retry
        </Button>
      </div>
    );
  }
  if (serials.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-center text-caption font-medium text-gray-500">
        No serialized units on this receiving yet.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {serials.map((sn) => (
        <SerialJourneySection
          key={sn}
          serialNumber={sn}
          title={serials.length > 1 ? `Serial journey · ${sn}` : 'Serial journey'}
          density="compact"
          className="border-t border-gray-100 pt-3 pb-2 first:border-t-0 first:pt-0"
        />
      ))}
    </div>
  );
}
