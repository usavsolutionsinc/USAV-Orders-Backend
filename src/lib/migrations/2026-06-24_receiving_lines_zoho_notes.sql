-- ============================================================================
-- 2026-06-24_receiving_lines_zoho_notes.sql
--
-- Receiving redesign — NOTES COLLISION fix. receiving_lines.notes is currently
-- dual-purpose: zoho-receiving-sync maps the Zoho PO line `description` into it,
-- and `notes` is in both upsert `updatable` sets — so a re-sync OVERWRITES
-- operator-entered notes (the purchase-receive path even sets it NULL). Split the
-- Zoho-imported text into its own read-only column so the two writers stop
-- colliding: `notes` becomes operator-only; `zoho_notes` is Zoho-sourced.
--
-- The LineEditPanel "Zoho Notes" tab reads this read-only; "Notes" edits `notes`.
--
-- ADDITIVE + nullable. NO backfill: existing `notes` may already hold operator
-- edits mixed with the old import — we cannot cleanly separate retroactively, so
-- existing notes stay operator-owned and zoho_notes fills on the next PO sync.
-- receiving_lines is org-scoped + FORCEd already (2026-06-19); inherits the row's
-- tenant.
-- ROLLBACK: ALTER TABLE receiving_lines DROP COLUMN IF EXISTS zoho_notes.
-- ============================================================================

ALTER TABLE receiving_lines ADD COLUMN IF NOT EXISTS zoho_notes text;

COMMENT ON COLUMN receiving_lines.zoho_notes IS
  'Zoho PO line description (read-only import). Split out of receiving_lines.notes so a Zoho re-sync never clobbers operator notes. Written by zoho-receiving-sync; shown read-only in the LineEditPanel Zoho Notes tab. Receiving redesign notes-collision fix.';
