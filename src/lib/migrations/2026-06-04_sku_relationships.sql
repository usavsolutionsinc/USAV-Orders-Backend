-- ============================================================================
-- 2026-06-04: SKU relationship graph (parent → child BOM/assembly edges)
-- ============================================================================
-- Adds directed SKU-to-SKU relationships so a "system" or "assembly" SKU can be
-- exploded into the component SKUs it contains, and any SKU can be traced back
-- up to the systems it belongs to. This is the data layer behind the SKU graph
-- module (three view modes: item→parents, item→children, full tree).
--
-- IMPORTANT — this is NOT sku_kit_parts. sku_kit_parts records free-text
-- physical contents ("USB-C Cable") for QC/manuals and does NOT link catalog
-- rows. sku_relationships links two REAL sku_catalog ids, so every node in the
-- graph is itself a tracked, stockable SKU.
--
-- Nodes are sku_catalog rows (integer id). Edges are rows here. Stock per node
-- is still derived from the existing aggregate (sku_stock) and serial layers —
-- no stock data is duplicated here.
--
-- Also adds the optional sku_type tier (system | assembly | component) on
-- sku_catalog for node styling. Nullable + no backfill: unset SKUs fall back to
-- a position-derived tier (has children → assembly, leaf → component) in the UI.
-- ============================================================================

BEGIN;

-- ─── sku_catalog.sku_type (optional tier for node styling) ──────────────────
ALTER TABLE sku_catalog
  ADD COLUMN IF NOT EXISTS sku_type TEXT;

DO $$
BEGIN
  ALTER TABLE sku_catalog
    ADD CONSTRAINT sku_catalog_sku_type_check
    CHECK (sku_type IS NULL OR sku_type IN ('system', 'assembly', 'component'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN sku_catalog.sku_type IS
  'Optional graph tier: system | assembly | component. Nullable; UI falls back to a position-derived tier when unset.';

-- ─── sku_relationships (directed parent → child edges) ──────────────────────
CREATE TABLE IF NOT EXISTS sku_relationships (
  id              SERIAL PRIMARY KEY,
  organization_id UUID NOT NULL
                    DEFAULT NULLIF(current_setting('app.current_org', true), '')::uuid,
  parent_sku_id   INTEGER NOT NULL REFERENCES sku_catalog(id) ON DELETE CASCADE,
  child_sku_id    INTEGER NOT NULL REFERENCES sku_catalog(id) ON DELETE CASCADE,
  qty             INTEGER NOT NULL DEFAULT 1,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sku_rel_no_self CHECK (parent_sku_id <> child_sku_id),
  CONSTRAINT sku_rel_qty_positive CHECK (qty > 0),
  UNIQUE (parent_sku_id, child_sku_id)
);

COMMENT ON TABLE sku_relationships IS
  'Directed parent→child edges between two sku_catalog ids (BOM / assembly graph). Nodes are sku_catalog rows; deleting a SKU cascades its edges. Cycle prevention is enforced in the application layer (isDescendant check) before insert.';

-- Fast bidirectional lookup: children-of and parents-of.
CREATE INDEX IF NOT EXISTS idx_sku_rel_parent ON sku_relationships (parent_sku_id);
CREATE INDEX IF NOT EXISTS idx_sku_rel_child  ON sku_relationships (child_sku_id);
CREATE INDEX IF NOT EXISTS idx_sku_rel_organization_id ON sku_relationships (organization_id);

COMMIT;
