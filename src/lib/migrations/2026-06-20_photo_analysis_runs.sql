-- Migration: photo_analysis_runs — history of re-analyze passes (Phase 6)
-- Latest enrichment remains on photo_analysis (1:1). Each re-run archives the prior row here.

CREATE TABLE IF NOT EXISTS photo_analysis_runs (
  id              BIGSERIAL PRIMARY KEY,
  photo_id        BIGINT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL,
  model           TEXT NOT NULL,
  metadata        JSONB NOT NULL DEFAULT '{}',
  analyzed_at     TIMESTAMPTZ NOT NULL,
  archived_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  job_id          BIGINT REFERENCES photo_jobs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_photo_analysis_runs_photo
  ON photo_analysis_runs (photo_id, archived_at DESC);

CREATE INDEX IF NOT EXISTS idx_photo_analysis_runs_org
  ON photo_analysis_runs (organization_id, archived_at DESC);
