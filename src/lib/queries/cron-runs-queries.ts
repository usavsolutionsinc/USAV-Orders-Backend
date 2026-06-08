import { queryOptions } from '@tanstack/react-query';
import type { JobHealth } from '@/lib/cron/registry';

export type { JobHealth } from '@/lib/cron/registry';

export interface CronRunSummary {
  status: 'running' | 'success' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  summary: unknown;
  error: string | null;
}

export interface CronJobStatus {
  job: string;
  label: string;
  category: string;
  schedule: string | null;
  health: JobHealth;
  lastRun: CronRunSummary | null;
}

export interface CronRunsSummaryResp {
  ok: boolean;
  health: 'ok' | 'stale' | 'failed';
  counts: { total: number; failed: number; stale: number };
  jobs: CronJobStatus[];
}

export interface CronRunRow {
  id: number;
  job: string;
  status: 'running' | 'success' | 'failed';
  trigger: 'cron' | 'manual';
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  summary: unknown;
  error: string | null;
}

export interface CronRunsListResp {
  ok: boolean;
  runs: CronRunRow[];
  limit: number;
  offset: number;
}

export const cronRunsKeys = {
  all: ['cron-runs'] as const,
  summary: () => ['cron-runs', 'summary'] as const,
  list: (job: string | null, status: string | null, offset: number) =>
    ['cron-runs', 'list', job, status, offset] as const,
};

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) throw new Error(json?.error || `HTTP ${res.status}`);
  return json as T;
}

export function cronRunsSummaryQuery() {
  return queryOptions({
    queryKey: cronRunsKeys.summary(),
    queryFn: () => fetchJson<CronRunsSummaryResp>('/api/cron-runs?view=summary'),
    staleTime: 20_000,
    refetchInterval: 30_000,
  });
}

export function cronRunsListQuery(opts: { job?: string | null; status?: string | null; offset?: number } = {}) {
  const job = opts.job ?? null;
  const status = opts.status ?? null;
  const offset = opts.offset ?? 0;
  const params = new URLSearchParams({ view: 'list', limit: '50', offset: String(offset) });
  if (job) params.set('job', job);
  if (status) params.set('status', status);
  return queryOptions({
    queryKey: cronRunsKeys.list(job, status, offset),
    queryFn: () => fetchJson<CronRunsListResp>(`/api/cron-runs?${params.toString()}`),
    staleTime: 15_000,
  });
}
