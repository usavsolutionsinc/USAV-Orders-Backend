-- ============================================================================
-- 2026-06-14f_catalog_type_fk_accounts_seed.sql
--
-- Phase 2 + Phase 4-remainder of docs/platform-account-type-catalog-plan.md.
--
--   Phase 2  — additive `type_id` FK on receiving + orders → types(id).
--              The text columns (receiving.intake_type / source_platform,
--              orders.account_source) stay as the denormalized cache; this is
--              purely additive + reversible. A one-shot backfill
--              (scripts/backfill-catalog-type-id.mjs, dry-run first) populates
--              receiving.type_id from the carton's effective intake_type.
--
--   Phase 4  — seed `platform_accounts` (the table shipped empty in 2026-06-13g):
--              eBay storefronts from ebay_accounts, plus one default account per
--              non-eBay platform so every channel is reachable through an
--              account. Idempotent (ON CONFLICT DO NOTHING); the runtime
--              seedOrgCatalog() mirrors these inserts for new orgs.
--
-- No CHECK is added and no text column is dropped — readers are unchanged.
-- ============================================================================

-- ─── Phase 2: receiving.type_id ─────────────────────────────────────────────
-- ON DELETE SET NULL: hiding/removing a type is a soft delete (is_active=false),
-- never a hard delete, but the FK degrades gracefully if a row is ever purged.
ALTER TABLE receiving
  ADD COLUMN IF NOT EXISTS type_id bigint REFERENCES types(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_receiving_type_id
  ON receiving (type_id)
  WHERE type_id IS NOT NULL;

-- ─── Phase 2: orders.type_id ────────────────────────────────────────────────
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS type_id bigint REFERENCES types(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_type_id
  ON orders (type_id)
  WHERE type_id IS NOT NULL;

-- ─── Phase 4: seed platform_accounts per org ────────────────────────────────
-- eBay storefronts ← ebay_accounts (account_name is the slug + label; the
-- specific connection is linked via integration_scope = account_name so a type
-- bound to this account can resolve its eBay credentials later).
INSERT INTO platform_accounts (organization_id, platform_id, slug, label, integration_scope, is_active)
SELECT ea.organization_id,
       p.id,
       ea.account_name,
       ea.account_name,
       ea.account_name,
       COALESCE(ea.is_active, true)
FROM ebay_accounts ea
JOIN platforms p
  ON p.organization_id = ea.organization_id
 AND p.slug = 'ebay'
WHERE ea.account_name IS NOT NULL
  AND BTRIM(ea.account_name) <> ''
ON CONFLICT (organization_id, platform_id, slug) DO NOTHING;

-- One default storefront per non-eBay platform (slug '<platform>-main') so an
-- order/receiving row on, e.g., 'ecwid' or 'fba' resolves to an account →
-- platform → integration even before the org defines named storefronts.
INSERT INTO platform_accounts (organization_id, platform_id, slug, label, is_active)
SELECT p.organization_id,
       p.id,
       p.slug || '-main',
       p.label,
       true
FROM platforms p
WHERE p.slug <> 'ebay'
ON CONFLICT (organization_id, platform_id, slug) DO NOTHING;
