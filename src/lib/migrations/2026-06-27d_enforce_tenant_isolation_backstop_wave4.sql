-- ============================================================================
-- 2026-06-27d_enforce_tenant_isolation_backstop_wave4.sql
--
-- Backstop wave 4: ticket_links + unfound_overlay. The flagged ⛔ routes were
-- auditor false positives (delegate to lib helpers), AND this session converted
-- the shared helper src/lib/zendesk-links.ts from the raw owner pool to
-- `tenantQuery` (linkTicket / unlinkTicket / getTicketEntity reads + the
-- getEntityPhotos receiving_lines read, which also gained an explicit org
-- predicate). All OTHER writers were verified GUC-safe / explicit-org:
--   ticket_links:    voice/voicemail-mutations.ts (withTenantTransaction + explicit org)
--   unfound_overlay: api/receiving/unfound-queue/[kind]/[id]/route.ts (GUC, explicit org),
--                    .../push-to-zendesk/route.ts (GUC, explicit org),
--                    receiving/reconcile-unmatched.ts:214 (raw pool but explicit
--                    organization_id on the INSERT + ON CONFLICT(organization_id,...))
-- So routes + helpers + writers are all clean → FORCE is safe AND complete (no
-- owner-pool reader keeps bypassing it = no false green).
--
-- Idempotent + guarded. Revert: SELECT relax_tenant_isolation('<t>').
-- PRE-APPLY: `npm run tenancy:guard:check` then `npm run tenancy:canary`.
-- ============================================================================

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ticket_links',
    'unfound_overlay'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'backstop_wave4: skip % (does not exist)', t; CONTINUE;
    END IF;
    BEGIN
      PERFORM enforce_tenant_isolation(t);
      RAISE NOTICE 'backstop_wave4: FORCEd %', t;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'backstop_wave4: enforce(%) failed: % — left unforced', t, SQLERRM;
    END;
  END LOOP;
END $$;
