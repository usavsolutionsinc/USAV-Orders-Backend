-- Fix DELETE endpoints that 500 on foreign-key / CHECK violations.
--
-- ON DELETE rules only fire when a parent row is deleted, so this migration is
-- inert for the normal receiving/unboxing flow (all INSERT/UPDATE/SELECT). It
-- only affects the explicit delete endpoints, which today error on any row that
-- has child rows:
--   * DELETE /api/receiving-logs            (DELETE FROM receiving)
--   * DELETE /api/receiving-lines           (DELETE FROM receiving_lines, single + by-PO)
--   * DELETE /api/receiving/unfound-queue/* (DELETE FROM orders_exceptions)
--
-- Four constraints, each guarded so the migration is a safe no-op where a table
-- has not landed yet. Names are the Postgres auto-generated `<table>_<col>_fkey`,
-- confirmed against the live schema.

DO $$
BEGIN
  ----------------------------------------------------------------------------
  -- receiving deletes: local-pickup back-references are advisory & nullable.
  -- NO ACTION -> SET NULL so deleting a receiving row unlinks them, not blocks.
  ----------------------------------------------------------------------------
  IF to_regclass('public.local_pickup_orders') IS NOT NULL THEN
    ALTER TABLE local_pickup_orders DROP CONSTRAINT IF EXISTS local_pickup_orders_receiving_id_fkey;
    ALTER TABLE local_pickup_orders ADD  CONSTRAINT local_pickup_orders_receiving_id_fkey
      FOREIGN KEY (receiving_id) REFERENCES receiving(id) ON DELETE SET NULL;
  END IF;

  IF to_regclass('public.local_pickup_order_items') IS NOT NULL THEN
    ALTER TABLE local_pickup_order_items DROP CONSTRAINT IF EXISTS local_pickup_order_items_receiving_id_fkey;
    ALTER TABLE local_pickup_order_items ADD  CONSTRAINT local_pickup_order_items_receiving_id_fkey
      FOREIGN KEY (receiving_id) REFERENCES receiving(id) ON DELETE SET NULL;
  END IF;

  ----------------------------------------------------------------------------
  -- receiving / receiving_lines deletes: the real blocker.
  -- receiving -> receiving_lines (CASCADE) -> tech_serial_numbers.receiving_line_id
  -- was SET NULL, which collides with chk_tech_serial_numbers_receiving_line_required
  -- (RECEIVING-station serials must keep a line). CASCADE removes the serial row
  -- instead of nulling it -> no CHECK violation. A deleted carton/line takes the
  -- serials scanned for it with it (the intended cleanup).
  ----------------------------------------------------------------------------
  IF to_regclass('public.tech_serial_numbers') IS NOT NULL THEN
    ALTER TABLE tech_serial_numbers DROP CONSTRAINT IF EXISTS tech_serial_numbers_receiving_line_id_fkey;
    ALTER TABLE tech_serial_numbers ADD  CONSTRAINT tech_serial_numbers_receiving_line_id_fkey
      FOREIGN KEY (receiving_line_id) REFERENCES receiving_lines(id) ON DELETE CASCADE;
  END IF;

  ----------------------------------------------------------------------------
  -- orders_exceptions deletes (unfound-queue): station_scan_sessions back-ref
  -- is nullable and advisory. NO ACTION -> SET NULL so the delete unlinks it.
  ----------------------------------------------------------------------------
  IF to_regclass('public.station_scan_sessions') IS NOT NULL THEN
    ALTER TABLE station_scan_sessions DROP CONSTRAINT IF EXISTS station_scan_sessions_orders_exception_id_fkey;
    ALTER TABLE station_scan_sessions ADD  CONSTRAINT station_scan_sessions_orders_exception_id_fkey
      FOREIGN KEY (orders_exception_id) REFERENCES orders_exceptions(id) ON DELETE SET NULL;
  END IF;
END $$;
