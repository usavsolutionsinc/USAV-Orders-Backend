-- Allow receiving_lines rows that are not yet matched to a physical receiving scan.
-- Zoho PO sync creates receiving_lines with receiving_id = NULL (expected items).
-- When a package is scanned and unboxed in Mode1/Mode2, receiving_id gets set.

ALTER TABLE receiving_lines
  ALTER COLUMN receiving_id DROP NOT NULL,
  ALTER COLUMN quantity_received SET DEFAULT 0;
