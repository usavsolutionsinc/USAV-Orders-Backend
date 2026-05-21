-- ============================================================================
-- 2026-05-21_org_id_transitional_default.sql
--
-- TRANSITIONAL safety net for the multi-tenancy rollout.
--
-- The previous migration (2026-05-23_org_id_on_business_tables.sql) added
-- `organization_id NOT NULL DEFAULT NULLIF(current_setting('app.current_org',
-- true), '')::uuid` to ~70 business tables. The intent was loud failure when
-- a query forgot to scope itself: GUC empty → NULL → NOT NULL violation.
--
-- That worked too well. There are ~205 raw SQL INSERTs across the codebase
-- that don't use `withTenantConnection` and don't stamp organizationId
-- explicitly. Until each one is migrated, every tech / packer / receiving
-- scan in the legacy code path crashes.
--
-- This migration changes the column DEFAULT to **fall back to the USAV org**
-- when the GUC is empty:
--
--   DEFAULT COALESCE(
--     NULLIF(current_setting('app.current_org', true), '')::uuid,
--     '00000000-0000-0000-0000-000000000001'::uuid   -- USAV
--   )
--
-- Effect:
--   - Code using withTenantConnection or stamping organizationId explicitly
--     → unchanged. The GUC / explicit value wins.
--   - Legacy code that does neither → silently lands rows under USAV. This
--     matches pre-migration behavior (single-tenant); no data corruption.
--   - Once every raw SQL INSERT is migrated, we'll revert this in a follow-up
--     migration to restore loud-failure semantics for the next tenant.
--
-- Idempotent: each ALTER COLUMN SET DEFAULT runs every time.
-- ============================================================================

DO $$
DECLARE
  business_table text;
  business_tables text[];
BEGIN
  -- Pull every tenant-scoped table dynamically so future tables added to
  -- the org_id migration are covered without editing this file.
  SELECT array_agg(table_name ORDER BY table_name)
    INTO business_tables
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND column_name = 'organization_id';

  FOREACH business_table IN ARRAY business_tables LOOP
    EXECUTE format(
      $f$ALTER TABLE %I ALTER COLUMN organization_id SET DEFAULT COALESCE(NULLIF(current_setting('app.current_org', true), '')::uuid, '00000000-0000-0000-0000-000000000001'::uuid)$f$,
      business_table
    );
  END LOOP;

  RAISE NOTICE 'Applied transitional org_id default to % tables', array_length(business_tables, 1);
END $$;
