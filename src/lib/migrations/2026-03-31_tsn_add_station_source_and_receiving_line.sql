-- Add receiving-context linkage to tech_serial_numbers while keeping existing TECH/FBA flows intact.
-- Lean model:
--   - station_source: where the serial event originated
--   - receiving_line_id: optional FK for receiving/unboxing serial capture

BEGIN;

ALTER TABLE tech_serial_numbers
  ADD COLUMN IF NOT EXISTS station_source TEXT NOT NULL DEFAULT 'TECH',
  ADD COLUMN IF NOT EXISTS receiving_line_id INTEGER REFERENCES receiving_lines(id) ON DELETE SET NULL;

ALTER TABLE tech_serial_numbers
  DROP CONSTRAINT IF EXISTS chk_tech_serial_numbers_station_source;

ALTER TABLE tech_serial_numbers
  ADD CONSTRAINT chk_tech_serial_numbers_station_source
  CHECK (station_source IN ('TECH', 'RECEIVING', 'PACK', 'ADMIN'));

-- Receiving rows must carry a line anchor.
ALTER TABLE tech_serial_numbers
  DROP CONSTRAINT IF EXISTS chk_tech_serial_numbers_receiving_line_required;

ALTER TABLE tech_serial_numbers
  ADD CONSTRAINT chk_tech_serial_numbers_receiving_line_required
  CHECK (station_source <> 'RECEIVING' OR receiving_line_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_tsn_station_source_created
  ON tech_serial_numbers(station_source, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tsn_receiving_line_id
  ON tech_serial_numbers(receiving_line_id)
  WHERE receiving_line_id IS NOT NULL;

-- De-duplicate only within the same receiving line.
CREATE UNIQUE INDEX IF NOT EXISTS ux_tsn_receiving_line_serial
  ON tech_serial_numbers(receiving_line_id, UPPER(BTRIM(serial_number)))
  WHERE receiving_line_id IS NOT NULL;

COMMIT;
