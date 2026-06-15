-- ============================================================================
-- 2026-06-14e: eBay accounts — account_name unique PER ORG (was global)
-- ============================================================================
-- The original ebay_accounts.account_name carried a GLOBAL unique constraint
-- (ebay_accounts_account_name_key, auto-named by Drizzle's .unique()). In a
-- multi-tenant world that lets one org's connect overwrite another org's row
-- via `ON CONFLICT (account_name)`. This migration drops the global unique and
-- replaces it with a composite UNIQUE (organization_id, account_name) so the
-- callback can safely upsert with `ON CONFLICT (organization_id, account_name)`.
--
-- Additive + idempotent. The legacy unique may exist as a constraint OR a bare
-- index depending on how the table was created, so we drop both forms defensively.
-- ============================================================================

DO $$
BEGIN
  -- Drop the legacy GLOBAL unique on account_name, whether it's a constraint…
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ebay_accounts_account_name_key') THEN
    ALTER TABLE ebay_accounts DROP CONSTRAINT ebay_accounts_account_name_key;
  END IF;
  -- …or a standalone index (not backing a constraint).
  IF EXISTS (
    SELECT 1
      FROM pg_class i
      JOIN pg_namespace n ON n.oid = i.relnamespace
     WHERE i.relkind = 'i'
       AND i.relname = 'ebay_accounts_account_name_key'
       AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = i.oid)
  ) THEN
    DROP INDEX ebay_accounts_account_name_key;
  END IF;
END $$;

-- Per-org uniqueness — this is the conflict target the callback upsert uses.
CREATE UNIQUE INDEX IF NOT EXISTS ux_ebay_accounts_org_account
  ON ebay_accounts (organization_id, account_name);
