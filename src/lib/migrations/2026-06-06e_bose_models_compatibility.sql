-- ============================================================================
-- 2026-06-06: Bose model catalog + part compatibility cross-reference (P0)
-- ============================================================================
-- The compatibility DB. bose_models is the lookup root (search by model number
-- or name; bose_serial_prefixes lets a scanned serial resolve to a model).
-- part_compatibility is a many-to-many bridge: one model needs many part roles,
-- one part (sku_catalog row) fits many models.
--
-- This is deliberately SEPARATE from sku_relationships (assembly BOM, directed
-- parent->child, qty). Compatibility has different cardinality and semantics
-- (role + fit + OEM-ness), so it gets its own table. The two are cross-linked
-- in the UI, not in the schema. See docs/bose-parts-sourcing-engine-plan.md §3.
--
-- No organization_id: matches the sku_catalog hub (sku_catalog / sku_platform_ids
-- / sku_kit_parts / pending_skus are all single-tenant), so FK joins stay clean.
-- ============================================================================

BEGIN;

-- ─── Model catalog (lookup root) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bose_models (
  id            serial PRIMARY KEY,
  model_number  text NOT NULL UNIQUE,                 -- canonical model #, e.g. '423816'
  model_name    text NOT NULL,                        -- 'SoundLink Mini II'
  family        text,                                 -- SoundLink|QuietComfort|Wave|Lifestyle|…
  product_type  text,                                 -- speaker|headphone|home_theater|…
  release_year  integer,
  eol_date      date,                                 -- when Bose discontinued it (nullable)
  image_url     text,
  notes         text,
  is_active     boolean NOT NULL DEFAULT true,        -- soft-delete (preserve audit trail)
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bose_models_family
  ON bose_models (family) WHERE is_active;

COMMENT ON TABLE bose_models IS
  'Bose product model catalog — the root of the compatibility lookup. Soft-deleted via is_active.';

-- ─── Serial -> model decode (optional, ships empty) ─────────────────────────
-- Bose serials encode the model in a leading prefix. This table is populated
-- opportunistically; the lookup endpoint degrades to model search when a serial
-- has no known prefix. Longest-prefix-wins is resolved in the query layer.
CREATE TABLE IF NOT EXISTS bose_serial_prefixes (
  id            serial PRIMARY KEY,
  prefix        text NOT NULL UNIQUE,                 -- leading serial chars
  bose_model_id integer NOT NULL REFERENCES bose_models(id) ON DELETE CASCADE,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bose_serial_prefixes_model
  ON bose_serial_prefixes (bose_model_id);

COMMENT ON TABLE bose_serial_prefixes IS
  'Optional serial-prefix -> bose_model decode table. Ships empty; lookup degrades to model search.';

-- ─── Compatibility cross-reference (model <-> part) ─────────────────────────
CREATE TABLE IF NOT EXISTS part_compatibility (
  id            serial PRIMARY KEY,
  bose_model_id integer NOT NULL REFERENCES bose_models(id) ON DELETE CASCADE,
  sku_id        integer NOT NULL REFERENCES sku_catalog(id) ON DELETE CASCADE,
  part_role     text NOT NULL,                        -- battery|ear_cushion|driver|pcb|power_supply|remote|antenna|…
  is_oem        boolean NOT NULL DEFAULT true,
  fit           text NOT NULL DEFAULT 'exact',        -- exact|equivalent|salvage
  confidence    text NOT NULL DEFAULT 'confirmed',    -- confirmed|likely|unverified
  source        text NOT NULL DEFAULT 'manual',       -- manual|csv_import|ebay
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT part_compatibility_fit_chk        CHECK (fit IN ('exact','equivalent','salvage')),
  CONSTRAINT part_compatibility_confidence_chk CHECK (confidence IN ('confirmed','likely','unverified')),
  CONSTRAINT part_compatibility_source_chk     CHECK (source IN ('manual','csv_import','ebay')),
  -- one (model, part, role) edge; re-adding the same part for a role is a no-op upsert target
  CONSTRAINT part_compatibility_uniq UNIQUE (bose_model_id, sku_id, part_role)
);

CREATE INDEX IF NOT EXISTS idx_part_compat_model ON part_compatibility (bose_model_id);
CREATE INDEX IF NOT EXISTS idx_part_compat_sku   ON part_compatibility (sku_id);

COMMENT ON TABLE part_compatibility IS
  'Many-to-many: which sku_catalog parts fit which bose_models, by role + fit + OEM-ness. Distinct from sku_relationships (BOM).';

COMMIT;
