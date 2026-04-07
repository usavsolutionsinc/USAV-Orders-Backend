-- ============================================================================
-- 2026-04-07: Create SKU Catalog Hub + Platform Crosswalk + BOM/QC tables
-- ============================================================================
-- Central sku_catalog table ties all platform identifiers together.
-- sku_platform_ids maps each platform's SKU/item ID to the central hub.
-- sku_kit_parts (BOM) tracks what's in the box per SKU.
-- qc_check_templates defines QC test steps per SKU or category.
-- tech_verifications records per-unit pass/fail execution.
-- FK columns added to orders, fba_fnskus, product_manuals.
-- ============================================================================

BEGIN;

-- ─── Table 1: sku_catalog (central hub) ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS sku_catalog (
  id            SERIAL PRIMARY KEY,
  sku           TEXT NOT NULL UNIQUE,
  product_title TEXT NOT NULL,
  category      TEXT,
  upc           TEXT,
  ean           TEXT,
  image_url     TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sku_catalog_category
  ON sku_catalog(category) WHERE category IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sku_catalog_upc
  ON sku_catalog(upc) WHERE upc IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sku_catalog_active
  ON sku_catalog(is_active, sku) WHERE is_active = true;

-- ─── Table 2: sku_platform_ids (platform crosswalk) ──────────────────────────

CREATE TABLE IF NOT EXISTS sku_platform_ids (
  id               SERIAL PRIMARY KEY,
  sku_catalog_id   INT NOT NULL REFERENCES sku_catalog(id) ON DELETE CASCADE,
  platform         TEXT NOT NULL,
  platform_sku     TEXT,
  platform_item_id TEXT,
  account_name     TEXT,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique constraint: one platform_sku per platform+account (partial, nullable-safe)
CREATE UNIQUE INDEX IF NOT EXISTS ux_sku_platform_ids_platform_sku
  ON sku_platform_ids(platform, platform_sku, COALESCE(account_name, ''))
  WHERE platform_sku IS NOT NULL;

-- Unique constraint: one platform_item_id per platform+account
CREATE UNIQUE INDEX IF NOT EXISTS ux_sku_platform_ids_platform_item
  ON sku_platform_ids(platform, platform_item_id, COALESCE(account_name, ''))
  WHERE platform_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sku_platform_ids_catalog
  ON sku_platform_ids(sku_catalog_id);

CREATE INDEX IF NOT EXISTS idx_sku_platform_ids_lookup_sku
  ON sku_platform_ids(platform, platform_sku) WHERE platform_sku IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sku_platform_ids_lookup_item
  ON sku_platform_ids(platform, platform_item_id) WHERE platform_item_id IS NOT NULL;

-- ─── Table 3: sku_kit_parts (BOM — what's in the box) ───────────────────────

CREATE TABLE IF NOT EXISTS sku_kit_parts (
  id               SERIAL PRIMARY KEY,
  sku_catalog_id   INT NOT NULL REFERENCES sku_catalog(id) ON DELETE CASCADE,
  component_name   TEXT NOT NULL,
  component_type   TEXT NOT NULL DEFAULT 'PART',
  qty_required     INT NOT NULL DEFAULT 1,
  required_for     TEXT[],
  is_critical      BOOLEAN NOT NULL DEFAULT true,
  sort_order       INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sku_kit_parts_catalog
  ON sku_kit_parts(sku_catalog_id);

-- ─── Table 4: qc_check_templates (QC test steps) ────────────────────────────

CREATE TABLE IF NOT EXISTS qc_check_templates (
  id               SERIAL PRIMARY KEY,
  sku_catalog_id   INT REFERENCES sku_catalog(id) ON DELETE CASCADE,
  category         TEXT,
  step_label       TEXT NOT NULL,
  step_type        TEXT NOT NULL DEFAULT 'PASS_FAIL',
  sort_order       INT NOT NULL DEFAULT 0,
  CONSTRAINT qc_check_templates_scope_check
    CHECK (sku_catalog_id IS NOT NULL OR category IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_qc_check_templates_catalog
  ON qc_check_templates(sku_catalog_id) WHERE sku_catalog_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_qc_check_templates_category
  ON qc_check_templates(category) WHERE category IS NOT NULL;

-- ─── Table 5: tech_verifications (per-unit execution log) ────────────────────

CREATE TABLE IF NOT EXISTS tech_verifications (
  id               SERIAL PRIMARY KEY,
  source_kind      TEXT NOT NULL,
  source_row_id    INT NOT NULL,
  sku_catalog_id   INT NOT NULL REFERENCES sku_catalog(id),
  step_type        TEXT NOT NULL,
  step_id          INT NOT NULL,
  passed           BOOLEAN,
  verified_by      INT,
  verified_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes            TEXT
);

CREATE INDEX IF NOT EXISTS idx_tech_verifications_source
  ON tech_verifications(source_kind, source_row_id);

CREATE INDEX IF NOT EXISTS idx_tech_verifications_catalog
  ON tech_verifications(sku_catalog_id);

CREATE INDEX IF NOT EXISTS idx_tech_verifications_verified_at
  ON tech_verifications(verified_at DESC);

-- ─── FK columns on existing tables ──────────────────────────────────────────

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS sku_catalog_id INT REFERENCES sku_catalog(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_sku_catalog_id
  ON orders(sku_catalog_id) WHERE sku_catalog_id IS NOT NULL;

ALTER TABLE fba_fnskus
  ADD COLUMN IF NOT EXISTS sku_catalog_id INT REFERENCES sku_catalog(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_fba_fnskus_sku_catalog_id
  ON fba_fnskus(sku_catalog_id) WHERE sku_catalog_id IS NOT NULL;

ALTER TABLE product_manuals
  ADD COLUMN IF NOT EXISTS sku_catalog_id INT REFERENCES sku_catalog(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_product_manuals_sku_catalog_id
  ON product_manuals(sku_catalog_id) WHERE sku_catalog_id IS NOT NULL;

COMMIT;
