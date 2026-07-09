-- ============================================================================
-- 2026-06-28g: part_links — manual part → parent pairing (SaaS-owned)
-- ============================================================================
-- The inventory "parts graph" (/inventory/graph?view=parts) DERIVES parts from
-- the Zoho `items` mirror by the `-P` SKU suffix (src/lib/inventory/part-sku.ts).
-- Zoho composite/bundle items are NOT accessible to this integration (the OAuth
-- grant lacks the compositeitems scope; probed 2026-06-28), so Zoho provides no
-- parent→child BOM. This table is the SaaS-owned source of truth for the manual
-- pairing phase: which logical part belongs to which whole-unit parent, and
-- which `-P` SKUs are acknowledged as "not actually a part".
--
-- KEYED ON THE LOGICAL PART, NOT THE SKU ROW. The trailing `-1/-2/-3` index is a
-- dedup stock counter that churns as inventory moves; pairing keyed to it would
-- orphan on every restock. `child_logical_key` is the stable canonical identity
-- from parsePartSku().logicalKey (base + color + condition + unknowns), so a
-- pairing survives stock churn.
--
-- KEYED ON THE ZOHO `items` SCHEME, NEVER THE SKU STRING. `items` and
-- `sku_catalog` are INDEPENDENT SKU numbering schemes that collide on the same
-- string (see .claude/rules/source-of-truth.md). The parent is therefore a hard
-- FK to items.id (with parent_zoho_item_id denormalized for resilience across
-- re-sync); we never join `items` to `sku_catalog` on `sku`.
--
-- Shape:
--   status='confirmed'  → parent_item_id NOT NULL; MANY rows per child allowed
--                         (a part may belong to several systems — many-to-many).
--   status='not_a_part' → parent_item_id NULL; at most ONE row per child (the
--                         "this -P SKU is not really a part" acknowledgement).
-- A logical part is "reviewed" iff it has >= 1 row here; else it needs review.
--
-- Tenant-from-birth: organization_id UUID NOT NULL, enforced via
-- enforce_tenant_isolation() (loud-fail org DEFAULT + FORCE RLS + canonical
-- tenant_isolation policy). The only writers (lib/inventory/part-links.ts via
-- the /api/inventory/parts/links routes) run inside withTenantTransaction and
-- pass organization_id explicitly on every write.
--
-- ROLLBACK:
--   select relax_tenant_isolation('part_links');
--   DROP TABLE IF EXISTS part_links;
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS part_links (
  id                  BIGSERIAL PRIMARY KEY,
  organization_id     UUID NOT NULL,              -- no DEFAULT; helper installs the loud-fail GUC default
  child_logical_key   TEXT NOT NULL,              -- parsePartSku().logicalKey — stable across stock-index churn
  child_base          TEXT NOT NULL,              -- denormalized base code for grouping/display
  status              TEXT NOT NULL DEFAULT 'confirmed',
  parent_item_id      UUID REFERENCES items(id) ON DELETE CASCADE,   -- whole-unit parent; NULL for 'not_a_part'
  parent_zoho_item_id TEXT,                        -- resilience if items rows are re-keyed on re-sync
  qty                 INTEGER NOT NULL DEFAULT 1,  -- units of this part per parent
  notes               TEXT,
  created_by_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Status domain.
DO $$ BEGIN
  ALTER TABLE part_links
    ADD CONSTRAINT part_links_status_chk CHECK (status IN ('confirmed', 'not_a_part'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A 'confirmed' row must name a parent; a 'not_a_part' row must not.
DO $$ BEGIN
  ALTER TABLE part_links
    ADD CONSTRAINT part_links_parent_shape_chk CHECK (
      (status = 'confirmed'  AND parent_item_id IS NOT NULL) OR
      (status = 'not_a_part' AND parent_item_id IS NULL)
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- qty must be positive.
DO $$ BEGIN
  ALTER TABLE part_links
    ADD CONSTRAINT part_links_qty_chk CHECK (qty > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- One edge per (child, parent) within an org. NULLs are distinct in a UNIQUE
-- index, so a partial unique index pins the single 'not_a_part' row per child.
CREATE UNIQUE INDEX IF NOT EXISTS ux_part_links_child_parent
  ON part_links (organization_id, child_logical_key, parent_item_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_part_links_child_not_a_part
  ON part_links (organization_id, child_logical_key)
  WHERE status = 'not_a_part';

-- Read paths: "all links for this base / this child" (the parts-graph join) and
-- "all children assigned to this parent" (where-used).
CREATE INDEX IF NOT EXISTS idx_part_links_org_base
  ON part_links (organization_id, child_base);

CREATE INDEX IF NOT EXISTS idx_part_links_org_child
  ON part_links (organization_id, child_logical_key);

CREATE INDEX IF NOT EXISTS idx_part_links_parent
  ON part_links (organization_id, parent_item_id);

COMMENT ON TABLE part_links IS
  'SaaS-owned part→parent pairing for the inventory parts graph. Keyed on the logical part (base+color+condition) and the Zoho items scheme (FK items.id), never the sku string. status confirmed (many parents) | not_a_part (one, null parent). Tenant-scoped.';

-- ── Flip on FORCE RLS + loud-fail org default + canonical policy ────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'enforce_tenant_isolation') THEN
    PERFORM enforce_tenant_isolation('part_links');
  ELSE
    RAISE NOTICE 'enforce_tenant_isolation absent — part_links left without FORCE RLS';
  END IF;
END $$;

COMMIT;
