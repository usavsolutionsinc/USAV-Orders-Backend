-- ============================================================================
-- 2026-06-09: partial index for the scanned-not-yet-unboxed receiving state
-- ============================================================================
-- The Zoho-received reconcile (src/lib/receiving/zoho-received-reconcile.ts)
-- runs on every PO-mirror sync (15-min cron + the triage Sync Zoho button) and
-- filters receiving on `received_at IS NOT NULL AND unboxed_at IS NULL` — the
-- triage SCANNED queue state. Neither column is indexed, so as `receiving`
-- grows each tick risks a seq-scan just to evaluate two nullable timestamps.
-- This partial index keeps the recurring zero-candidate run ~free: the planner
-- drives zoho_po_mirror(status) → receiving_lines(zoho_po_id) → here.
--
-- Additive + idempotent.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_receiving_scanned_queue
  ON receiving (id)
  WHERE received_at IS NOT NULL AND unboxed_at IS NULL;
