-- ============================================================================
-- 2026-07-08e_pack_profiles_polymorphic.sql
--
-- Adds a polymorphic "pack profile" registry for packing KPI weighting and
-- capacity planning. Profiles can be linked to multiple owner entity types
-- (initially SKU catalog rows; later: model/category/listing without schema churn).
--
-- Why now:
-- - sku_catalog has pack notes but no structured pack-tier/time metadata.
-- - packing KPIs need SMALL/MEDIUM/LARGE bucketing + estimated minutes.
--
-- Tenant safety:
-- - Both tables are org-from-birth (organization_id NOT NULL).
-- - enforce_tenant_isolation() is applied to prevent cross-tenant leakage.
--
-- Reversible:
--   DROP TABLE IF EXISTS pack_profile_links;
--   DROP TABLE IF EXISTS pack_profiles;
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS pack_profiles (
  id                   bigserial PRIMARY KEY,
  organization_id      uuid NOT NULL,
  pack_tier            text NOT NULL,
  estimated_minutes    integer,
  source               text NOT NULL DEFAULT 'manual',
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pack_profiles_pack_tier_check CHECK (pack_tier IN ('SMALL','MEDIUM','LARGE')),
  CONSTRAINT pack_profiles_estimated_minutes_check CHECK (estimated_minutes IS NULL OR estimated_minutes >= 0)
);

COMMENT ON TABLE pack_profiles IS
  'Polymorphic packing KPI metadata: pack_tier + estimated minutes. Linked via pack_profile_links.';

COMMENT ON COLUMN pack_profiles.pack_tier IS
  'Tier used for packing KPIs: SMALL|MEDIUM|LARGE.';

COMMENT ON COLUMN pack_profiles.estimated_minutes IS
  'Estimated pack time (minutes). NULL means use tier defaults in code.';

COMMENT ON COLUMN pack_profiles.source IS
  'Origin of this profile: manual|rules|import. Used for auditing/backfills.';

CREATE TABLE IF NOT EXISTS pack_profile_links (
  id                   bigserial PRIMARY KEY,
  organization_id      uuid NOT NULL,
  owner_type           text NOT NULL,
  owner_id             bigint NOT NULL,
  pack_profile_id      bigint NOT NULL REFERENCES pack_profiles(id) ON DELETE CASCADE,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pack_profile_links_owner_type_check CHECK (owner_type IN ('SKU_CATALOG'))
);

COMMENT ON TABLE pack_profile_links IS
  'Polymorphic links from domain entities to pack_profiles (per org). owner_type is extensible.';

CREATE UNIQUE INDEX IF NOT EXISTS pack_profile_links_owner_unique
  ON pack_profile_links (organization_id, owner_type, owner_id);

CREATE INDEX IF NOT EXISTS pack_profile_links_profile_id_idx
  ON pack_profile_links (organization_id, pack_profile_id);

DO $$
BEGIN
  IF to_regclass('public.pack_profiles') IS NOT NULL THEN
    PERFORM enforce_tenant_isolation('pack_profiles');
  END IF;
  IF to_regclass('public.pack_profile_links') IS NOT NULL THEN
    PERFORM enforce_tenant_isolation('pack_profile_links');
  END IF;
END $$;

COMMIT;

