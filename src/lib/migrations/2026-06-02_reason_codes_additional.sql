-- ============================================================================
-- 2026-06-02: Additional inventory reason codes
-- ============================================================================
-- Extends the canonical set seeded in 2026-05-14_reason_codes.sql with the
-- common warehouse reasons the team was otherwise free-texting. Idempotent
-- (ON CONFLICT (code) DO UPDATE) so it's safe to re-run.
--
-- category MUST stay within the reason_codes_category_chk set:
--   shrinkage | adjustment | sale | return | movement | initial
-- direction MUST be: in | out | either
-- ============================================================================

BEGIN;

INSERT INTO reason_codes (code, label, category, direction, requires_note, requires_photo, sort_order) VALUES
  -- ─ Movement (neutral internal flow) ─
  ('PUTAWAY',          'Putaway from receiving',   'movement',  'in',     false, false, 13),
  ('PICK',             'Picked for order',         'movement',  'out',    false, false, 14),
  ('TRANSFER_IN',      'Transfer in (warehouse)',  'movement',  'in',     false, false, 15),
  ('TRANSFER_OUT',     'Transfer out (warehouse)', 'movement',  'out',    false, false, 16),
  ('RELOCATE',         'Bin relocation',           'movement',  'either', false, false, 17),

  -- ─ Adjustment (neutral corrections) ─
  ('RECOUNT',          'Manual recount fix',       'adjustment','either', true,  false, 32),
  ('DATA_CORRECTION',  'Data-entry correction',    'adjustment','either', true,  false, 33),
  ('MERGE_DUPLICATE',  'Merge duplicate SKU stock','adjustment','either', true,  false, 34),
  ('UOM_CONVERSION',   'Unit-of-measure convert',  'adjustment','either', false, false, 35),

  -- ─ Shrinkage (losses — gated by note/photo) ─
  ('EXPIRED',          'Expired / end-of-life',    'shrinkage', 'out',    true,  false, 43),
  ('LOST',             'Lost / cannot locate',     'shrinkage', 'out',    true,  false, 44),
  ('QC_FAIL',          'Failed QC (scrapped)',     'shrinkage', 'out',    true,  true,  45),
  ('WARRANTY_SCRAP',   'Warranty write-off',       'shrinkage', 'out',    true,  false, 46),

  -- ─ Sale / outbound consumption ─
  ('MARKETPLACE_SALE', 'Marketplace sale',         'sale',      'out',    false, false, 51),
  ('SAMPLE',           'Sample / giveaway',        'sale',      'out',    true,  false, 52),
  ('INTERNAL_USE',     'Consumed internally',      'sale',      'out',    true,  false, 53),

  -- ─ Returns (customer / vendor / RMA) ─
  ('RMA_IN',           'RMA received back',        'return',    'in',     false, false, 62),
  ('RMA_OUT',          'Sent out for RMA/repair',  'return',    'out',    true,  false, 63),
  ('REFUSED_DELIVERY', 'Refused / returned to sender','return', 'in',     false, false, 64)
ON CONFLICT (code) DO UPDATE SET
  label = EXCLUDED.label,
  category = EXCLUDED.category,
  direction = EXCLUDED.direction,
  requires_note = EXCLUDED.requires_note,
  requires_photo = EXCLUDED.requires_photo,
  sort_order = EXCLUDED.sort_order;

COMMIT;
