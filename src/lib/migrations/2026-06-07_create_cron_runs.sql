-- 2026-06-07 Cron run history
-- One row per cron/job invocation. Written by withCronRun() (src/lib/cron/run-log.ts).
-- Powers the header "sync status" popover and the admin System sync activity tab.

CREATE TABLE IF NOT EXISTS cron_runs (
  id           BIGSERIAL PRIMARY KEY,
  job          TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
  trigger      TEXT NOT NULL DEFAULT 'cron' CHECK (trigger IN ('cron', 'manual')),
  started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at  TIMESTAMPTZ,
  duration_ms  INTEGER,
  summary      JSONB,
  error        TEXT
);

-- Latest-run-per-job + per-job history both read (job, started_at DESC).
CREATE INDEX IF NOT EXISTS idx_cron_runs_job_started ON cron_runs(job, started_at DESC);
-- Global recent feed.
CREATE INDEX IF NOT EXISTS idx_cron_runs_started ON cron_runs(started_at DESC);
