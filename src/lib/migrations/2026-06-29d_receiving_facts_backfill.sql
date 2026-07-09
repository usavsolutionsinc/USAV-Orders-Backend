-- ============================================================================
-- 2026-06-29d_receiving_facts_backfill.sql
--
-- Receiving polymorphic refactor — Layer 2 one-time backfill.
-- Plan: docs/todo/polymorphic-tables-database-refactor-plan.md §7 Step B.
--
-- Projects the wide one-street columns currently on receiving_lines (and the
-- carton-level return columns on receiving) into the typed-facts side-tables
-- created by 2026-06-29c. ADDITIVE + IDEMPOTENT: every insert is ON CONFLICT DO
-- NOTHING, and the source columns are left UNTOUCHED (they are dropped only after
-- the per-street reader cutover). Re-running is a no-op.
--
-- ORG STAMPING: the migration runs as the table owner (BYPASSRLS) with no tenant
-- GUC, so organization_id is set EXPLICITLY from the source row (rl/r.organization_id),
-- never left to the GUC default. RLS on the facts tables is armed-not-forced +
-- inert under the owner, so these inserts succeed.
--
-- NOTE on grain:
--   receiving_line_zoho     — only genuinely Zoho-origin lines (real PO/PR id,
--                             unit_price, or zoho_notes). Unmatched lines carry a
--                             NOT-NULL placeholder zoho_item_id only → excluded.
--   receiving_line_testing  — EVERY line (testing facts are universal stage facts
--                             with NOT-NULL defaults; preserved 1:1).
--   receiving_line_return   — RETURN/TRADE_IN lines (+ any line with a source_order_id).
--   receiving_line_putaway  — lines with a location_code.
--   receiving_line_facts    — marketplace_listing / sourcing_import / repair_service,
--                             only where the source column(s) are present.
--
-- ROLLBACK (truncate the projections; the source columns are intact):
--   TRUNCATE receiving_line_zoho, receiving_line_testing, receiving_line_return,
--            receiving_line_putaway; DELETE FROM receiving_line_facts
--            WHERE fact_kind IN ('marketplace_listing','sourcing_import','repair_service');
-- VERIFY: the RAISE NOTICE counts at the end; spot-check a Zoho line + a return line.
-- ============================================================================

BEGIN;

-- ── receiving_line_zoho (Zoho-origin lines only) ────────────────────────────
-- NOTE: receiving_line_zoho HAS a zoho_reference_number column, but the live
-- receiving_lines table does NOT (it was dropped long ago; the Drizzle model still
-- declares it — pre-existing drift flagged in the schema-wide plan's data-integrity
-- findings). So we don't backfill it here; it stays NULL until a Zoho sync sets it.
INSERT INTO receiving_line_zoho (
  receiving_line_id, organization_id, zoho_item_id, zoho_line_item_id,
  zoho_purchase_receive_id, zoho_purchaseorder_id, zoho_purchaseorder_number,
  zoho_sync_source, zoho_last_modified_time, zoho_synced_at,
  zoho_notes, unit_price)
SELECT rl.id, rl.organization_id, rl.zoho_item_id, rl.zoho_line_item_id,
       rl.zoho_purchase_receive_id, rl.zoho_purchaseorder_id, rl.zoho_purchaseorder_number,
       rl.zoho_sync_source, rl.zoho_last_modified_time, rl.zoho_synced_at,
       rl.zoho_notes, rl.unit_price
  FROM receiving_lines rl
 WHERE rl.zoho_purchaseorder_id IS NOT NULL
    OR rl.zoho_purchase_receive_id IS NOT NULL
    OR rl.unit_price IS NOT NULL
    OR rl.zoho_notes IS NOT NULL
ON CONFLICT (receiving_line_id) DO NOTHING;

-- ── receiving_line_testing (every line — universal stage facts) ─────────────
INSERT INTO receiving_line_testing (
  receiving_line_id, organization_id, needs_test, assigned_tech_id, qa_status,
  disposition_code, condition_grade, disposition_final, disposition_audit)
SELECT rl.id, rl.organization_id, rl.needs_test, rl.assigned_tech_id, rl.qa_status,
       rl.disposition_code, rl.condition_grade, rl.disposition_final,
       COALESCE(rl.disposition_audit, '[]'::jsonb)
  FROM receiving_lines rl
