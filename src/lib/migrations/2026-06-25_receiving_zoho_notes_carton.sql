-- ============================================================================
-- 2026-06-25_receiving_zoho_notes_carton.sql
--
-- Notes-collision follow-up. The "Zoho Notes" tab should show the OVERALL,
-- PO-level Zoho note (Zoho PO header `notes`) — not the per-line item
-- description. So the overall note gets a carton-level home here, distinct from
-- receiving_lines.zoho_notes (which stays the per-line Zoho item `description`,
-- shown as a separate "Item description" block in the tab).
--
--   receiving.zoho_notes        = Zoho PO header notes  (overall, one per PO)
--   receiving_lines.zoho_notes  = Zoho line description  (per-line item desc)
--
-- Written by zoho-receiving-sync from `po.notes`. Read carton-level by
-- /api/receiving-lines (r.zoho_notes AS receiving_zoho_notes), mirroring
-- receiving.support_notes → receiving_support_notes.
--
-- ADDITIVE + nullable. receiving is org-scoped + FORCEd (2026-06-19); inherits
-- the row's tenant. ROLLBACK: ALTER TABLE receiving DROP COLUMN IF EXISTS zoho_notes.
-- ============================================================================

ALTER TABLE receiving ADD COLUMN IF NOT EXISTS zoho_notes text;

COMMENT ON COLUMN receiving.zoho_notes IS
  'Zoho PO header notes (overall, carton-level). Shown as the primary content of the LineEditPanel Zoho Notes tab; distinct from receiving_lines.zoho_notes (per-line item description). Written by zoho-receiving-sync from po.notes.';
