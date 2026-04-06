-- Migration: Drop denormalized counter columns from fba_shipments
--
-- These columns (ready_item_count, packed_item_count, shipped_item_count) were
-- maintained by 9 separate UPDATE locations across the codebase. Every item status
-- change triggered an UPDATE on the parent shipment row.
--
-- All queries now compute counts inline via:
--   COUNT(*) FILTER (WHERE status IN (...)) FROM fba_shipment_items
--
-- For a 5-person team processing ~50 items/day, this eliminates ~450 unnecessary
-- writes/day and removes significant maintenance complexity.

ALTER TABLE fba_shipments DROP COLUMN IF EXISTS ready_item_count;
ALTER TABLE fba_shipments DROP COLUMN IF EXISTS packed_item_count;
ALTER TABLE fba_shipments DROP COLUMN IF EXISTS shipped_item_count;
