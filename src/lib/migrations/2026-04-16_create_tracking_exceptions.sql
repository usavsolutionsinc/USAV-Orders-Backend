-- Migration: unified tracking_exceptions hold-bucket table.
-- Phase 1: additive only. orders_exceptions remains untouched.
-- Receiving scans that don't resolve to a Zoho PO/Receive upsert here with
-- domain='receiving'. orders domain is reserved for a future unification
-- (see plan in PR description); no orders code writes here yet.

CREATE TABLE IF NOT EXISTS tracking_exceptions (
  id                     SERIAL PRIMARY KEY,
  tracking_number        TEXT NOT NULL,
  domain                 VARCHAR(20) NOT NULL
                           CHECK (domain IN ('orders','receiving')),
  source_station         VARCHAR(20) NOT NULL,
  staff_id               INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  staff_name             TEXT,
  exception_reason       VARCHAR(50) NOT NULL DEFAULT 'not_found',
  notes                  TEXT,
  status                 VARCHAR(20) NOT NULL DEFAULT 'open'
                           CHECK (status IN ('open','resolved','discarded')),
  shipment_id            BIGINT REFERENCES shipping_tracking_numbers(id) ON DELETE SET NULL,
  receiving_id           INTEGER REFERENCES receiving(id) ON DELETE SET NULL,
  last_zoho_check_at     TIMESTAMPTZ,
  zoho_check_count       INTEGER NOT NULL DEFAULT 0,
  last_error             TEXT,
  domain_metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolved_at            TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Triage queue read path: "give me all open receiving exceptions, newest first".
CREATE INDEX IF NOT EXISTS idx_tracking_exceptions_domain_status_created
  ON tracking_exceptions (domain, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tracking_exceptions_status
  ON tracking_exceptions (status);

CREATE INDEX IF NOT EXISTS idx_tracking_exceptions_source_status
  ON tracking_exceptions (source_station, status);

-- Suffix-match indexes, identical to orders_exceptions so reconciliation can
-- reuse tracking-format.ts helpers verbatim.
CREATE INDEX IF NOT EXISTS idx_tracking_exceptions_key18
  ON tracking_exceptions (
    RIGHT(regexp_replace(UPPER(COALESCE(tracking_number, '')), '[^A-Z0-9]', '', 'g'), 18)
  );

CREATE INDEX IF NOT EXISTS idx_tracking_exceptions_last8
  ON tracking_exceptions (
    RIGHT(regexp_replace(COALESCE(tracking_number, ''), '\D', '', 'g'), 8)
  );

CREATE INDEX IF NOT EXISTS idx_tracking_exceptions_shipment_id
  ON tracking_exceptions (shipment_id)
  WHERE shipment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tracking_exceptions_receiving_id
  ON tracking_exceptions (receiving_id)
  WHERE receiving_id IS NOT NULL;

-- One open exception per (domain, source_station, tracking key-18). Idempotent
-- re-scans of the same unmatched tracking update the existing row instead of
-- creating a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tracking_exceptions_open_domain_source_key18
  ON tracking_exceptions (
    domain,
    source_station,
    RIGHT(regexp_replace(UPPER(COALESCE(tracking_number, '')), '[^A-Z0-9]', '', 'g'), 18)
  )
  WHERE status = 'open';