ON CONFLICT (receiving_line_id) DO NOTHING;

-- ── receiving_line_return (RETURN/TRADE_IN lines; carton return fields) ─────
INSERT INTO receiving_line_return (
  receiving_line_id, organization_id, return_platform, return_reason, source_order_id)
SELECT rl.id, rl.organization_id, r.return_platform, r.return_reason, rl.source_order_id
  FROM receiving_lines rl
  LEFT JOIN receiving r ON r.id = rl.receiving_id
 WHERE COALESCE(r.is_return, false) = true
    OR upper(COALESCE(rl.receiving_type, '')) IN ('RETURN', 'TRADE_IN')
    OR rl.source_order_id IS NOT NULL
ON CONFLICT (receiving_line_id) DO NOTHING;

-- ── receiving_line_putaway (lines with a bin) ───────────────────────────────
INSERT INTO receiving_line_putaway (receiving_line_id, organization_id, location_code)
SELECT rl.id, rl.organization_id, rl.location_code
  FROM receiving_lines rl
 WHERE rl.location_code IS NOT NULL
ON CONFLICT (receiving_line_id) DO NOTHING;

-- ── receiving_line_facts: marketplace_listing (triage/unmatched provenance) ──
INSERT INTO receiving_line_facts (organization_id, receiving_line_id, fact_kind, payload)
SELECT rl.organization_id, rl.id, 'marketplace_listing',
       jsonb_strip_nulls(jsonb_build_object(
         'sourcePlatformPill', rl.source_platform_pill,
         'listingUrl',         rl.listing_url,
         'listingReference',   rl.listing_reference,
         'skuPlatformIdRow',   rl.sku_platform_id_row))
  FROM receiving_lines rl
 WHERE rl.source_platform_pill IS NOT NULL
    OR rl.listing_url IS NOT NULL
    OR rl.listing_reference IS NOT NULL
    OR rl.sku_platform_id_row IS NOT NULL
ON CONFLICT (organization_id, receiving_line_id, fact_kind) DO NOTHING;

-- ── receiving_line_facts: sourcing_import (source_system + manual_entry_at) ──
INSERT INTO receiving_line_facts (organization_id, receiving_line_id, fact_kind, payload)
SELECT rl.organization_id, rl.id, 'sourcing_import',
       jsonb_strip_nulls(jsonb_build_object(
         'sourceSystem',  rl.source_system,
         'manualEntryAt', rl.manual_entry_at::text))
  FROM receiving_lines rl
 WHERE rl.source_system IS NOT NULL
    OR rl.manual_entry_at IS NOT NULL
ON CONFLICT (organization_id, receiving_line_id, fact_kind) DO NOTHING;

-- ── receiving_line_facts: repair_service flag ───────────────────────────────
INSERT INTO receiving_line_facts (organization_id, receiving_line_id, fact_kind, payload)
SELECT rl.organization_id, rl.id, 'repair_service', jsonb_build_object('isRepairService', true)
  FROM receiving_lines rl
 WHERE rl.is_repair_service = true
ON CONFLICT (organization_id, receiving_line_id, fact_kind) DO NOTHING;

-- ── Dry-run-style report (counts; nothing silently lost) ────────────────────
DO $$
DECLARE
  n_lines   bigint;
  n_zoho    bigint; n_test bigint; n_ret bigint; n_put bigint; n_facts bigint;
BEGIN
  SELECT count(*) INTO n_lines FROM receiving_lines;
  SELECT count(*) INTO n_zoho  FROM receiving_line_zoho;
  SELECT count(*) INTO n_test  FROM receiving_line_testing;
  SELECT count(*) INTO n_ret   FROM receiving_line_return;
  SELECT count(*) INTO n_put   FROM receiving_line_putaway;
  SELECT count(*) INTO n_facts FROM receiving_line_facts;
  RAISE NOTICE 'receiving facts backfill: % lines → zoho=% testing=% return=% putaway=% registry=%',
    n_lines, n_zoho, n_test, n_ret, n_put, n_facts;
END $$;

COMMIT;
