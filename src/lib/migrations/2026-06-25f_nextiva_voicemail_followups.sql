-- Voicemail follow-ups — the in-app call-back to-do spine.
--
-- Why: a voicemail is a fact (the message); whether someone still owes the
-- caller a call back is in-app workflow state that Nextiva knows nothing about.
-- This table holds that durable "who owns this, and is it still open" fact —
-- exactly the support_ticket_assignments pattern, extended with a status +
-- snooze. A voicemail.created webhook auto-creates one `open` row here (in the
-- webhook after()), and the Voicemail Workbench works the list down to done.
--
-- The to-do list = voicemail_followups JOIN voicemails, filtered
-- status IN ('open','snoozed') AND (snooze_until IS NULL OR snooze_until <= now()),
-- newest voicemail first.
--
-- One follow-up per voicemail (UNIQUE on org + voicemail); re-opening upserts.
-- Tenant-from-birth (mirrors 2026-06-24_support_ticket_assignments.sql).

BEGIN;

CREATE TABLE IF NOT EXISTS voicemail_followups (
  id                BIGSERIAL PRIMARY KEY,
  organization_id   UUID NOT NULL DEFAULT (
    COALESCE(
      NULLIF(current_setting('app.current_org', true), '')::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid
    )
  ),
  voicemail_id      BIGINT NOT NULL REFERENCES voicemails(id) ON DELETE CASCADE,
  status            TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'snoozed' | 'done' | 'no_action'
  assigned_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  assigned_by       INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  snooze_until      TIMESTAMPTZ,
  resolved_at       TIMESTAMPTZ,
  resolved_by       INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  note              TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, voicemail_id)
);

-- The open-queue read path: filter by status + assignee within the org.
CREATE INDEX IF NOT EXISTS idx_vm_followups_open
  ON voicemail_followups (organization_id, status, assigned_staff_id);

COMMIT;
