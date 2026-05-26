-- 2026-05-25_mobile_scan_events.sql
--
-- Captures every scan made from the mobile cockpit (the center scan button on
-- /m/scan). This is the system-of-record for the universal scan → resolve →
-- route flow.
--
-- IMPORTANT: This table is intentionally separate from receiving_logs /
-- receiving_lines / receiving. The mobile center-button scan is NOT a
-- receiving event — it is a generic "I scanned a code, take me to the right
-- order" action. Writing to receiving from this surface would conflate two
-- different intents and break the receiving station's invariants. The
-- receiving stations write through their own /receiving APIs and read from
-- their own tables.

CREATE TABLE IF NOT EXISTS mobile_scan_events (
  id              BIGSERIAL PRIMARY KEY,
  staff_id        INTEGER NOT NULL REFERENCES staff(id),
  raw_value       TEXT NOT NULL,
  normalized      TEXT,
  -- Resolver classification result. One of:
  --   gs1_unit | gs1_lot | gs1_product | gs1_ai | location | package |
  --   order | stock | tracking | fnsku | serial_full | serial_partial |
  --   generic | unknown
  kind            TEXT NOT NULL,
  carrier         TEXT,
  -- When the resolver matched a single order, record it for analytics +
  -- recent-scans surfacing. NULL for multi/none/unmatched.
  matched_order_id TEXT,
  -- multi | single | none — what the resolver returned.
  match_outcome   TEXT NOT NULL CHECK (match_outcome IN ('single', 'multi', 'none')),
  -- Where the UI navigated (e.g. /m/orders/ORD-123, /m/scan?chooser=...).
  routed_to       TEXT,
  -- For multi-AI Data Matrix: parsed AI tree (GTIN/serial/lot/expiry/tracking).
  parsed_ais      JSONB,
  device_info     JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mobile_scan_events_staff_created
  ON mobile_scan_events (staff_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mobile_scan_events_order
  ON mobile_scan_events (matched_order_id)
  WHERE matched_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mobile_scan_events_kind
  ON mobile_scan_events (kind, created_at DESC);

COMMENT ON TABLE mobile_scan_events IS
  'System-of-record for /m/scan center-button scans. Strictly disjoint from receiving_* tables — mobile scans are intent-routing, not receiving events.';
