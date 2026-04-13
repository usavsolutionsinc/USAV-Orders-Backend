-- Add receiving_type to receiving_lines to track how each item was received.
-- Values: PO, RETURN, TRADE_IN, PICKUP
ALTER TABLE receiving_lines
  ADD COLUMN IF NOT EXISTS receiving_type TEXT DEFAULT 'PO';
