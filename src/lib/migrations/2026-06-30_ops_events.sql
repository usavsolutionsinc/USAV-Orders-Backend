-- ============================================================================
-- 2026-06-30: ops_events — polymorphic event log (SAL-style)
-- ============================================================================
-- Purpose: a single append-only event spine for operator-facing timelines
-- (first scan / last scan / unboxed / received) without overloading updated_at.
--
-- This is intentionally generic + polymorphic so additional domains can emit
-- events without new tables. Event types are TEXT (validated app-side) to keep
-- forward-compat with new events.
--
-- Tenant-from-birth: organization_id is stamped from app.current_org when set,
-- and is guarded by NOT NULL.
--
-- Idempotency: client_event_id is UNIQUE. Use it for retries/backfills.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS ops_events (
  id               BIGSERIAL PRIMARY KEY,
  organization_id  uuid NOT NULL
                    DEFAULT NULLIF(current_setting('app.current_org', true), '')::uuid,
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  event_type       text NOT NULL,

  -- Polymorphic subject
  entity_type      text NOT NULL,   -- 'receiving' | 'receiving_line' | 'serial_unit' | ...
  entity_id        bigint NOT NULL,

  -- Actor
  actor_staff_id   integer REFERENCES staff(id) ON DELETE SET NULL,

  -- Idempotency
  client_event_id  text UNIQUE,

  payload          jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_ops_events_org_entity_time
  ON ops_events (organization_id, entity_type, entity_id, occurred_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_ops_events_org_type_time
  ON ops_events (organization_id, event_type, occurred_at DESC, id DESC);

COMMENT ON TABLE ops_events IS
  'Polymorphic append-only ops event log (SAL-style). Used for stable first/last scan + unboxed/received timelines without relying on updated_at.';

COMMENT ON COLUMN ops_events.client_event_id IS
  'UNIQUE idempotency key for retries/backfills (similar to inventory_events.client_event_id).';

COMMIT;

