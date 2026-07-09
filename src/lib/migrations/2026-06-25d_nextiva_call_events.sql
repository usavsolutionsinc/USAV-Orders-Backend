-- Nextiva call events — the org's inbound/outbound/missed call log.
--
-- Why: the Support page's "Calls" mode is a Monitor over this org-scoped stream,
-- and a voicemail row links back to the call that produced it. Rows arrive two
-- ways that MUST converge to one record: the realtime webhook
-- (/api/integrations/nextiva/webhook/[token]) and the catch-up poll
-- (nextivaSync). Idempotency is the UNIQUE(org, provider, external_call_id) —
-- a re-delivered webhook or an overlapping sync collapses to a no-op upsert.
--
-- Tenant-from-birth: organization_id NOT NULL defaulted from the app.current_org
-- GUC so inserts under withTenantTransaction auto-stamp; per-org uniqueness.
-- Mirrors 2026-06-24_support_ticket_assignments.sql.

BEGIN;

CREATE TABLE IF NOT EXISTS call_events (
  id                BIGSERIAL PRIMARY KEY,
  organization_id   UUID NOT NULL DEFAULT (
    COALESCE(
      NULLIF(current_setting('app.current_org', true), '')::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid
    )
  ),
  provider          TEXT NOT NULL DEFAULT 'nextiva',
  external_call_id  TEXT NOT NULL,                 -- Nextiva call id (idempotency anchor)
  direction         TEXT NOT NULL,                 -- 'inbound' | 'outbound' | 'missed'
  from_number       TEXT,
  to_number         TEXT,
  counterparty_e164 TEXT,                          -- normalized customer number (match key)
  agent_staff_id    INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  status            TEXT,                          -- ringing | answered | ended | no_answer | busy
  started_at        TIMESTAMPTZ,
  ended_at          TIMESTAMPTZ,
  duration_seconds  INTEGER,
  -- Denormalized linkage cache (best-effort; canonical ticket link is ticket_links).
  matched_customer  JSONB,                         -- { name, email, phone, source }
  linked_order_id   BIGINT,
  linked_ticket_id  BIGINT,
  raw               JSONB,                         -- original webhook / REST payload
  client_event_id   TEXT,                          -- retry idempotency (mirror inventory_events)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, provider, external_call_id)
);

-- Monitor stream: newest-first within the org.
CREATE INDEX IF NOT EXISTS idx_call_events_org_started
  ON call_events (organization_id, started_at DESC);

-- Caller match: "what calls came from this number?"
CREATE INDEX IF NOT EXISTS idx_call_events_counterparty
  ON call_events (organization_id, counterparty_e164);

COMMIT;
