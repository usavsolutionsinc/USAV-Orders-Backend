-- ============================================================================
-- 2026-06-16_enforce_tenant_isolation_leaf_cohort_2.sql.template
--
-- Tenant-isolation slice batch — second leaf cohort. ENFORCEMENT (FORCE RLS).
--
-- ⚠️  .sql.template — NOT auto-applied (runner only picks up *.sql). Promote
--     with Phase E1 (app runs as the non-BYPASSRLS app_tenant role).
--
-- These tables were NOT slice-ready at audit time (2026-06-16): they had
-- raw-pool / dual-mode consumers. Those consumers were converted to GUC
-- wrappers in this same change set — every SQL access now runs through
-- tenantQuery / withTenantConnection / withTenantTransaction with
-- organization_id filtered/stamped (tsc clean, re-grep confirms no raw-pool
-- path remains). Slice-ready as of this PR:
--
--   favorite_skus           — src/lib/favorites/sku-favorites.ts (helpers now
--                             orgId-required) + favorites routes threaded.
--                             Natural-key unique fixed →
--                             2026-06-16_favorite_skus_per_org_unique.sql (apply that FIRST).
--   favorite_sku_workspaces — same module; PK already org-safe, no constraint fix.
--   repair_issue_templates  — src/lib/neon/repair-issue-queries.ts converted to
--                             tenantQuery + repair/issues routes threaded.
--   location_transfers      — logLocationTransfer/getTransfersForSku in
--                             location-queries.ts now orgId-required (raw
--                             fallback deleted) + sku-stock/[sku] route threaded.
--
-- Each call is independently revertable: SELECT relax_tenant_isolation('<table>');
-- PROMOTE: drop `.template` → npm run db:migrate → npm run tenancy:guard:check.
-- ============================================================================

-- Guarded: skip any table not present in this DB. `repair_issue_templates` was
-- named in the audit but never created (to_regclass → NULL → PERFORM skipped),
-- so this migration enforces the tables that exist instead of aborting on it.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'favorite_skus', 'favorite_sku_workspaces', 'repair_issue_templates', 'location_transfers'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      PERFORM enforce_tenant_isolation(t);
    ELSE
      RAISE NOTICE 'leaf_cohort_2: skipping enforce_tenant_isolation(%) — table does not exist', t;
    END IF;
  END LOOP;
END $$;
