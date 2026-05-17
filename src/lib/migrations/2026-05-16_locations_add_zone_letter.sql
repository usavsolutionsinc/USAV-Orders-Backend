-- Move the room → zone-letter mapping from client localStorage to the DB.
-- Until now BinLabelPrinter kept `zoneMap` in browser localStorage keyed
-- `binPrinter.config.v3`, so two workstations could disagree about which
-- letter belonged to which room. The letter is what shows up on every
-- printed label and inside the GS1 QR — server-of-record state.
--
-- The column lives on the parent room row (row_label IS NULL AND
-- col_label IS NULL). Partial unique index prevents two active rooms from
-- claiming the same letter without forbidding bin rows from sharing letters
-- via their parent.

BEGIN;

ALTER TABLE locations
  ADD COLUMN IF NOT EXISTS zone_letter CHAR(1);

ALTER TABLE locations
  ADD CONSTRAINT locations_zone_letter_alpha
  CHECK (zone_letter IS NULL OR zone_letter ~ '^[A-Z]$')
  NOT VALID;

ALTER TABLE locations VALIDATE CONSTRAINT locations_zone_letter_alpha;

CREATE UNIQUE INDEX IF NOT EXISTS idx_locations_zone_letter_unique_active
  ON locations (zone_letter)
  WHERE zone_letter IS NOT NULL
    AND row_label IS NULL
    AND col_label IS NULL
    AND is_active = true;

COMMIT;
