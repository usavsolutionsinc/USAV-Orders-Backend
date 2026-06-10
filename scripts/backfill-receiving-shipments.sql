-- ============================================================================
-- Backfill: seed receiving_shipments primary rows from receiving.shipment_id
-- ============================================================================
-- docs/multi-tracking-po-plan.md — Phase 1.
--
-- Every existing carton that already carries a shipment_id (its reference#
-- tracking) becomes a clean 1-box PO: one is_primary row, box_seq 1. No
-- behavior change — this just makes the new junction read correct for history.
--
-- Idempotent: ON CONFLICT DO NOTHING. The attach-box endpoint self-heals the
-- same primary row per-carton on demand, so this is a convenience pass, not a
-- correctness prerequisite. Safe to re-run.
--
-- Run with:  psql "$DATABASE_URL" -f scripts/backfill-receiving-shipments.sql
-- ============================================================================

INSERT INTO receiving_shipments (receiving_id, shipment_id, box_seq, is_primary, received_at, received_by)
SELECT id, shipment_id, 1, true, received_at, received_by
FROM receiving
WHERE shipment_id IS NOT NULL
ON CONFLICT (receiving_id, shipment_id) DO NOTHING;
