-- Nextiva voicemails — the durable record of a left voicemail / missed-call message.
--
-- Why: the Support page's "Voicemail" mode is a Workbench over a follow-up to-do
-- list; this is the underlying message (audio + transcript + matched customer).
-- The follow-up *ownership/status* lives in the sibling voicemail_followups table
-- (2026-06-25f) so a voicemail's facts and its in-app workflow state stay
-- independent — same split as Zendesk ticket vs. support_ticket_assignments.
--
-- Idempotent on UNIQUE(org, provider, external_vm_id): a re-delivered
-- voicemail.created webhook or an overlapping nextivaSync is a no-op upsert.
-- recording_url is the Nextiva-hosted, auth-gated URL — NEVER exposed to the
-- browser; the /api/voicemails/[id]/recording proxy streams it server-side.
-- recording_blob_key is populated only if we archive to private Vercel Blob.
--
-- Tenant-from-birth (mirrors 2026-06-24_support_ticket_assignments.sql).

BEGIN;

CREATE TABLE IF NOT EXISTS voicemails (
  id                 BIGSERIAL PRIMARY KEY,
  organization_id    UUID NOT NULL DEFAULT (
    COALESCE(
      NULLIF(current_setting('app.current_org', true), '')::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid
    )
  ),
  provider           TEXT NOT NULL DEFAULT 'nextiva',
  external_vm_id     TEXT NOT NULL,                -- idempotency anchor
  call_event_id      BIGINT REFERENCES call_events(id) ON DELETE SET NULL,
  from_number        TEXT,
  counterparty_e164  TEXT,                         -- normalized customer number (match key)
  mailbox            TEXT,                         -- which Nextiva mailbox / extension
  left_at            TIMESTAMPTZ,
  duration_seconds   INTEGER,
  recording_url      TEXT,                         -- Nextiva-hosted; fetched via proxy
  recording_blob_key TEXT,                         -- optional: copied to private Vercel Blob
  transcript         TEXT,                         -- if Nextiva or our STT provides one
  is_read            BOOLEAN NOT NULL DEFAULT FALSE,
  matched_customer   JSONB,                        -- { name, email, phone, source }
  linked_order_id    BIGINT,
  linked_ticket_id   BIGINT,                       -- cache; ticket_links is the SoT
  raw                JSONB,
  client_event_id    TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, provider, external_vm_id)
);

-- Picker order: newest voicemail first within the org.
CREATE INDEX IF NOT EXISTS idx_voicemails_org_left
  ON voicemails (organization_id, left_at DESC);

-- Caller match.
CREATE INDEX IF NOT EXISTS idx_voicemails_counterparty
  ON voicemails (organization_id, counterparty_e164);

COMMIT;
