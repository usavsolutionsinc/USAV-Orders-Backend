/**
 * GET /api/cron-runs            — admin observability for cron/job runs.
 *
 *   ?view=summary  (default) → latest run per job, merged with the registry
 *                              (incl. never-run jobs) + computed health +
 *                              an aggregate health roll-up. Powers the header.
 *   ?view=list&job=&status=&limit=&offset=  → paginated run history. Powers
 *                              the admin tab.
 *
 * Gated by `admin.view`.
 */

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import {
  CRON_JOBS,
  CRON_JOBS_BY_KEY,
  computeHealth,
  aggregateHealth,
  type JobHealth,
} from '@/lib/cron/registry';

export const dynamic = 'force-dynamic';

interface LatestRow {
  job: string;
  status: 'running' | 'success' | 'failed';
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  summary: unknown;
  error: string | null;
}

async function summaryView() {
  const { rows } = await pool.query<LatestRow>(
    `SELECT DISTINCT ON (job)
            job, status, started_at, finished_at, duration_ms, summary, error
       FROM cron_runs
      ORDER BY job, started_at DESC`,
  );
  const latestByJob = new Map(rows.map((r) => [r.job, r]));

  // Union of registry jobs + any job that has runs but isn't registered.
  const jobKeys = new Set<string>([...CRON_JOBS.map((j) => j.job), ...latestByJob.keys()]);

  const jobs = [...jobKeys].map((job) => {
    const def = CRON_JOBS_BY_KEY[job];
    const latest = latestByJob.get(job) ?? null;
    const health: JobHealth = computeHealth(
      def,
      latest ? { status: latest.status, finishedAt: latest.finished_at } : null,
    );
    return {
      job,
      label: def?.label ?? job,
      category: def?.category ?? 'System',
      schedule: def?.schedule ?? null,
      health,
      lastRun: latest
        ? {
            status: latest.status,
            startedAt: latest.started_at,
            finishedAt: latest.finished_at,
            durationMs: latest.duration_ms,
            summary: latest.summary,
            error: latest.error,
          }
        : null,
    };
  });

  // Stable order: failed → stale → never → running → ok, then by label.
  const sevRank: Record<JobHealth, number> = { failed: 0, stale: 1, never: 2, running: 3, ok: 4 };
  jobs.sort((a, b) => sevRank[a.health] - sevRank[b.health] || a.label.localeCompare(b.label));

  return {
    ok: true,
    health: aggregateHealth(jobs.map((j) => j.health)),
    counts: {
      total: jobs.length,
      failed: jobs.filter((j) => j.health === 'failed').length,
      stale: jobs.filter((j) => j.health === 'stale').length,
    },
    jobs,
  };
}

async function listView(url: URL) {
  const job = url.searchParams.get('job')?.trim() || null;
  const status = url.searchParams.get('status')?.trim() || null;
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 200);
  const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);

  const { rows } = await pool.query(
    `SELECT id, job, status, trigger, started_at, finished_at, duration_ms, summary, error
       FROM cron_runs
      WHERE ($1::text IS NULL OR job = $1)
        AND ($2::text IS NULL OR status = $2)
      ORDER BY started_at DESC
      LIMIT $3 OFFSET $4`,
    [job, status, limit, offset],
  );
  return { ok: true, runs: rows, limit, offset };
}

export const GET = withAuth(
  async (req: NextRequest) => {
    const url = new URL(req.url);
    try {
      const view = url.searchParams.get('view') || 'summary';
      return NextResponse.json(view === 'list' ? await listView(url) : await summaryView());
    } catch (error) {
      const message = error instanceof Error ? error.message : 'cron-runs query failed';
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  },
  { permission: 'admin.view' },
);
