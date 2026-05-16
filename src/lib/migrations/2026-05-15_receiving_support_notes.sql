-- Carton-level support notes (Zendesk context, PO-level ops notes).
-- Distinct from receiving_lines.notes (per PO line item).

ALTER TABLE receiving
  ADD COLUMN IF NOT EXISTS support_notes TEXT;

COMMENT ON COLUMN receiving.support_notes IS
  'Package/carton-level support notes; not tied to a single receiving_lines row.';
