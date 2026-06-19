-- Migration: Split share pack access/links + photo_exports foundation
-- Date: 2026-06-19
-- docs/photos-platform-plan.md §21.2, §21.7

BEGIN;

-- ─── photo_share_pack_access: tokens, expiry, revocation ───────────────────
CREATE TABLE IF NOT EXISTS photo_share_pack_access (
  id              BIGSERIAL PRIMARY KEY,
  pack_id         BIGINT NOT NULL REFERENCES photo_share_packs(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL,
  public_token    TEXT NOT NULL UNIQUE,
  expires_at      TIMESTAMPTZ,
  password_hash   TEXT,
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_photo_share_pack_access_pack
  ON photo_share_pack_access (pack_id);

CREATE INDEX IF NOT EXISTS idx_photo_share_pack_access_org
  ON photo_share_pack_access (organization_id, created_at DESC);

-- ─── photo_share_pack_links: external associations ─────────────────────────
CREATE TABLE IF NOT EXISTS photo_share_pack_links (
  id              BIGSERIAL PRIMARY KEY,
  pack_id         BIGINT NOT NULL REFERENCES photo_share_packs(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL,
  link_type       TEXT NOT NULL,
  external_id     TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_photo_share_pack_link_type
    CHECK (link_type IN ('receiving_id', 'po_ref', 'zendesk_ticket_id')),
  CONSTRAINT ux_photo_share_pack_links_unique
    UNIQUE (pack_id, link_type, external_id)
);

CREATE INDEX IF NOT EXISTS idx_photo_share_pack_links_lookup
  ON photo_share_pack_links (organization_id, link_type, external_id);

-- Backfill access rows from legacy pack columns
INSERT INTO photo_share_pack_access (pack_id, organization_id, public_token, expires_at, password_hash)
SELECT p.id, p.organization_id, p.public_token, p.expires_at, p.password_hash
FROM photo_share_packs p
WHERE NOT EXISTS (
  SELECT 1 FROM photo_share_pack_access a WHERE a.pack_id = p.id
);

-- Backfill link rows
INSERT INTO photo_share_pack_links (pack_id, organization_id, link_type, external_id)
SELECT p.id, p.organization_id, 'receiving_id', p.receiving_id::text
FROM photo_share_packs p
WHERE p.receiving_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO photo_share_pack_links (pack_id, organization_id, link_type, external_id)
SELECT p.id, p.organization_id, 'po_ref', p.po_ref
FROM photo_share_packs p
WHERE p.po_ref IS NOT NULL AND TRIM(p.po_ref) <> ''
ON CONFLICT DO NOTHING;

INSERT INTO photo_share_pack_links (pack_id, organization_id, link_type, external_id)
SELECT p.id, p.organization_id, 'zendesk_ticket_id', p.zendesk_ticket_id::text
FROM photo_share_packs p
WHERE p.zendesk_ticket_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- ─── photo_exports: external push records (Google Drive / Photos) ───────────
CREATE TABLE IF NOT EXISTS photo_exports (
  id              BIGSERIAL PRIMARY KEY,
  photo_id        BIGINT REFERENCES photos(id) ON DELETE CASCADE,
  share_pack_id   BIGINT REFERENCES photo_share_packs(id) ON DELETE SET NULL,
  organization_id UUID NOT NULL,
  provider        TEXT NOT NULL,
  external_id     TEXT,
  external_url    TEXT,
  exported_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  provider_meta   JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT chk_photo_exports_provider
    CHECK (provider IN ('google_photos', 'google_drive'))
);

CREATE INDEX IF NOT EXISTS idx_photo_exports_photo
  ON photo_exports (photo_id);

CREATE INDEX IF NOT EXISTS idx_photo_exports_pack
  ON photo_exports (share_pack_id)
  WHERE share_pack_id IS NOT NULL;

COMMIT;
