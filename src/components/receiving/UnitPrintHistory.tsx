'use client';

/**
 * UnitPrintHistory — compact reader for a serial unit's `label_print_jobs`
 * ledger (serial↔label pairing plan §5.1). Shows the last N prints newest-first
 * with a first-issue / reprint marker and the exact identity that was encoded —
 * proving reprint-vs-first-issue at a glance. Reusable: wired into the box panel
 * unit rows now; drop it behind the serial-chip ⋯ overflow when that lands.
 */

import { useQuery } from '@tanstack/react-query';
import { Loader2 } from '@/components/Icons';
import { DateTimeValue } from '@/design-system/components/DateTimeValue';

interface PrintJob {
  id: number;
  job_type: string;
  unit_uid: string | null;
  qr_payload: string;
  is_reprint: boolean;
  template_id: string | null;
  created_at: string;
}

export function UnitPrintHistory({
  serialUnitId,
  limit = 3,
}: {
  serialUnitId: number;
  limit?: number;
}) {
  const { data, isLoading, isError } = useQuery<{ ok: boolean; jobs: PrintJob[] }>({
    queryKey: ['unit-print-history', serialUnitId, limit],
    enabled: serialUnitId > 0,
    queryFn: async () => {
      const res = await fetch(`/api/serial-units/${serialUnitId}/print-history?limit=${limit}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-1.5 py-1 text-eyebrow font-semibold text-text-muted">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading print history…
      </div>
    );
  }
  if (isError) {
    return <div className="py-1 text-eyebrow font-semibold text-rose-600">Couldn't load print history.</div>;
  }
  const jobs = data?.jobs ?? [];
  if (jobs.length === 0) {
    return <div className="py-1 text-eyebrow font-semibold text-text-muted">No prints recorded yet.</div>;
  }
  return (
    <ul className="space-y-1 py-1">
      {jobs.map((j) => (
        <li key={j.id} className="flex items-center gap-2 text-eyebrow font-semibold text-text-soft">
          <span
            className={`shrink-0 rounded px-1 py-0.5 text-[8px] font-black uppercase tracking-widest ring-1 ring-inset ${
              j.is_reprint
                ? 'bg-amber-50 text-amber-700 ring-amber-200'
                : 'bg-emerald-50 text-emerald-700 ring-emerald-200'
            }`}
          >
            {j.is_reprint ? 'Reprint' : 'First'}
          </span>
          <span className="min-w-0 flex-1 truncate font-mono">{j.unit_uid || j.qr_payload}</span>
          <DateTimeValue value={j.created_at} className="shrink-0" />
        </li>
      ))}
    </ul>
  );
}
