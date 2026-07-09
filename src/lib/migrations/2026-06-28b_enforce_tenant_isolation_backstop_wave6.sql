-- ============================================================================
-- 2026-06-28b_enforce_tenant_isolation_backstop_wave6.sql
--
-- Backstop wave 6: convertible tables verified (2026-06-28) FORCE-safe — every
-- writer stamps organization_id or is GUC-wrapped, and every flagged ⛔ reader is
-- org-filtered (explicit predicate) or a false positive:
--   audit_logs           — recordAudit() (audit-logs.ts:31) INSERT explicit org (the audit SoT); 4 reader
--                          routes all carry an explicit organization_id predicate.
--   photo_entity_links   — photos/links.ts:17 INSERT explicit org; library/packer readers explicit org.
--   amazon_accounts      — amazon/oauth/callback + connect INSERT via tenantQuery+org; order-sync UPDATEs by
--                          account_name (owner pool, FORCE inert); cron enumeration is privileged by design.
--   voicemails           — voice/ingest.ts:136 INSERT via withTenantTransaction + explicit org; mutations GUC.
--   photo_jobs           — photos/jobs.ts:24 INSERT explicit org; admin/photos/stats now tenantQuery.
--
-- Idempotent + guarded. Revert one: SELECT relax_tenant_isolation('<t>').
-- (Applied directly + recorded in schema_migrations because the runner is blocked
--  on the order_unit_amendments sha drift — see the audit doc.)
-- ============================================================================

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'audit_logs',
    'photo_entity_links',
    'amazon_accounts',
    'voicemails',
    'photo_jobs'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'backstop_wave6: skip % (does not exist)', t; CONTINUE;
    END IF;
    BEGIN
      PERFORM enforce_tenant_isolation(t);
      RAISE NOTICE 'backstop_wave6: FORCEd %', t;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'backstop_wave6: enforce(%) failed: % — left unforced', t, SQLERRM;
    END;
  END LOOP;
END $$;
