-- ============================================================================
-- 2026-06-16_enforce_tenant_isolation_leaf_cohort_3.sql.template
--
-- Tenant-isolation slice batch — third leaf cohort. ENFORCEMENT (FORCE RLS).
--
-- ⚠️  .sql.template — NOT auto-applied (runner only picks up *.sql). Promote
--     with Phase E1 (app runs as the non-BYPASSRLS app_tenant role).
--
-- These tables were blocked at audit time by drizzle-neon-http / raw-pool /
-- server-component consumers that could not carry the org GUC. Those consumers
-- were converted in this same change set (tsc clean, re-grep confirms no raw
-- path remains). No natural-key constraint fixes were required. Slice-ready:
--
--   entity_notes        — salesOrderRepository.markZohoError moved onto
--                         withTenantDrizzle + org-stamped + cross-tenant guard.
--   model_versions      — pipeline/promote + pipeline/status routes moved onto
--                         withTenantDrizzle, every query org-filtered.
--   stock_alerts        — admin/inventory/page.tsx loadOpenDriftAlerts moved
--                         onto tenantQuery with the requirePermission() org.
--   qc_check_templates  — sku-catalog-queries.getSkuCatalogDetail qc SELECT now
--                         runs via tenantQuery (sole caller already passes orgId).
--
-- Each call is independently revertable: SELECT relax_tenant_isolation('<table>');
-- PROMOTE: drop `.template` → npm run db:migrate → npm run tenancy:guard:check.
-- ============================================================================

SELECT enforce_tenant_isolation('entity_notes');
SELECT enforce_tenant_isolation('model_versions');
SELECT enforce_tenant_isolation('stock_alerts');
SELECT enforce_tenant_isolation('qc_check_templates');
