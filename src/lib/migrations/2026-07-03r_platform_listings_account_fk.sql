-- ============================================================================
-- 2026-07-03r: platform_listings.platform_account_id — catalog FK (Phase 1)
-- ============================================================================
-- Phase 1 of docs/todo/schema-wide-polymorphic-refactor-plan.md ("Listings &
-- Integrations"): platform_listings currently identifies its channel with
-- free-text `platform` + `account_name` and does NOT join the platform catalog
-- at all (agree-by-string). This adds a real, nullable FK to platform_accounts
-- so listings can resolve through the catalog (→ platform → provider →
-- organization_integrations) instead of string-matching.
--
-- ADDITIVE + REVERSIBLE. The `platform` / `account_name` text columns STAY as a
-- read-through cache — writers dual-write and readers migrate in later phases
-- (this mirrors the serial_unit_provenance arc). Nullable so existing/legacy
-- rows and any writer that hasn't resolved an account yet remain valid.
--
-- NO BACKFILL: platform_listings is empty today (0 rows). When writers begin
-- populating it, resolve platform_account_id at WRITE time in the domain helper
-- (the house pattern — validate/resolve the parent in the writing lib fn, not a
-- DB trigger; see .claude/rules/polymorphic-tables.md point 6). A one-shot
-- backfill for any pre-FK rows would match (platform → platforms.code/provider,
-- account_name → platform_accounts.slug/label) org-scoped — add it in the
-- dual-write migration if rows exist by then.
--
-- platform_listings is already org-scoped + FORCE-RLS (existing table), so no
-- enforce_tenant_isolation() call here.
--
-- ROLLBACK:
--   ALTER TABLE platform_listings DROP COLUMN IF EXISTS platform_account_id;
-- ============================================================================

BEGIN;

ALTER TABLE platform_listings
  ADD COLUMN IF NOT EXISTS platform_account_id BIGINT;

DO $$ BEGIN
  ALTER TABLE platform_listings
    ADD CONSTRAINT platform_listings_platform_account_id_fkey
    FOREIGN KEY (platform_account_id) REFERENCES platform_accounts(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Org-led index (where-used: "all listings for this account").
CREATE INDEX IF NOT EXISTS idx_platform_listings_account
  ON platform_listings (organization_id, platform_account_id);

COMMENT ON COLUMN platform_listings.platform_account_id IS
  'Phase 1 catalog FK → platform_accounts. Nullable during transition; platform/account_name stay as the read-through cache until reader migration. Resolve at write time in the domain helper.';

COMMIT;
