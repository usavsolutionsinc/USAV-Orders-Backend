-- Migration: Google Photos Tier 4 — auto-delete from Vercel Blob,
-- settings singleton, backup-run history.
-- Date: 2026-05-19

BEGIN;

-- ─── 1. photos: track when the original blob was deleted ────────────────────
ALTER TABLE photos
  ADD COLUMN IF NOT EXISTS deleted_from_blob_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_photos_blob_cleanup_candidate
  ON photos (uploaded_to_google_at)
  WHERE google_photos_id IS NOT NULL AND deleted_from_blob_at IS NULL;

-- ─── 2. Settings singleton ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS google_photos_settings (
  id                       SMALLINT PRIMARY KEY DEFAULT 1,
  auto_delete_enabled      BOOLEAN     NOT NULL DEFAULT FALSE,
  auto_delete_after_days   SMALLINT    NOT NULL DEFAULT 30,
  last_cron_run_at         TIMESTAMPTZ,
  last_cron_summary        JSONB,
  needs_reconnect          BOOLEAN     NOT NULL DEFAULT FALSE,
  needs_reconnect_reason   TEXT,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_google_photos_settings_singleton CHECK (id = 1),
  CONSTRAINT chk_google_photos_settings_days CHECK (auto_delete_after_days BETWEEN 1 AND 365)
);

INSERT INTO google_photos_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION fn_set_google_photos_settings_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_google_photos_settings_set_updated_at ON google_photos_settings;
CREATE TRIGGER trg_google_photos_settings_set_updated_at
BEFORE UPDATE ON google_photos_settings
FOR EACH ROW EXECUTE FUNCTION fn_set_google_photos_settings_updated_at();

-- ─── 3. Run history ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS google_photos_backup_runs (
  id              BIGSERIAL PRIMARY KEY,
  source          TEXT        NOT NULL,
  date            DATE,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at        TIMESTAMPTZ,
  scanned         INTEGER     NOT NULL DEFAULT 0,
  uploaded        INTEGER     NOT NULL DEFAULT 0,
  failed          INTEGER     NOT NULL DEFAULT 0,
  blob_deleted    INTEGER     NOT NULL DEFAULT 0,
  triggered_by_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  error_summary   TEXT,
  CONSTRAINT chk_google_photos_runs_source CHECK (source IN ('manual', 'manual_stream', 'cron'))
);

CREATE INDEX IF NOT EXISTS idx_google_photos_runs_recent
  ON google_photos_backup_runs (started_at DESC);

COMMIT;
