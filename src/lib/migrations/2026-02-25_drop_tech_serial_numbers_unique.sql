-- Migration: Allow duplicate tech serial rows from sheet sync
-- Purpose: Preserve one-row-per-google-sheet-row behavior, including identical tracking+serial rows

ALTER TABLE tech_serial_numbers
DROP CONSTRAINT IF EXISTS tech_serial_numbers_unique;

