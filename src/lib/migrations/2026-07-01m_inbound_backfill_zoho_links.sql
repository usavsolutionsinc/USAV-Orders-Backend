-- ============================================================================
-- 2026-07-01m_inbound_backfill_zoho_links.sql
--
-- Universal Incoming — Phase 1 backfill. Seeds the polymorphic identity for every
-- existing Zoho-originated receiving_line so the new link table is the SoT from
-- day one and existing Incoming rows keep their source badge.
-- Plan: docs/incoming-universal-purchase-orders-plan.md §3.6.
-- Depends on: 2026-07-01k (link table), 2026-07-01l (spine cache columns).
--
-- Runs as the BYPASSRLS migration owner and stamps organization_id EXPLICITLY
-- from each receiving_line, so the FORCE-RLS + loud-fail-default installed in
-- 2026-07-01k never blocks these writes.
--
-- IDEMPOTENT:
--   • UPDATE only fills NULL cache columns (COALESCE / IS NULL guards).
--   • Link INSERT is anti-joined (NOT EXISTS) and matches ux_inbound_po_links_natural.
-- Safe to re-run.
--
-- ROLLBACK (data): the link rows are recreated by any future Zoho sync, and the
-- cache columns are read-through; a hard undo is:
--   DELETE FROM inbound_purchase_order_links WHERE source_type = 'zoho';
--   UPDATE receiving_lines
--      SET inbound_source_type = NULL, source_line_item_id = NULL
--    WHERE inbound_source_type = 'zoho';
--   DROP INDEX IF EXISTS ux_receiving_lines_inbound_identity;
-- ============================================================================

BEGIN;

-- ── 1. Spine cache: mark existing Zoho lines with their primary source ──────
-- source_order_id / source_system pre-exist (2026-06-13c); only fill when unset.
UPDATE receiving_lines rl
   SET inbound_source_type = 'zoho',
       source_system       = COALESCE(rl.source_system, 'zoho'),
       source_order_id     = COALESCE(rl.source_order_id, rl.zoho_purchaseorder_id),
       source_line_item_id = COALESCE(rl.source_line_item_id, rl.zoho_line_item_id),
       updated_at          = now()
 WHERE rl.zoho_purchaseorder_id IS NOT NULL
   AND rl.inbound_source_type IS NULL;

-- ── 2. Backfill primary Zoho link rows from existing spine rows ─────────────
-- One is_primary='true' zoho link per Zoho-originated line. Anti-joined so a
-- re-run is a no-op; matches ux_inbound_po_links_natural
-- (org, line, source_type, source_order_id, COALESCE(source_line_item_id,'')).
INSERT INTO inbound_purchase_order_links (
  organization_id, receiving_line_id, source_type, source_order_id,
  source_line_item_id, is_primary, platform_account_id
)
SELECT rl.organization_id,
       rl.id,
       'zoho',
       rl.zoho_purchaseorder_id,
       rl.zoho_line_item_id,
       true,
       rl.platform_account_id
  FROM receiving_lines rl
 WHERE rl.zoho_purchaseorder_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1
       FROM inbound_purchase_order_links l
      WHERE l.organization_id = rl.organization_id
        AND l.receiving_line_id = rl.id
        AND l.source_type = 'zoho'
        AND l.source_order_id = rl.zoho_purchaseorder_id
        AND COALESCE(l.source_line_item_id, '') = COALESCE(rl.zoho_line_item_id, '')
   );

-- ── 3. Transition spine-identity unique index (created AFTER backfill) ───────
-- Long-term dedup is ux_inbound_po_links_natural on the link table; this spine
-- unique is a transition read-optimization (plan §3.6) and is dropped once the
-- link table is the sole Incoming SoT. We create it only if the backfilled data
-- has no duplicate identity group, so a legacy dupe (e.g. two spine rows sharing
-- a PO with a NULL line id — outside the reach of the existing global
-- ux_receiving_lines_zoho_po_line) surfaces as a WARNING to resolve rather than
-- failing the whole migration.
DO $$
DECLARE dup_groups int;
BEGIN
  SELECT count(*) INTO dup_groups FROM (
    SELECT 1
      FROM receiving_lines
     WHERE inbound_source_type IS NOT NULL
       AND source_order_id IS NOT NULL
     GROUP BY organization_id, inbound_source_type, source_order_id, COALESCE(source_line_item_id, '')
    HAVING count(*) > 1
  ) d;

  IF dup_groups > 0 THEN
    RAISE WARNING 'ux_receiving_lines_inbound_identity NOT created: % duplicate inbound-identity group(s) in receiving_lines. Resolve the dupes, then create the index in a follow-up migration.', dup_groups;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS ux_receiving_lines_inbound_identity
      ON receiving_lines (
        organization_id, inbound_source_type, source_order_id,
        COALESCE(source_line_item_id, '')
      )
      WHERE inbound_source_type IS NOT NULL
        AND source_order_id IS NOT NULL;
  END IF;
END $$;

COMMIT;
