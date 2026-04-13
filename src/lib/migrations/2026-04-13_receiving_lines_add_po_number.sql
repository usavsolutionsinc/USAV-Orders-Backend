-- Add zoho_purchaseorder_number to receiving_lines so PO# is stored directly
-- on each line instead of requiring a JOIN to the receiving table.
ALTER TABLE receiving_lines
  ADD COLUMN IF NOT EXISTS zoho_purchaseorder_number TEXT;

-- Backfill from the receiving table for any lines already linked
UPDATE receiving_lines rl
SET zoho_purchaseorder_number = r.zoho_purchaseorder_number
FROM receiving r
WHERE rl.receiving_id = r.id
  AND r.zoho_purchaseorder_number IS NOT NULL
  AND rl.zoho_purchaseorder_number IS NULL;
