-- Receiving-history carrier-status consistency — Phase C/F.
--
-- 1. Add tracking_blocked_reason (C1): a distinct marker for carriers we cannot
--    reach (USPS 403 IP-Agreement gate, persistent 401/403) so the UI shows
--    TRACKING_UNAVAILABLE instead of leaving the shipment silently pre-delivered.
-- 2. Add delivered_source for auditability of *how* delivered-ness was decided.
-- 3. Backfill (F1): apply the new event-log-derived + monotonic delivered rule
--    (A1/A2) retroactively, and repair coherence violations (A4) where
--    is_delivered disagrees with delivered_at.
--
-- All additive / idempotent. Safe to re-run.

-- ─── 1 & 2. Columns ──────────────────────────────────────────────────────────
ALTER TABLE shipping_tracking_numbers
  ADD COLUMN IF NOT EXISTS tracking_blocked_reason TEXT NULL;

ALTER TABLE shipping_tracking_numbers
  ADD COLUMN IF NOT EXISTS delivered_source TEXT NULL;

-- ─── 3a. Backfill delivered from the event log ───────────────────────────────
-- Any shipment with a historical DELIVERED event in the append-only log is
-- delivered, monotonically and terminally, with delivered_at = the earliest
-- such event. This fixes rows that a late/out-of-order event left on an
-- in-transit latest_status_category (R1) and rows whose is_delivered drifted
-- back to false (R2).
WITH log AS (
  SELECT
    e.shipment_id,
    min(e.event_occurred_at) FILTER (WHERE e.normalized_status_category = 'DELIVERED') AS first_delivered_at,
    bool_or(e.normalized_status_category = 'DELIVERED')                                 AS has_delivered
  FROM shipment_tracking_events e
  GROUP BY e.shipment_id
)
UPDATE shipping_tracking_numbers stn
SET
  is_delivered     = true,
  is_terminal      = true,
  delivered_at     = COALESCE(stn.delivered_at, log.first_delivered_at, now()),
  delivered_source = 'event_log',
  next_check_at    = NULL,
  updated_at       = now()
FROM log
WHERE log.shipment_id = stn.id
  AND log.has_delivered = true
  AND (stn.is_delivered IS DISTINCT FROM true OR stn.delivered_at IS NULL);

-- ─── 3b. Coherence repair (A4): is_delivered ⇒ delivered_at IS NOT NULL ───────
-- A row flagged delivered but missing a timestamp gets the earliest delivered
-- event time, else its latest event time, else now().
UPDATE shipping_tracking_numbers stn
SET
  delivered_at     = COALESCE(
                       (SELECT min(e.event_occurred_at)
                          FROM shipment_tracking_events e
                         WHERE e.shipment_id = stn.id
                           AND e.normalized_status_category = 'DELIVERED'),
                       stn.latest_event_at,
                       now()
                     ),
  delivered_source = COALESCE(stn.delivered_source, 'latest'),
  is_terminal      = true,
  updated_at       = now()
WHERE stn.is_delivered = true
  AND stn.delivered_at IS NULL;
