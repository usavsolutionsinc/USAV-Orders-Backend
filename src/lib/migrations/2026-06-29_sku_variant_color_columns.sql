-- ─────────────────────────────────────────────────────────────────────────────
-- sku-reconciliation plan, Step B (COLOR axis) — additive variant columns.
-- ─────────────────────────────────────────────────────────────────────────────
-- Owner-confirmed: the 1-letter SKU suffixes encode COLOR (not condition). This
-- migration adds the structured color axis to the product master as two NULLABLE
-- columns. It is purely ADDITIVE and INERT until the config-driven decoder
-- (`src/lib/inventory/sku-variant.ts` → decodeSkuColorSuffix) backfills them:
--   • no existing column is altered or dropped;
--   • both columns are nullable with no default → every existing row stays NULL
--     (no color tagged), so resolution + reads are byte-for-byte unchanged;
--   • no backfill is performed here — the decoder writes these later, and only
--     for owner-confirmed suffixes (-B → BLACK, -W → WHITE). The ambiguous
--     suffixes (-N / -S / -SW) decode to NULL and so will NEVER mis-tag a row.
--
-- Tenant-from-birth: sku_catalog already carries organization_id (NOT NULL) +
-- the per-org UNIQUE(organization_id, sku) and RLS, so these per-row attribute
-- columns inherit org scoping automatically — no new org key is required.
--
-- Idempotent (IF NOT EXISTS): safe to apply more than once and safe to apply
-- before OR after the decoder ships.
--
-- Apply with the normal `npm run db:migrate`. No deploy coupling — the columns
-- are unused until a later backfill pass.

ALTER TABLE sku_catalog
  ADD COLUMN IF NOT EXISTS color_code  text,
  ADD COLUMN IF NOT EXISTS color_label text;

COMMENT ON COLUMN sku_catalog.color_code IS
  'Structured color variant code (controlled vocab, e.g. BLACK/WHITE). Decoded from the SKU color suffix by src/lib/inventory/sku-variant.ts. NULL = no confirmed color. Separate axis from condition grade.';
COMMENT ON COLUMN sku_catalog.color_label IS
  'Human-readable color label (e.g. Black/White) paired with color_code. NULL = no confirmed color.';
