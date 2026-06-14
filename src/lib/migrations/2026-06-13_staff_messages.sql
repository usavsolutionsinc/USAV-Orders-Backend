-- Staff-to-staff messages — the persistent side of the header clipboard
-- "send to staff" flow. A staffer copies something (tracking #, serial, order
-- #, free note), then sends it to a coworker, where it lands in that coworker's
-- header inbox bell (inbox:{staffId} Ably channel + this table for the backlog).
--
-- This is the FIRST inbox item that must survive a reload — the existing
-- ActivityInbox items (priority_unbox, warranty_claim, repair_status) are
-- ephemeral push toasts, and the tech-queue backlog is derived live from
-- receiving_*. A direct message has no other source of truth, so it gets a row.
--
-- Read model: GET /api/staff-messages?unread=1 seeds the bell on mount;
-- read_at flips when the recipient opens/dismisses it. Soft delete via
-- archived_at so a cleared message can't resurface but history is kept.

CREATE TABLE IF NOT EXISTS staff_messages (
  id BIGSERIAL PRIMARY KEY,
  organization_id UUID NOT NULL,
  sender_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  recipient_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  -- Source of the message. 'copied_text' = sent from the clipboard popover;
  -- room for plain notes / links later without a schema change.
  kind TEXT NOT NULL DEFAULT 'copied_text',
  -- Optional provenance (e.g. {"tone":"tracking","display":"…1234"}) so the
  -- recipient's row can render a typed chip instead of raw text.
  context JSONB,
  -- NULL = unread. Stamped when the recipient opens/dismisses the message.
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Soft delete so a cleared message never resurfaces yet stays auditable.
  archived_at TIMESTAMPTZ,
  CONSTRAINT staff_messages_body_not_blank CHECK (length(btrim(body)) > 0)
);

-- Hot path: the bell's "my unread inbox" query (recipient + live + unread),
-- newest first.
CREATE INDEX IF NOT EXISTS idx_staff_messages_recipient_inbox
  ON staff_messages (recipient_id, created_at DESC)
  WHERE archived_at IS NULL;
