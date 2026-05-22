-- PO Mailbox Triage — Phase 1.
--
-- Renames the email worklist table to its final name and adds the
-- per-email triage state used by the sidebar "pile" UI (Inbox →
-- Upload to Zoho → Done, plus an Ignore pile).
--
-- Phases (for context):
--   1. (this file) schema + pile API + auto-resolve hook
--   2. sidebar piles + drag-and-drop
--   3. checklist pane (right-pane / mobile bottom-sheet)
--   4. LLM extractor for low-confidence fields
--
-- Backwards compatibility:
--   The original `status` column (pending|ignored|resolved) is kept and
--   stays in lockstep with `pile` via a trigger. Once every caller reads
--   `pile`, a follow-up migration will drop `status`. Doing the swap in
--   two steps keeps the cron auto-resolve query and the existing
--   PATCH /api/admin/po-gmail/missing-orders endpoint working through the
--   transition.

BEGIN;

-- ── 1. Rename table + indexes ────────────────────────────────────────────

ALTER TABLE IF EXISTS email_missing_orders
  RENAME TO email_missing_purchase_orders;

ALTER INDEX IF EXISTS idx_email_missing_orders_org_status_scanned
  RENAME TO idx_email_missing_purchase_orders_org_status_scanned;

ALTER INDEX IF EXISTS idx_email_missing_orders_po_norm_gin
  RENAME TO idx_email_missing_purchase_orders_po_norm_gin;

-- The unique constraint Postgres auto-created from `UNIQUE (organization_id,
-- gmail_msg_id)` keeps its old auto-generated name (email_missing_orders_*).
-- That's fine — constraint names aren't referenced anywhere in app code.


-- ── 2. Triage state columns ──────────────────────────────────────────────

ALTER TABLE email_missing_purchase_orders
  ADD COLUMN IF NOT EXISTS pile TEXT NOT NULL DEFAULT 'inbox'
    CHECK (pile IN ('inbox', 'upload', 'ignore', 'done')),
  ADD COLUMN IF NOT EXISTS triage_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS assigned_to UUID,
  ADD COLUMN IF NOT EXISTS zoho_uploaded_po_number TEXT,
  ADD COLUMN IF NOT EXISTS zoho_uploaded_at TIMESTAMPTZ;

-- One-time backfill: derive `pile` from the existing `status` column for
-- rows that predate this migration. Only touch rows where pile is still
-- the inbox default — keeps the migration safe to re-run.
UPDATE email_missing_purchase_orders
   SET pile = CASE status
                WHEN 'ignored'  THEN 'ignore'
                WHEN 'resolved' THEN 'done'
                ELSE 'inbox'
              END
 WHERE pile = 'inbox'
   AND status <> 'pending';


-- ── 3. Index for pile-grouped sidebar queries ────────────────────────────

CREATE INDEX IF NOT EXISTS idx_email_missing_purchase_orders_org_pile_scanned
  ON email_missing_purchase_orders (organization_id, pile, scanned_at DESC);


-- ── 4. Keep `status` in lockstep with `pile` ─────────────────────────────
--
-- Existing callers (reconcile, missing-orders, po-sync cron) still read
-- `status`. New callers will write `pile`. The trigger maps either direction
-- so legacy reads stay correct without forcing a coordinated cutover.
--
--   pile='inbox'  → status='pending'   (untriaged or sent back)
--   pile='upload' → status='pending'   (still active work)
--   pile='ignore' → status='ignored'
--   pile='done'   → status='resolved'  (also stamps resolved_at)

CREATE OR REPLACE FUNCTION email_missing_purchase_orders_sync_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  effective_pile TEXT;
BEGIN
  -- Pick the authoritative pile for this row, then derive status +
  -- resolved_at from it. Two write paths converge here:
  --   • New code writes `pile`            → pile is authoritative.
  --   • Legacy code writes `status` only  → derive pile from status,
  --     preserving 'upload' (status can't distinguish inbox vs upload).
  IF TG_OP = 'INSERT' OR NEW.pile IS DISTINCT FROM OLD.pile THEN
    effective_pile := NEW.pile;
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    effective_pile := CASE NEW.status
                        WHEN 'ignored'  THEN 'ignore'
                        WHEN 'resolved' THEN 'done'
                        ELSE CASE WHEN OLD.pile = 'upload' THEN 'upload' ELSE 'inbox' END
                      END;
  ELSE
    RETURN NEW;
  END IF;

  NEW.pile := effective_pile;
  NEW.status := CASE effective_pile
                  WHEN 'ignore' THEN 'ignored'
                  WHEN 'done'   THEN 'resolved'
                  ELSE 'pending'
                END;
  IF effective_pile = 'done' AND NEW.resolved_at IS NULL THEN
    NEW.resolved_at := NOW();
  ELSIF effective_pile <> 'done' THEN
    NEW.resolved_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_email_missing_purchase_orders_sync_status
  ON email_missing_purchase_orders;

CREATE TRIGGER trg_email_missing_purchase_orders_sync_status
  BEFORE INSERT OR UPDATE ON email_missing_purchase_orders
  FOR EACH ROW
  EXECUTE FUNCTION email_missing_purchase_orders_sync_status();

COMMIT;
