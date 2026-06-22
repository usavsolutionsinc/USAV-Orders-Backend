'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNowStrict } from 'date-fns';
import { Loader2, RefreshCw, Play, Activity } from '@/components/Icons';
import { useCronRunsSummary, useCronRunsList } from '@/hooks/useCronRuns';
import { cronRunsKeys, type JobHealth, type CronJobStatus, type CronRunRow } from '@/lib/queries/cron-runs-queries';
import { syncRunStatusChipClass } from '@/lib/sync-run-status';

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
  never: 'bg-gray-300',
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
          <h1 className="flex items-center gap-2 text-xl font-black tracking-tight text-gray-900">
            <Activity className="h-5 w-5 text-gray-400" /> System sync activity
          </h1>
          <p className="mt-0.5 text-caption text-gray-500">
            Cron health, last runs, and history across every scheduled job.
          </p>
        </div>
        <button
          type="button"
          onClick={() => queryClient.invalidateQueries({ queryKey: cronRunsKeys.all })}
          className="flex items-center gap-1.5 rounded-md border border-gray-200 px-2.5 py-1.5 text-caption font-bold text-gray-600 hover:bg-gray-50"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </header>

      {/* Health cards */}
      {summary.isLoading ? (
        <div className="flex items-center gap-2 p-8 text-caption text-gray-400">
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
      <section className="rounded-2xl bg-white shadow-sm ring-1 ring-gray-200/60">
        <header className="flex items-center justify-between px-5 py-4">
          <h3 className="text-eyebrow font-black uppercase tracking-[0.14em] text-gray-500">
            Run history {jobFilter ? `· ${jobFilter}` : ''}
          </h3>
          {jobFilter && (
            <button
              type="button"
              onClick={() => setJobFilter(null)}
              className="text-mini font-bold text-blue-600 hover:underline"
            >
              Clear filter
            </button>
          )}
        </header>
        {list.isLoading ? (
          <div className="flex items-center gap-2 border-t border-gray-100 px-5 py-4 text-caption text-gray-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : !list.data || list.data.runs.length === 0 ? (
          <p className="border-t border-gray-100 px-5 py-3 text-caption text-gray-400">No runs recorded yet.</p>
        ) : (
          <ul className="border-t border-gray-100 divide-y divide-gray-100">
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
      className={`rounded-xl bg-white p-3 shadow-sm ring-1 transition ${
        active ? 'ring-blue-300' : 'ring-gray-200/60 hover:ring-gray-300'
      }`}
    >
      <div className="flex items-start gap-2">
        <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${DOT[job.health]}`} aria-hidden />
        <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
          <div className="truncate text-label font-bold text-gray-900">{job.label}</div>
          <div className="truncate text-mini text-gray-500">
            {job.schedule ?? 'unscheduled'} · {rel(last?.finishedAt ?? last?.startedAt ?? null)}
          </div>
        </button>
        <button
          type="button"
          onClick={onRun}
          disabled={running}
          title="Run now"
          className="shrink-0 rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
        >
          {running ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
        </button>
      </div>
      {job.health === 'failed' && last?.error ? (
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
      <button
        type="button"
        onClick={() => hasDetail && setOpen((o) => !o)}
        className="flex w-full items-center gap-3 text-left"
      >
        <span className={`rounded-full px-1.5 py-0.5 text-mini font-bold ${syncRunStatusChipClass(run.status)}`}>
          {run.status}
        </span>
        <span className="min-w-0 flex-1 truncate text-label font-bold text-gray-800">{run.job}</span>
        {run.trigger === 'manual' && (
          <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-mini font-bold text-gray-500">manual</span>
        )}
        <span className="shrink-0 text-mini tabular-nums text-gray-400">{dur(run.duration_ms)}</span>
        <span className="shrink-0 text-mini tabular-nums text-gray-400">{rel(run.started_at)}</span>
      </button>
      {open && hasDetail && (
        <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-gray-50 p-2.5 text-mini text-gray-600">
          {run.error ? `ERROR: ${run.error}\n` : ''}
          {run.summary && typeof run.summary === 'object' ? JSON.stringify(run.summary, null, 2) : ''}
        </pre>
      )}
    </li>
  );
}
