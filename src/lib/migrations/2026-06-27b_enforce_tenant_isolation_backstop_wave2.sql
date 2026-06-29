-- ============================================================================
-- 2026-06-27b_enforce_tenant_isolation_backstop_wave2.sql
--
-- Backstop wave 2: FORCE RLS + tenant_isolation policy + loud-fail default on
-- tenant-owned tables that have NO route touchers (writer-only) or all-GUC-safe
-- routes, AND whose every in-repo WRITER was verified (2026-06-27) to either run
-- under the tenant GUC (tenantQuery / withTenantTransaction) or stamp
-- organization_id explicitly — so FORCE + the loud-fail default cannot break a
-- write. Writer evidence per table:
--
--   amazon_api_calls          — amazon/client.ts:198 tenantQuery + explicit org
--   call_events               — voice/ingest.ts:73 withTenantTransaction
--   photo_analysis_runs       — photos/analyze.ts:204 raw pool but explicit org column
--   photo_share_pack_access   — photos/share-packs.ts:82 explicit org + GUC
--   photo_share_pack_links    — photos/share-packs.ts:44/52/60 explicit org + GUC
--   photo_share_packs         — photos/share-packs.ts:119 withTenantTransaction
--   photo_storage_providers   — photos/drive/client.ts:287 raw pool but explicit org
--   pipeline_cycles           — pipeline/orchestrator.ts:273 explicit organizationId
--   pipeline_tasks            — pipeline/orchestrator.ts:116 explicit organizationId
--   shipment_links            — shipping/shipment-links.ts:82 withTenantTransaction
--   staff_messages            — neon/staff-messages-queries.ts:88 withTenantTransaction
--   support_ticket_assignments— zendesk-assignments.ts:68 withTenantTransaction
--   training_samples          — pipeline/collect.ts explicit organizationId (app writer)
--   voicemail_followups       — voice/ingest.ts:175 withTenantTransaction (GUC stamps org)
--   zoho_webhook_events       — zoho/webhooks/dedupe.ts:21 tenantQuery
--
-- DELIBERATELY EXCLUDED (do NOT add without first fixing the writer):
--   training_runs  — UNSAFE: external scripts/jetson/trainer.py writes it with
--                    neither org nor GUC; FORCE+loud-fail breaks the training box.
--                    Patch trainer.py to stamp organization_id first.
--   hermes_insights / hermes_outcomes / hermes_precision_scores / hermes_thresholds,
--   photo_exports  — no in-repo writer found; populated externally. Confirm the
--                    external populator stamps org before forcing.
--   (Also note: scripts/e2e-pipeline.mjs inserts pipeline_/training_ rows without
--    org — test-only; will fail in CI post-FORCE until patched. Prod paths are safe.)
--
-- Idempotent + guarded per table. Revert one table: SELECT relax_tenant_isolation('<t>').
-- PRE-APPLY GATE: run `npm run tenancy:guard:check` (no raw-pool route on these) and
-- `npm run tenancy:canary` (record the gap before/after). After apply the gap drops
-- by the number of tables FORCEd here.
-- ============================================================================

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'amazon_api_calls',
    'call_events',
    'photo_analysis_runs',
    'photo_share_pack_access',
    'photo_share_pack_links',
    'photo_share_packs',
    'photo_storage_providers',
    'pipeline_cycles',
    'pipeline_tasks',
    'shipment_links',
    'staff_messages',
    'support_ticket_assignments',
    'training_samples',
    'voicemail_followups',
    'zoho_webhook_events'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'backstop_wave2: skip % (does not exist)', t; CONTINUE;
    END IF;
    BEGIN
      PERFORM enforce_tenant_isolation(t);
      RAISE NOTICE 'backstop_wave2: FORCEd %', t;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'backstop_wave2: enforce(%) failed: % — left unforced', t, SQLERRM;
    END;
  END LOOP;
END $$;
