'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNowStrict } from 'date-fns';
import { Loader2, RefreshCw, Play, Activity } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { useCronRunsSummary, useCronRunsList } from '@/hooks/useCronRuns';
import { cronRunsKeys, type JobHealth, type CronJobStatus, type CronRunRow } from '@/lib/queries/cron-runs-queries';
import { syncRunStatusChipClass } from '@/lib/sync-run-status';
import { Button, IconButton } from '@/design-system/primitives';

/**
 * Admin → System sync activity: every cron/job's health, last run, and a
 * filterable run-history feed with error + summary drill-down. "Run now"
 * triggers the job through its normal cron path.
 */

const DOT: Record<JobHealth, string> = {
  ok: 'bg-emerald-500',
  stale: 'bg-amber-500',
  failed: 'bg-rose-500',
  running: 'bg-blue-500 animate-pulse',
  never: 'bg-surface-strong',
};

function rel(iso: string | null): string {
  if (!iso) return 'never';
  try {
    return formatDistanceToNowStrict(new Date(iso), { addSuffix: true });
  } catch {
    return '—';
  }
}

function dur(ms: number | null): string {
  return ms == null ? '—' : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function SystemSyncActivityTab() {
  const summary = useCronRunsSummary();
  const [jobFilter, setJobFilter] = useState<string | null>(null);
  const list = useCronRunsList({ job: jobFilter });
  const queryClient = useQueryClient();
  const [running, setRunning] = useState<string | null>(null);

  const runNow = async (job: string) => {
    setRunning(job);
    try {
      await fetch(`/api/cron-runs/run?job=${encodeURIComponent(job)}`, { method: 'POST' });
      await queryClient.invalidateQueries({ queryKey: cronRunsKeys.all });
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 px-6 py-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-black tracking-tight text-text-default">
            <Activity className="h-5 w-5 text-text-faint" /> System sync activity
          </h1>
          <p className="mt-0.5 text-caption text-text-soft">
            Cron health, last runs, and history across every scheduled job.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          icon={<RefreshCw />}
          onClick={() => queryClient.invalidateQueries({ queryKey: cronRunsKeys.all })}
        >
          Refresh
        </Button>
      </header>

      {/* Health cards */}
      {summary.isLoading ? (
        <div className="flex items-center gap-2 p-8 text-caption text-text-faint">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading jobs…
        </div>
      ) : summary.isError || !summary.data ? (
        <div className="p-8 text-caption text-rose-600">Failed to load sync status.</div>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {summary.data.jobs.map((j) => (
            <JobCard
              key={j.job}
              job={j}
              active={jobFilter === j.job}
              running={running === j.job}
              onSelect={() => setJobFilter((p) => (p === j.job ? null : j.job))}
              onRun={() => runNow(j.job)}
            />
          ))}
        </div>
      )}

      {/* Run history */}
      <section className="rounded-2xl bg-surface-card shadow-sm ring-1 ring-border-soft/60">
        <header className="flex items-center justify-between px-5 py-4">
          <h3 className="text-eyebrow font-black uppercase tracking-[0.14em] text-text-soft">
            Run history {jobFilter ? `· ${jobFilter}` : ''}
          </h3>
          {jobFilter && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setJobFilter(null)}
              className="text-blue-600 hover:underline"
            >
              Clear filter
            </Button>
          )}
        </header>
        {list.isLoading ? (
          <div className="flex items-center gap-2 border-t border-border-hairline px-5 py-4 text-caption text-text-faint">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : !list.data || list.data.runs.length === 0 ? (
          <p className="border-t border-border-hairline px-5 py-3 text-caption text-text-faint">No runs recorded yet.</p>
        ) : (
          <ul className="border-t border-border-hairline divide-y divide-border-hairline">
            {list.data.runs.map((r) => (
              <RunRow key={r.id} run={r} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function JobCard({
  job,
  active,
  running,
  onSelect,
  onRun,
}: {
  job: CronJobStatus;
  active: boolean;
  running: boolean;
  onSelect: () => void;
  onRun: () => void;
}) {
  const last = job.lastRun;
  return (
    <div
      className={`rounded-xl bg-surface-card p-3 shadow-sm ring-1 transition ${
        active ? 'ring-blue-300' : 'ring-border-soft/60 hover:ring-border-default'
      }`}
    >
      <div className="flex items-start gap-2">
        <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${DOT[job.health]}`} aria-hidden />
        {/* ds-raw-button: text-left multi-line master-detail select row (label + schedule meta) */}
        <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
          <div className="truncate text-label font-bold text-text-default">{job.label}</div>
          <div className="truncate text-mini text-text-soft">
            {job.schedule ?? 'unscheduled'} · {rel(last?.finishedAt ?? last?.startedAt ?? null)}
          </div>
        </button>
        <HoverTooltip label="Run now" asChild>
          <IconButton
            icon={running ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            onClick={onRun}
            disabled={running}
            ariaLabel="Run now"
            className="shrink-0 rounded-md p-1.5 hover:bg-surface-sunken"
          />
        </HoverTooltip>
      </div>
      {job.health === 'failed' && last?.error ? (
        // ds-allow-title: truncation-reveal of the full error on a non-interactive line
        <div className="mt-1.5 truncate text-mini text-rose-600" title={last.error}>
          {last.error}
        </div>
      ) : null}
    </div>
  );
}

function RunRow({ run }: { run: CronRunRow }) {
  const [open, setOpen] = useState(false);
  const hasDetail = !!run.error || (!!run.summary && typeof run.summary === 'object');
  return (
    <li className="px-5 py-2.5">
      {/* ds-raw-button: text-left master-detail expander row (status chip + job + meta) */}
      <button
        type="button"
        onClick={() => hasDetail && setOpen((o) => !o)}
        className="flex w-full items-center gap-3 text-left"
      >
        <span className={`rounded-full px-1.5 py-0.5 text-mini font-bold ${syncRunStatusChipClass(run.status)}`}>
          {run.status}
        </span>
        <span className="min-w-0 flex-1 truncate text-label font-bold text-text-default">{run.job}</span>
        {run.trigger === 'manual' && (
          <span className="shrink-0 rounded bg-surface-sunken px-1.5 py-0.5 text-mini font-bold text-text-soft">manual</span>
        )}
        <span className="shrink-0 text-mini tabular-nums text-text-faint">{dur(run.duration_ms)}</span>
        <span className="shrink-0 text-mini tabular-nums text-text-faint">{rel(run.started_at)}</span>
      </button>
      {open && hasDetail && (
        <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-surface-canvas p-2.5 text-mini text-text-muted">
          {run.error ? `ERROR: ${run.error}\n` : ''}
          {run.summary && typeof run.summary === 'object' ? JSON.stringify(run.summary, null, 2) : ''}
        </pre>
      )}
    </li>
  );
}
