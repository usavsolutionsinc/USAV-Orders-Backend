-- Receiving — floor-as-SOT support for unmatched-tracking lines.
--
-- When a tracking number scans into receiving with no Zoho PO match,
-- lookup-po/route.ts already creates a receiving row with source='unmatched'.
-- Today that row has no lines and the operator is stuck. This migration adds
-- the columns needed for the operator to manually add line(s) via an Ecwid
-- product search (Phase 1: EcwidProductSearchPopover + UnfoundLineEditPanel).
--
-- Two structural changes:
--
--   1. New columns on receiving_lines:
--        sku_catalog_id        — FK to sku_catalog (the canonical SKU picked from Ecwid)
--        sku_platform_id_row   — FK to sku_platform_ids (the specific Ecwid listing chosen)
--        source_platform_pill  — operator override of the auto-detected platform
--                                (ebay | goodwill | amazon | aliexp | walmart | other)
--        intake_type           — po | return | trade_in
--        listing_url           — copy of receiving.listing_url scoped to the line for unmatched flow
--        listing_reference     — operator-entered "#" field (e.g. PO# or external ref)
--        location_code         — operator-entered "📍" field (warehouse bin / area code)
--        manual_entry_at       — timestamp the operator added the line via the unfound flow
--
--   2. Relax zoho_item_id NOT NULL:
--        Zoho-origin rows still carry it (importZohoPurchaseOrderToReceiving sets it).
--        Manually-added unmatched lines have no Zoho identifier — leave NULL.
--        mark-received-po.ts:530-537 already handles the no_zoho_link branch gracefully.
--
-- Condition grade is intentionally NOT added: receiving_lines.condition_grade
-- already exists (conditionGradeEnum, default 'BRAND_NEW') and maps directly
-- to the pill UI (BRAND_NEW | USED_A | USED_B | USED_C | PARTS). Collapse, not duplicate.
--
-- intake_type and source_platform_pill are plain TEXT (not enums) to avoid
-- the schema churn of enum ALTERs as platforms come and go. App-level validation
-- in src/lib/receiving/unfound-line-input.ts gates the writes.

BEGIN;

ALTER TABLE receiving_lines
  ADD COLUMN IF NOT EXISTS sku_catalog_id       INTEGER REFERENCES sku_catalog(id)      ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sku_platform_id_row  INTEGER REFERENCES sku_platform_ids(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_platform_pill TEXT,
  ADD COLUMN IF NOT EXISTS intake_type          TEXT,
  ADD COLUMN IF NOT EXISTS listing_url          TEXT,
  ADD COLUMN IF NOT EXISTS listing_reference    TEXT,
  ADD COLUMN IF NOT EXISTS location_code        TEXT,
  ADD COLUMN IF NOT EXISTS manual_entry_at      TIMESTAMPTZ;

-- Relax zoho_item_id so unmatched lines can be inserted without a Zoho identifier.
-- Safe to re-run: DROP NOT NULL is idempotent when the column is already nullable.
ALTER TABLE receiving_lines
  ALTER COLUMN zoho_item_id DROP NOT NULL;

-- Fast lookup from a chosen catalog SKU back to its receiving line — used by
-- Phase 3 reconciliation (mapping a resolved mailbox PO onto unmatched lines).
CREATE INDEX IF NOT EXISTS idx_receiving_lines_sku_catalog
  ON receiving_lines (sku_catalog_id)
  WHERE sku_catalog_id IS NOT NULL;

-- Partial index for the "manually-added unmatched lines" worklist surface.
CREATE INDEX IF NOT EXISTS idx_receiving_lines_manual_entry
  ON receiving_lines (manual_entry_at DESC)
  WHERE manual_entry_at IS NOT NULL;

COMMIT;
