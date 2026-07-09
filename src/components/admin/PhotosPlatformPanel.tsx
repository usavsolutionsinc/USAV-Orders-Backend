'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import { Button } from '@/design-system/primitives';
import { PhotoAnalysisProviderPanel } from './PhotoAnalysisProviderPanel';

interface PhotosStats {
  totals: {
    photos: number;
    gcsPrimary: number;
    nasMirrored: number;
    analyzed: number;
    pendingNasMirror: number;
  };
  byMonth: Array<{ month: string; count: number }>;
  jobs: { pending: number; failed: number };
}

export function PhotosPlatformPanel() {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery<PhotosStats>({
    queryKey: ['admin-photos-stats'],
    queryFn: async () => {
      const res = await fetch('/api/admin/photos/stats', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 30_000,
  });

  const mirror = useMutation({
    mutationFn: async (limit: number) => {
      const res = await fetch('/api/admin/photos/mirror', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ limit }),
      });
      const json = (await res.json().catch(() => null)) as { error?: string; enqueued?: number };
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      return json.enqueued ?? 0;
    },
    onSuccess: (enqueued) => {
      toast.success(
        enqueued > 0
          ? `Enqueued ${enqueued} NAS mirror job${enqueued === 1 ? '' : 's'}`
          : 'No photos need mirroring right now',
      );
      queryClient.invalidateQueries({ queryKey: ['admin-photos-stats'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Mirror enqueue failed'),
  });

  if (isLoading) {
    return <p className="text-sm text-text-soft">Loading photo platform stats…</p>;
  }
  if (error || !data) {
    return (
      <p className="text-sm text-rose-600">
        {error instanceof Error ? error.message : 'Could not load stats'}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-text-default">Photo platform</h2>
        <p className="mt-1 text-sm text-text-soft">
          GCS storage, NAS cold mirror, and analysis job counts for this organization.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[
          { label: 'Total photos', value: data.totals.photos },
          { label: 'GCS primary', value: data.totals.gcsPrimary },
          { label: 'NAS mirrored', value: data.totals.nasMirrored },
          { label: 'Pending NAS mirror', value: data.totals.pendingNasMirror },
          { label: 'Analyzed', value: data.totals.analyzed },
          { label: 'Jobs pending / failed', value: `${data.jobs.pending} / ${data.jobs.failed}` },
        ].map((card) => (
          <div
            key={card.label}
            className="rounded-xl border border-border-soft bg-surface-card px-4 py-3 shadow-sm"
          >
            <p className="text-micro font-bold uppercase tracking-wider text-text-faint">
              {card.label}
            </p>
            <p className="mt-1 text-2xl font-black tabular-nums text-text-default">{card.value}</p>
          </div>
        ))}
      </div>

      <PhotoAnalysisProviderPanel />

      <div className="rounded-xl border border-border-soft bg-surface-card p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-text-default">NAS mirror backlog</p>
            <p className="text-caption text-text-soft">
              Enqueues mirror jobs for GCS photos older than the configured threshold.
            </p>
          </div>
          <Button
            variant="primary"
            disabled={mirror.isPending}
            onClick={() => mirror.mutate(25)}
          >
            {mirror.isPending ? 'Enqueueing…' : 'Run mirror sync'}
          </Button>
        </div>
      </div>

      {data.byMonth.length > 0 ? (
        <div className="rounded-xl border border-border-soft bg-surface-card p-4 shadow-sm">
          <p className="text-sm font-bold text-text-default">Uploads by month</p>
          <ul className="mt-3 space-y-1.5">
            {data.byMonth.map((row) => (
              <li
                key={row.month}
                className="flex items-center justify-between text-sm text-text-muted"
              >
                <span>{row.month}</span>
                <span className="font-mono font-semibold tabular-nums">{row.count}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
