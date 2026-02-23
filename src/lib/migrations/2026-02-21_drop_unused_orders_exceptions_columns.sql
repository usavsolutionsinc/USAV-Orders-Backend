-- Migration: remove unused orders_exceptions columns

ALTER TABLE orders_exceptions DROP COLUMN IF EXISTS occurrence_count;
ALTER TABLE orders_exceptions DROP COLUMN IF EXISTS first_seen_at;
ALTER TABLE orders_exceptions DROP COLUMN IF EXISTS last_seen_at;
