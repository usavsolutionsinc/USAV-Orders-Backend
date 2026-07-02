-- ============================================================================
-- 2026-07-01l_inbound_spine_cache_and_ebay_role.sql
--
-- Universal Incoming — Phase 1 (spine cache + eBay buyer role). Pure DDL; the
-- data backfill is the sibling 2026-07-01m file.
-- Plan: docs/incoming-universal-purchase-orders-plan.md §3.6, §3.8.
--
-- TRANSITION CACHE on the receiving_lines spine. inbound_purchase_order_links
-- (2026-07-01k) is the identity SoT; these denormalized columns keep existing
-- Incoming readers green until they cut over to the link join, then get dropped
-- (same strangler as the 2026-06-29e facts dual-write). We deliberately do NOT
-- add another permanent Zoho+eBay column cluster to the already-51-col spine.
--
--   inbound_source_type  — primary source badge/filter (named CHECK, cache of the
--                          is_primary link row's source_type).
--   source_line_item_id  — primary external line id (source_order_id already exists
--                          from 2026-06-13c).
--   platform_account_id  — buyer/storefront account for the account chip.
--
-- Also relaxes receiving_lines.zoho_item_id NOT NULL so marketplace-only lines
-- (eBay/Amazon, no Zoho item) can exist on the spine, guarded by a CHECK that
-- still requires a Zoho item id for zoho-sourced rows.
--
-- And adds ebay_accounts.account_role ('seller' | 'buyer') so one eBay OAuth app
-- serves both selling (existing) and purchasing (new) connections.
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS + guarded CHECK DO-blocks + DROP NOT NULL
-- (a no-op if already dropped). Safe to re-run.
--
-- ROLLBACK:
--   ALTER TABLE receiving_lines
--     DROP CONSTRAINT IF EXISTS receiving_lines_inbound_source_type_chk,
--     DROP CONSTRAINT IF EXISTS receiving_lines_zoho_item_required_chk,
--     DROP COLUMN IF EXISTS inbound_source_type,
--     DROP COLUMN IF EXISTS source_line_item_id,
--     DROP COLUMN IF EXISTS platform_account_id;
--   ALTER TABLE ebay_accounts
--     DROP CONSTRAINT IF EXISTS ebay_accounts_account_role_chk,
--     DROP COLUMN IF EXISTS account_role;
--   (leave zoho_item_id nullable, or re-assert NOT NULL only once no marketplace
--    lines exist.)
-- ============================================================================

BEGIN;

-- ── receiving_lines: transition cache columns ───────────────────────────────
ALTER TABLE receiving_lines
  ADD COLUMN IF NOT EXISTS inbound_source_type text,
  ADD COLUMN IF NOT EXISTS source_line_item_id text,
  ADD COLUMN IF NOT EXISTS platform_account_id bigint
    REFERENCES platform_accounts(id) ON DELETE SET NULL;

-- Discriminator cache — named CHECK, kept in sync with the code registry
-- (src/lib/inbound/source-registry.ts) and the link/mirror CHECKs (2026-07-01k).
-- Extend this CHECK in the same migration that ships a new source.
DO $$ BEGIN
  ALTER TABLE receiving_lines
    ADD CONSTRAINT receiving_lines_inbound_source_type_chk
    CHECK (inbound_source_type IS NULL OR inbound_source_type IN ('zoho', 'ebay', 'amazon', 'manual'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Relax the Zoho-only NOT NULL so eBay/Amazon marketplace lines can live on the
-- spine without a Zoho item id. (No-op if already nullable.)
ALTER TABLE receiving_lines ALTER COLUMN zoho_item_id DROP NOT NULL;

-- …but keep the invariant that a Zoho-sourced line still names a Zoho item.
-- Existing rows all have zoho_item_id (it was NOT NULL) → CHECK is satisfied.
-- inbound_source_type is NULL until the 2026-07-01m backfill, and NULL is
-- allowed by the OR-branch, so validation passes for every current row.
DO $$ BEGIN
  ALTER TABLE receiving_lines
    ADD CONSTRAINT receiving_lines_zoho_item_required_chk
    CHECK (zoho_item_id IS NOT NULL OR inbound_source_type IN ('ebay', 'amazon', 'manual'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_receiving_lines_org_inbound_source
  ON receiving_lines (organization_id, inbound_source_type)
  WHERE inbound_source_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_receiving_lines_platform_account
  ON receiving_lines (organization_id, platform_account_id)
  WHERE platform_account_id IS NOT NULL;

COMMENT ON COLUMN receiving_lines.inbound_source_type IS
  'Transition cache of the is_primary inbound_purchase_order_links.source_type (zoho|ebay|amazon|manual). Links table is the SoT; dropped after Incoming readers cut over. Universal Incoming Phase 1.';

-- ── ebay_accounts: buyer role (non-polymorphic extension) ───────────────────
ALTER TABLE ebay_accounts
  ADD COLUMN IF NOT EXISTS account_role text NOT NULL DEFAULT 'seller';

DO $$ BEGIN
  ALTER TABLE ebay_accounts
    ADD CONSTRAINT ebay_accounts_account_role_chk
    CHECK (account_role IN ('seller', 'buyer'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_ebay_accounts_org_role
  ON ebay_accounts (organization_id, account_role);

COMMENT ON COLUMN ebay_accounts.account_role IS
  'seller (existing sell.fulfillment connections) | buyer (new buy.order purchasing connections). One eBay OAuth app, discriminated tokens. Universal Incoming Phase 1.';

COMMIT;
