-- ============================================================================
-- 2026-06-16_enforce_tenant_isolation_leaf_cohort_1.sql.template
--
-- Tenant-isolation slice batch — first leaf cohort. ENFORCEMENT (FORCE RLS).
--
-- ⚠️  .sql.template — NOT auto-applied (runner only picks up *.sql). FORCE is a
--     COORDINATED step (Phase E1: app runs as the non-BYPASSRLS app_tenant role).
--
-- Each table below was audited 2026-06-16 (tenancy-slice-audit workflow): EVERY
-- SQL consumer runs through a GUC wrapper (tenantQuery / withTenantConnection /
-- withTenantTransaction) and filters/stamps organization_id. None needs a
-- natural-key constraint fix. Verified slice-ready, fan-in in [ ]:
--
--   serial_unit_condition_history [3] — tech/test-result, serial-units/[id](+/grade)
--   cycle_count_campaigns         [5] — cycle-counts routes + lib/inventory/cycle-count.ts
--   cycle_count_lines             [7] — cycle-counts routes + lib/inventory/cycle-count.ts
--   printer_profiles              [1] — printer-profiles route only
--   credit_notes                  [0] — no SQL consumers (Zoho mirror; FORCE is inert-safe)
--
-- Each call is INDEPENDENTLY revertable: SELECT relax_tenant_isolation('<table>');
--
-- PROMOTE (with Phase E1): drop the `.template` suffix → npm run db:migrate →
-- npm run tenancy:guard:check. The generic "every FORCEd table has a complete
-- tenant_isolation policy" canary in cross-org-isolation.test.ts covers these
-- automatically.
-- ============================================================================

SELECT enforce_tenant_isolation('serial_unit_condition_history');
SELECT enforce_tenant_isolation('cycle_count_campaigns');
SELECT enforce_tenant_isolation('cycle_count_lines');
SELECT enforce_tenant_isolation('printer_profiles');
SELECT enforce_tenant_isolation('credit_notes');
