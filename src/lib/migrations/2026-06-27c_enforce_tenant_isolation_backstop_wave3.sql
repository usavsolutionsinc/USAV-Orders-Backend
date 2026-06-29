-- ============================================================================
-- 2026-06-27c_enforce_tenant_isolation_backstop_wave3.sql
--
-- Backstop wave 3: tables whose flagged ⛔ routes were verified (2026-06-27) to be
-- the static auditor's FALSE POSITIVES (table name only in a comment / the route
-- delegates to a lib helper that is ALREADY tenantQuery-based) AND whose writer
-- helper is fully GUC-scoped — so routes AND helpers are clean. FORCE is therefore
-- both safe (no writer breaks) and COMPLETE (no owner-pool helper keeps bypassing
-- it). Evidence:
--   checklist_templates             — @/lib/neon/checklist-queries (tenantQuery/withTenantTransaction); route /api/checklists name-in-comment only
--   receiving_claim_seller_messages — @/lib/receiving-claim-seller-message (8× tenantQuery); route name-in-comment only
--   receiving_exceptions            — recordReceivingException in @/lib/receiving/exceptions (3× tenantQuery)
--   zendesk_users                   — @/lib/zendesk-users-cache (tenantQuery/withTenantTransaction)
--
-- NOT included (verified route-clean but their HELPERS still use the raw owner pool —
-- FORCE would give a FALSE green: the canary on app_tenant passes while the owner-pool
-- helper keeps leaking. Convert the helper to tenantQuery FIRST, then FORCE):
--   ticket_links, unfound_overlay   → src/lib/zendesk-links.ts raw pool.query (:44 INSERT, :67 DELETE, :114/:133 SELECT)
--   photo_entity_links              → src/lib/photos/queries/library.ts:299, packer-list.ts:38/66/83 raw pool
--   warranty_claims                 → src/lib/warranty/zendesk-link.ts:64/119, warranty/claims.ts (3 raw pool.query)
--
-- Idempotent + guarded. Revert one table: SELECT relax_tenant_isolation('<t>').
-- PRE-APPLY: run `npm run tenancy:guard:check` then `npm run tenancy:canary` (record gap).
-- ============================================================================

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'checklist_templates',
    'receiving_claim_seller_messages',
    'receiving_exceptions',
    'zendesk_users'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'backstop_wave3: skip % (does not exist)', t; CONTINUE;
    END IF;
    BEGIN
      PERFORM enforce_tenant_isolation(t);
      RAISE NOTICE 'backstop_wave3: FORCEd %', t;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'backstop_wave3: enforce(%) failed: % — left unforced', t, SQLERRM;
    END;
  END LOOP;
END $$;
