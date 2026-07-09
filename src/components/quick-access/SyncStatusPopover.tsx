'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNowStrict } from 'date-fns';
import { Loader2, RefreshCw, Play } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { IconButton } from '@/design-system/primitives';
import { useCronRunsSummary } from '@/hooks/useCronRuns';
import { cronRunsKeys, type JobHealth, type CronJobStatus } from '@/lib/queries/cron-runs-queries';

const DOT: Record<JobHealth, string> = {
  ok: 'bg-emerald-500',
  stale: 'bg-amber-500',
  failed: 'bg-rose-500',
  running: 'bg-blue-500 animate-pulse',
  never: 'bg-surface-strong',
};

const HEALTH_LABEL: Record<JobHealth, string> = {
  ok: 'Healthy',
  stale: 'Stale',
  failed: 'Failed',
  running: 'Running',
  never: 'Never run',
};

function relative(iso: string | null): string {
  if (!iso) return 'never';
  try {
    return formatDistanceToNowStrict(new Date(iso), { addSuffix: true });
  } catch {
    return '—';
  }
}

export function SyncStatusPopover({ onClose }: { onClose: () => void }) {
  const { data, isLoading, isError } = useCronRunsSummary();
  const queryClient = useQueryClient();
  const [running, setRunning] = useState<string | null>(null);

  const runNow = async (job: string) => {
    setRunning(job);
    try {
      await fetch(`/api/cron-runs/run?job=${encodeURIComponent(job)}`, { method: 'POST' });
      await queryClient.invalidateQueries({ queryKey: cronRunsKeys.all });
    } catch {
      /* surfaced on next refetch */
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="w-[360px] overflow-hidden rounded-xl border border-border-soft bg-surface-card shadow-xl">
      <header className="flex items-center justify-between border-b border-border-hairline px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-label font-black text-text-default">Sync status</span>
          {data && (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-mini font-bold ${
                data.health === 'failed'
                  ? 'bg-rose-50 text-rose-700'
                  : data.health === 'stale'
                    ? 'bg-amber-50 text-amber-700'
                    : 'bg-emerald-50 text-emerald-700'
              }`}
            >
              {data.health === 'ok' ? 'All healthy' : `${data.counts.failed} failed · ${data.counts.stale} stale`}
            </span>
          )}
        </div>
        <Link
          href="/admin?section=system_sync"
          onClick={onClose}
          className="text-mini font-bold text-blue-600 hover:underline"
        >
          View all
        </Link>
      </header>

      <div className="max-h-[420px] overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center gap-2 px-4 py-6 text-caption text-text-faint">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : isError || !data ? (
          <div className="px-4 py-6 text-caption text-rose-600">Failed to load sync status.</div>
        ) : (
          <ul className="divide-y divide-border-hairline">
            {data.jobs.map((j) => (
              <JobRow key={j.job} job={j} running={running === j.job} onRun={() => runNow(j.job)} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function JobRow({ job, running, onRun }: { job: CronJobStatus; running: boolean; onRun: () => void }) {
  const last = job.lastRun;
  return (
    <li className="group flex items-center gap-2.5 px-4 py-2">
      <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[job.health]}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="truncate text-label font-bold text-text-default">{job.label}</div>
        <div className="truncate text-mini text-text-soft">
          {HEALTH_LABEL[job.health]} · {relative(last?.finishedAt ?? last?.startedAt ?? null)}
          {last?.durationMs != null ? ` · ${(last.durationMs / 1000).toFixed(1)}s` : ''}
        </div>
        {job.health === 'failed' && last?.error ? (
          // ds-allow-title: truncation-only native title on a non-interactive element
          <div className="mt-0.5 truncate text-mini text-rose-600" title={last.error}>
            {last.error}
          </div>
        ) : null}
      </div>
      <HoverTooltip label="Run now" asChild>
        <IconButton
          onClick={onRun}
          disabled={running}
          ariaLabel="Run now"
          className="shrink-0 rounded-md p-1.5 opacity-0 hover:bg-surface-sunken group-hover:opacity-100 disabled:opacity-100"
          icon={running ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
        />
      </HoverTooltip>
    </li>
  );
}
