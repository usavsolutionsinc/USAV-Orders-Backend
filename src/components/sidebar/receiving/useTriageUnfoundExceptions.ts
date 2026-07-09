'use client';

/**
 * B3 — read-only Zoho-sync exception context for triage Unfound rows. Reuses the
 * EXISTING receiving tracking-exception feed (no new server view) and indexes it
 * by receiving_id, so each unfound carton row can show "Zoho still hasn't synced
 * this PO" as a dot + tooltip. Degrades to an empty map on fetch failure (it's
 * secondary context — never blocks the rail).
 *
 * Behavior hook: owns the query only and returns the indexed map; the component
 * decides how to render it.
 */

import { useQuery } from '@tanstack/react-query';
import {
  indexReceivingExceptions,
  type ReceivingExceptionRow,
  type ReceivingExceptionContext,
} from '@/lib/receiving/triage-exception-context';

export function useTriageUnfoundExceptions(): Map<number, ReceivingExceptionContext> | undefined {
  const { data } = useQuery<Map<number, ReceivingExceptionContext>>({
    queryKey: ['receiving', 'triage', 'open-exceptions'] as const,
    staleTime: 30_000,
    queryFn: async () => {
      const res = await fetch(
        '/api/tracking-exceptions?domain=receiving&status=open&limit=500',
        { cache: 'no-store' },
      );
      if (!res.ok) return new Map<number, ReceivingExceptionContext>();
      const json = (await res.json()) as { rows?: ReceivingExceptionRow[] };
      return indexReceivingExceptions(json.rows ?? []);
    },
  });
  return data;
}
