-- Canonical copy of the hermes-usav migration.
-- The sibling repo at ~/Desktop/my-express-app/hermes-usav owns the source of
-- truth in its migrations/ dir; this file mirrors it so the main repo's
-- migration runner can apply it via the standard flow.

BEGIN;

CREATE TABLE IF NOT EXISTS hermes_insights (
  id            BIGSERIAL PRIMARY KEY,
  job_key       TEXT NOT NULL,
  category      TEXT NOT NULL,
  importance    REAL NOT NULL CHECK (importance BETWEEN 0 AND 1),
  payload       JSONB NOT NULL,
  narrative     TEXT NOT NULL,
  pacific_date  DATE NOT NULL,
  emitted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  suppressed    BOOLEAN NOT NULL DEFAULT FALSE,
  model_name    TEXT,
  session_id    TEXT
);
CREATE INDEX IF NOT EXISTS idx_hermes_insights_pacific_date
  ON hermes_insights (pacific_date DESC);
CREATE INDEX IF NOT EXISTS idx_hermes_insights_job_cat
  ON hermes_insights (job_key, category, emitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_hermes_insights_unsuppressed
  ON hermes_insights (emitted_at DESC) WHERE suppressed = FALSE;

CREATE TABLE IF NOT EXISTS hermes_outcomes (
  id            BIGSERIAL PRIMARY KEY,
  insight_id    BIGINT NOT NULL REFERENCES hermes_insights(id) ON DELETE CASCADE,
  signal_type   TEXT NOT NULL,
  signal_value  REAL,
  ground_truth  JSONB,
  observed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hermes_outcomes_insight
  ON hermes_outcomes (insight_id);

CREATE TABLE IF NOT EXISTS hermes_precision_scores (
  job_key          TEXT NOT NULL,
  category         TEXT NOT NULL,
  samples          INTEGER NOT NULL DEFAULT 0,
  true_positives   INTEGER NOT NULL DEFAULT 0,
  false_positives  INTEGER NOT NULL DEFAULT 0,
  current_score    REAL    NOT NULL DEFAULT 0.5,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (job_key, category)
);

CREATE TABLE IF NOT EXISTS hermes_thresholds (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO hermes_thresholds (key, value) VALUES
  ('sales.wow_drop.z_score_bar',      '1.5'::jsonb),
  ('throughput.atRisk.deficit_pct',   '0.15'::jsonb),
  ('sku.reorder.days_of_cover_bar',   '7'::jsonb),
  ('exception.rate_spike.multiplier', '2.0'::jsonb),
  ('reflection.suppression_cutoff',   '0.35'::jsonb),
  ('reflection.laplace_alpha',        '1'::jsonb),
  ('reflection.laplace_beta',         '2'::jsonb)
ON CONFLICT (key) DO NOTHING;

COMMIT;
