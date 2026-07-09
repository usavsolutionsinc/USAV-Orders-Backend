-- ============================================================================
-- 2026-07-01b: receiving triage columns (docs/receiving-triage-redesign-plan.md
-- §2.2, decision D2 — flat columns on `receiving`, not a new side-table).
-- ============================================================================
-- Triage (the "identify the carton before unbox" pass) needs a few carton-grain
-- fields that don't exist anywhere yet: which physical shelf/lane the carton is
-- staged to, whether pairing (PO/claim matching) has succeeded, and a real
-- "save for unbox" completion stamp. Mirrors how priority_tier / is_priority /
-- intake_type / exception_code already live directly on `receiving` — see
-- 2026-06-09_receiving_priority_tier.sql for the precedent this follows.
--
-- staging_location_id reuses the EXISTING `locations` shelf/bin catalog
-- (row_label/col_label/bin_type/capacity/barcode addressing, already seeded) —
-- no parallel staging-shelf table.
--
-- Additive + idempotent. No backfill needed: every existing carton defaults to
-- pairing_state='UNFOUND' (mirrors today's implicit unfound state) and
-- triage_complete=false (nothing has ever gone through the new save-for-unbox
-- transition, since it didn't exist before this migration).
-- ============================================================================

BEGIN;

ALTER TABLE receiving
  ADD COLUMN IF NOT EXISTS staging_location_id    INTEGER REFERENCES locations(id),
  ADD COLUMN IF NOT EXISTS priority_lane           TEXT,
  ADD COLUMN IF NOT EXISTS pairing_state           TEXT NOT NULL DEFAULT 'UNFOUND',
  ADD COLUMN IF NOT EXISTS last_pair_attempt_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS triage_complete         BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS triage_completed_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS triage_completed_by     INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS triage_client_event_id  TEXT;

ALTER TABLE receiving
  DROP CONSTRAINT IF EXISTS receiving_pairing_state_chk;
ALTER TABLE receiving
  ADD CONSTRAINT receiving_pairing_state_chk
  CHECK (pairing_state IN ('UNFOUND', 'MATCHED', 'WAIVED'));

-- triage_client_event_id backs POST /api/receiving/triage/complete's
-- idempotency (a retried "Save for unbox" click/network-flake is a no-op, not
-- a double-write) — same UNIQUE-key pattern as inventory_events.client_event_id
-- (.claude/rules/backend-patterns.md).
DROP INDEX IF EXISTS idx_receiving_triage_client_event_id;
CREATE UNIQUE INDEX IF NOT EXISTS idx_receiving_triage_client_event_id
  ON receiving(triage_client_event_id)
  WHERE triage_client_event_id IS NOT NULL;

-- Done tab (`?triview=done`) reads WHERE triage_complete = true — partial index
-- keeps that scan cheap since only a fraction of cartons will ever be staged.
CREATE INDEX IF NOT EXISTS idx_receiving_triage_complete
  ON receiving(organization_id, triage_completed_at DESC)
  WHERE triage_complete = true;

CREATE INDEX IF NOT EXISTS idx_receiving_staging_location
  ON receiving(staging_location_id)
  WHERE staging_location_id IS NOT NULL;

COMMENT ON COLUMN receiving.staging_location_id IS
  'Physical shelf/lane the carton is staged to before unbox. FK into the existing locations catalog — no parallel staging-shelf table.';
COMMENT ON COLUMN receiving.priority_lane IS
  'Small fixed vocabulary (PO_STOCKOUT | PO_STANDARD | RETURN | HOLD, see src/lib/receiving/triage-lane-policy.ts). Manual assignment always wins over the auto-routed default.';
COMMENT ON COLUMN receiving.pairing_state IS
  'UNFOUND | MATCHED | WAIVED — triage pairing-hub outcome for this carton. Read-through view of v_unfound_queue''s membership, not a duplicate source of truth for the unfound todo list itself.';
COMMENT ON COLUMN receiving.triage_complete IS
  'Set by POST /api/receiving/triage/complete (the real "Save for unbox" transition). Does NOT advance workflow_status — that remains the unbox street''s job.';
COMMENT ON COLUMN receiving.triage_client_event_id IS
  'Idempotency key for the triage-complete transition (mirrors inventory_events.client_event_id). UNIQUE among non-null values.';

COMMIT;
