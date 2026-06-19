-- Migration: Photos platform side tables (GCS-backed storage catalog)
-- Date: 2026-06-18
-- docs/photos-platform-plan.md — Phase A dual-write foundation.
-- Legacy photos.entity_type / entity_id / url remain until Phase D backfill.

BEGIN;

-- ─── photos: search denorm ──────────────────────────────────────────────────
ALTER TABLE photos
  ADD COLUMN IF NOT EXISTS po_ref TEXT;

CREATE INDEX IF NOT EXISTS idx_photos_org_po_ref
  ON photos (organization_id, po_ref)
  WHERE po_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_photos_org_created
  ON photos (organization_id, created_at DESC);

-- ─── photo_entity_links: single hub for all relationships ─────────────────
CREATE TABLE IF NOT EXISTS photo_entity_links (
  id              BIGSERIAL PRIMARY KEY,
  photo_id        BIGINT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL,
  entity_type     TEXT NOT NULL,
  entity_id       BIGINT NOT NULL,
  link_role       TEXT NOT NULL DEFAULT 'primary',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_photo_entity_links_entity_type
    CHECK (entity_type IN (
      'RECEIVING', 'RECEIVING_LINE', 'PACKER_LOG', 'SERIAL_UNIT',
      'SKU', 'SKU_STOCK', 'BIN_ADJUSTMENT',
      'SHARE_PACK', 'ZENDESK_TICKET'
    )),
  CONSTRAINT chk_photo_entity_links_link_role
    CHECK (link_role IN ('primary', 'claim_evidence', 'insurance_share')),
  CONSTRAINT ux_photo_entity_links_unique
    UNIQUE (photo_id, entity_type, entity_id, link_role)
);

CREATE INDEX IF NOT EXISTS idx_photo_entity_links_entity
  ON photo_entity_links (organization_id, entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_photo_entity_links_photo
  ON photo_entity_links (photo_id);

-- Backfill primary links from legacy photos.entity_type / entity_id
INSERT INTO photo_entity_links (photo_id, organization_id, entity_type, entity_id, link_role)
SELECT p.id, p.organization_id, p.entity_type, p.entity_id, 'primary'
FROM photos p
WHERE p.entity_type IS NOT NULL
  AND p.entity_id IS NOT NULL
  AND p.organization_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- ─── photo_storage: 1..N storage locators per photo ───────────────────────
CREATE TABLE IF NOT EXISTS photo_storage (
  id                BIGSERIAL PRIMARY KEY,
  photo_id          BIGINT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  organization_id   UUID NOT NULL,
  provider          TEXT NOT NULL,
  bucket            TEXT,
  object_key        TEXT NOT NULL,
  thumb_object_key  TEXT,
  content_type      TEXT DEFAULT 'image/jpeg',
  file_size_bytes   INTEGER,
  sha256_hex        TEXT,
  legacy_url        TEXT,
  provider_meta     JSONB NOT NULL DEFAULT '{}',
  is_primary        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_photo_storage_provider
    CHECK (provider IN (
      'gcs', 'vercel_blob', 'nas', 'legacy_url', 's3', 'r2', 'google_drive'
    ))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_photo_storage_primary
  ON photo_storage (photo_id)
  WHERE is_primary = TRUE;

CREATE INDEX IF NOT EXISTS idx_photo_storage_org_provider
  ON photo_storage (organization_id, provider);

CREATE INDEX IF NOT EXISTS idx_photo_storage_object
  ON photo_storage (provider, bucket, object_key);

-- ─── photo_storage_providers: per-org backend config ───────────────────────
CREATE TABLE IF NOT EXISTS photo_storage_providers (
  id                SERIAL PRIMARY KEY,
  organization_id   UUID NOT NULL,
  provider          TEXT NOT NULL,
  is_default        BOOLEAN NOT NULL DEFAULT FALSE,
  config            JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_photo_storage_providers_provider
    CHECK (provider IN ('gcs', 'vercel_blob', 'nas', 's3', 'r2', 'google_drive'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_photo_storage_providers_org_provider
  ON photo_storage_providers (organization_id, provider);

CREATE UNIQUE INDEX IF NOT EXISTS ux_photo_storage_providers_org_default
  ON photo_storage_providers (organization_id)
  WHERE is_default = TRUE;

-- ─── photo_analysis: 1:1 enrichment ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS photo_analysis (
  id              BIGSERIAL PRIMARY KEY,
  photo_id        BIGINT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL,
  model           TEXT NOT NULL,
  analyzed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata        JSONB NOT NULL DEFAULT '{}',
  error_message   TEXT,
  CONSTRAINT ux_photo_analysis_photo UNIQUE (photo_id)
);

CREATE INDEX IF NOT EXISTS idx_photo_analysis_org_analyzed
  ON photo_analysis (organization_id, analyzed_at DESC);

CREATE INDEX IF NOT EXISTS idx_photo_analysis_metadata_gin
  ON photo_analysis USING GIN (metadata);

-- ─── photo_jobs: async analyze / mirror / export ───────────────────────────
CREATE TABLE IF NOT EXISTS photo_jobs (
  id              BIGSERIAL PRIMARY KEY,
  photo_id        BIGINT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL,
  job_type        TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  scheduled_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  CONSTRAINT chk_photo_jobs_type
    CHECK (job_type IN ('analyze', 'nas_mirror', 'export_drive')),
  CONSTRAINT chk_photo_jobs_status
    CHECK (status IN ('pending', 'running', 'completed', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_photo_jobs_pending
  ON photo_jobs (status, scheduled_at)
  WHERE status IN ('pending', 'running');

-- ─── photo_share_packs ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS photo_share_packs (
  id              BIGSERIAL PRIMARY KEY,
  organization_id UUID NOT NULL,
  public_token    TEXT NOT NULL UNIQUE,
  title           TEXT NOT NULL,
  pack_type       TEXT NOT NULL DEFAULT 'manual',
  po_ref          TEXT,
  receiving_id    INTEGER,
  zendesk_ticket_id BIGINT,
  created_by_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  expires_at      TIMESTAMPTZ,
  password_hash   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_photo_share_pack_type
    CHECK (pack_type IN ('manual', 'claim', 'customer'))
);

CREATE INDEX IF NOT EXISTS idx_photo_share_packs_org_created
  ON photo_share_packs (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_photo_share_packs_po
  ON photo_share_packs (organization_id, po_ref)
  WHERE po_ref IS NOT NULL;

-- ─── photo_share_pack_items ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS photo_share_pack_items (
  id              BIGSERIAL PRIMARY KEY,
  pack_id         BIGINT NOT NULL REFERENCES photo_share_packs(id) ON DELETE CASCADE,
  photo_id        BIGINT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  sort_order      SMALLINT NOT NULL DEFAULT 0,
  export_filename TEXT,
  CONSTRAINT ux_photo_share_pack_item UNIQUE (pack_id, photo_id)
);

COMMIT;
