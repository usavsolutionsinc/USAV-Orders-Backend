-- ============================================================
-- AI Training Pipeline Tables
-- Created: 2026-03-28
--
-- Creates 5 tables and 3 enums for the self-improving code pipeline.
-- Safe to re-run: uses IF NOT EXISTS on everything.
-- ============================================================

-- Enums
DO $$ BEGIN
  CREATE TYPE training_sample_status AS ENUM ('raw', 'rated', 'queued', 'trained', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE pipeline_task_source AS ENUM ('typecheck', 'lint', 'test_failure', 'todo_comment', 'manual');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE training_run_status AS ENUM ('pending', 'running', 'completed', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 1. training_samples — raw + rated training pairs from pipeline, commits, chat
CREATE TABLE IF NOT EXISTS training_samples (
  id              SERIAL PRIMARY KEY,
  instruction     TEXT NOT NULL,
  input_context   TEXT,
  output          TEXT NOT NULL,
  source          VARCHAR(50) NOT NULL,
  repo            VARCHAR(200),
  file_paths      JSONB,
  commit_sha      VARCHAR(40),
  status          training_sample_status NOT NULL DEFAULT 'raw',
  rating          INTEGER,
  auto_score      NUMERIC,
  tests_pass      BOOLEAN,
  training_run_id INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rated_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS training_samples_status_idx  ON training_samples (status);
CREATE INDEX IF NOT EXISTS training_samples_rating_idx  ON training_samples (rating);

-- 2. training_runs — fine-tuning job records
CREATE TABLE IF NOT EXISTS training_runs (
  id               SERIAL PRIMARY KEY,
  base_model       VARCHAR(200) NOT NULL,
  adapter_name     VARCHAR(200),
  lora_rank        INTEGER DEFAULT 16,
  learning_rate    NUMERIC DEFAULT 0.0002,
  epochs           INTEGER DEFAULT 3,
  sample_count     INTEGER,
  status           training_run_status NOT NULL DEFAULT 'pending',
  train_loss       NUMERIC,
  eval_loss        NUMERIC,
  duration_seconds INTEGER,
  adapter_path     TEXT,
  device_id        VARCHAR(50),
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  error_log        TEXT
);

-- 3. model_versions — registered adapters with promotion flag
CREATE TABLE IF NOT EXISTS model_versions (
  id           SERIAL PRIMARY KEY,
  run_id       INTEGER REFERENCES training_runs(id),
  version      VARCHAR(50) NOT NULL,
  base_model   VARCHAR(200) NOT NULL,
  adapter_path TEXT NOT NULL,
  eval_score   NUMERIC,
  promoted     BOOLEAN NOT NULL DEFAULT FALSE,
  promoted_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. pipeline_tasks — discovered tasks with dedup and retry tracking
CREATE TABLE IF NOT EXISTS pipeline_tasks (
  id              SERIAL PRIMARY KEY,
  task_hash       VARCHAR(16) NOT NULL UNIQUE,
  title           VARCHAR(300) NOT NULL,
  source          pipeline_task_source NOT NULL,
  description     TEXT NOT NULL,
  file_paths      JSONB NOT NULL,
  context         TEXT,
  priority        INTEGER NOT NULL DEFAULT 3,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending',
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  resolved_at     TIMESTAMPTZ,
  result_branch   VARCHAR(200),
  result_rating   INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pipeline_tasks_status_idx   ON pipeline_tasks (status);
CREATE INDEX IF NOT EXISTS pipeline_tasks_priority_idx ON pipeline_tasks (priority);

-- 5. pipeline_cycles — per-cycle execution metrics
CREATE TABLE IF NOT EXISTS pipeline_cycles (
  id                SERIAL PRIMARY KEY,
  tasks_discovered  INTEGER NOT NULL DEFAULT 0,
  tasks_attempted   INTEGER NOT NULL DEFAULT 0,
  tasks_passed      INTEGER NOT NULL DEFAULT 0,
  tasks_failed      INTEGER NOT NULL DEFAULT 0,
  samples_collected INTEGER NOT NULL DEFAULT 0,
  duration_seconds  INTEGER,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ
);

-- FK from training_samples back to training_runs (deferred to avoid ordering issues)
DO $$ BEGIN
  ALTER TABLE training_samples
    ADD CONSTRAINT training_samples_run_fk
    FOREIGN KEY (training_run_id) REFERENCES training_runs(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
