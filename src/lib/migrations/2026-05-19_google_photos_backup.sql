-- Migration: Google Photos backup support
-- Date: 2026-05-19
-- Adds columns to photos table for tracking Google Photos uploads, and
-- creates a google_oauth_tokens table to hold the admin's refresh token.
-- Service accounts cannot access Google Photos, so we use 3-legged OAuth
-- and persist the refresh token here. There is intentionally at most one
-- active row at a time (singleton pattern).

BEGIN;

ALTER TABLE photos
  ADD COLUMN IF NOT EXISTS google_photos_id      TEXT,
  ADD COLUMN IF NOT EXISTS google_product_url    TEXT,
  ADD COLUMN IF NOT EXISTS google_album_id       TEXT,
  ADD COLUMN IF NOT EXISTS google_filename       TEXT,
  ADD COLUMN IF NOT EXISTS uploaded_to_google_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_photos_google_pending
  ON photos (created_at)
  WHERE google_photos_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_photos_google_album
  ON photos (google_album_id)
  WHERE google_album_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS google_oauth_tokens (
  id              SERIAL PRIMARY KEY,
  provider        TEXT NOT NULL,
  account_email   TEXT,
  scope           TEXT NOT NULL,
  refresh_token   TEXT NOT NULL,
  access_token    TEXT,
  expires_at      TIMESTAMPTZ,
  connected_by_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_google_oauth_provider
    CHECK (provider IN ('google_photos'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_google_oauth_provider
  ON google_oauth_tokens (provider);

CREATE OR REPLACE FUNCTION fn_set_google_oauth_tokens_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_google_oauth_tokens_set_updated_at ON google_oauth_tokens;
CREATE TRIGGER trg_google_oauth_tokens_set_updated_at
BEFORE UPDATE ON google_oauth_tokens
FOR EACH ROW EXECUTE FUNCTION fn_set_google_oauth_tokens_updated_at();

CREATE TABLE IF NOT EXISTS google_photos_albums (
  id             SERIAL PRIMARY KEY,
  album_key      TEXT NOT NULL,
  google_album_id TEXT NOT NULL,
  title          TEXT NOT NULL,
  product_url    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_google_photos_albums_key
  ON google_photos_albums (album_key);

COMMIT;
