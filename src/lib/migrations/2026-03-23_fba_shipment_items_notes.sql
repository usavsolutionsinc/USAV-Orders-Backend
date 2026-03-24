-- Notes on line items (pending context, QC flags via QC_FAIL: prefix, etc.)
ALTER TABLE fba_shipment_items
  ADD COLUMN IF NOT EXISTS notes TEXT;
