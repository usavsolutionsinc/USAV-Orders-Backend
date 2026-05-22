-- ============================================================================
-- 2026-05-25: SKU pairing hub foundations
-- ============================================================================
-- Schema groundwork for the Product Hub pairing surface on /products.
--
--   1. pg_trgm extension — title-similarity ranking for the suggestion engine
--   2. sku_platform_ids: per-listing metadata (title, url, status, confidence,
--      paired_by/at) so every platform can carry the same data Ecwid already
--      does, and pairing decisions are auditable
--   3. sku_pairing_suggestions — materialized output of the suggestion engine,
--      refreshed by a notification cron (writes ONLY here, never to mappings)
--   4. sku_pairing_audit — every accept / reject / unpair logged for trust
--   5. Backfill sku_catalog_id where platform_sku already matches sc.sku
--      (closes the "Zoho-only display" gap once and for all)
-- ============================================================================

BEGIN;

-- ─── 1. Trigram extension + indexes ─────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS ix_sku_catalog_title_trgm
  ON sku_catalog USING gin (product_title gin_trgm_ops);

-- ─── 2. sku_platform_ids: generalize listing metadata ──────────────────────
-- listing_title supersedes the Ecwid-only display_name. We keep display_name
-- as the persistence column for Ecwid sync compatibility but expose
-- listing_title as the unified field the suggestion engine reads from.
ALTER TABLE sku_platform_ids
  ADD COLUMN IF NOT EXISTS listing_title         TEXT,
  ADD COLUMN IF NOT EXISTS listing_url           TEXT,
  ADD COLUMN IF NOT EXISTS listing_status        TEXT DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS confidence            SMALLINT,
  ADD COLUMN IF NOT EXISTS paired_by             INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS paired_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS do_not_suggest_until  TIMESTAMPTZ;

-- One-time backfill: copy display_name → listing_title where unset.
-- Sync writers can start populating listing_title directly; this fills the
-- historical Ecwid rows.
UPDATE sku_platform_ids
   SET listing_title = display_name
 WHERE listing_title IS NULL
   AND display_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_sku_platform_ids_listing_title_trgm
  ON sku_platform_ids USING gin (listing_title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS ix_sku_platform_ids_unpaired
  ON sku_platform_ids (platform)
  WHERE sku_catalog_id IS NULL AND is_active = true;

-- ─── 3. sku_pairing_suggestions: cron-materialized candidates ──────────────
-- The notification cron writes here. The Product Hub reads from here for
-- instant load. Nothing else touches this table.
CREATE TABLE IF NOT EXISTS sku_pairing_suggestions (
  sku_catalog_id      INTEGER NOT NULL REFERENCES sku_catalog(id) ON DELETE CASCADE,
  platform_id_row_id  INTEGER NOT NULL REFERENCES sku_platform_ids(id) ON DELETE CASCADE,
  confidence          SMALLINT NOT NULL,
  reason              TEXT NOT NULL,
  refreshed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (sku_catalog_id, platform_id_row_id)
);

CREATE INDEX IF NOT EXISTS ix_pairing_suggestions_sku_conf
  ON sku_pairing_suggestions (sku_catalog_id, confidence DESC);

CREATE INDEX IF NOT EXISTS ix_pairing_suggestions_platform_row
  ON sku_pairing_suggestions (platform_id_row_id);

COMMENT ON TABLE sku_pairing_suggestions IS
  'Materialized candidates. Cron writes only; pairings happen via pair-batch with human review.';

-- ─── 4. sku_pairing_audit: durable trail of every pairing decision ─────────
CREATE TABLE IF NOT EXISTS sku_pairing_audit (
  id                  BIGSERIAL PRIMARY KEY,
  sku_catalog_id      INTEGER NOT NULL REFERENCES sku_catalog(id) ON DELETE CASCADE,
  platform_id_row_id  INTEGER REFERENCES sku_platform_ids(id) ON DELETE SET NULL,
  action              TEXT NOT NULL,
    -- 'accept' | 'reject' | 'unpair' | 'create_platform_row'
  confidence          SMALLINT,
  reason              TEXT,
    -- e.g. 'trigram_0.74+order_count_8', 'manual', 'rejected_wrong_color'
  actor_id            INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  actor_kind          TEXT NOT NULL DEFAULT 'user',
    -- 'user' (always for pairings) | 'system' (only used by suggestion cron)
  before_state        JSONB,
  after_state         JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_pairing_audit_sku
  ON sku_pairing_audit (sku_catalog_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_pairing_audit_actor
  ON sku_pairing_audit (actor_id, created_at DESC);

COMMENT ON TABLE sku_pairing_audit IS
  'Every pairing accept/reject/unpair. Human-readable provenance for the Product Hub.';

-- ─── 5. One-time backfill: claim already-matched mappings ──────────────────
-- Where a platform row's platform_sku equals a catalog SKU, link them.
-- This closes the long-running "the SKU is paired but the resolver doesn't
-- see it" gap. Sync writers should still call resolveOrCreateSkuCatalogId
-- so new inserts don't recreate the same situation.
WITH backfilled AS (
  UPDATE sku_platform_ids sp
     SET sku_catalog_id = sc.id
    FROM sku_catalog sc
   WHERE sp.sku_catalog_id IS NULL
     AND sp.platform_sku   = sc.sku
   RETURNING sp.id, sp.sku_catalog_id
)
INSERT INTO sku_pairing_audit
  (sku_catalog_id, platform_id_row_id, action, reason, actor_kind)
SELECT
  b.sku_catalog_id, b.id, 'accept', 'backfill_platform_sku_eq_catalog_sku', 'system'
FROM backfilled b;

COMMIT;
