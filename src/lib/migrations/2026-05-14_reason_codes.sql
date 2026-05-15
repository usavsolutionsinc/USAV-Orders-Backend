-- ============================================================================
-- 2026-05-14: Reason codes for inventory adjustments
-- ============================================================================
-- Replaces the free-text `reason` column on sku_stock_ledger with a typed
-- enum lookup. The text column stays for backward-compat — new writes also
-- stamp `reason_code_id` so reporting can group cleanly by category.
--
-- Categories drive financial classification:
--   shrinkage   — losses (damaged, theft, scrap)
--   adjustment  — neutral cycle counts, swaps, found-extras
--   sale        — outbound to customer
--   return      — inbound from customer or to vendor
--   movement    — internal moves (receive, bin transfer, putaway)
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS reason_codes (
  id              SERIAL PRIMARY KEY,
  code            TEXT UNIQUE NOT NULL,
  label           TEXT NOT NULL,
  category        TEXT NOT NULL,
  -- 'in' increases stock, 'out' decreases, 'either' allows both directions.
  direction       TEXT NOT NULL,
  requires_note   BOOLEAN NOT NULL DEFAULT false,
  requires_photo  BOOLEAN NOT NULL DEFAULT false,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  sort_order      INT NOT NULL DEFAULT 100,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reason_codes_active
  ON reason_codes(category, sort_order)
  WHERE is_active = true;

ALTER TABLE reason_codes
  ADD CONSTRAINT reason_codes_category_chk
  CHECK (category IN ('shrinkage','adjustment','sale','return','movement','initial')),
  ADD CONSTRAINT reason_codes_direction_chk
  CHECK (direction IN ('in','out','either'));

-- ─── Seed canonical codes (idempotent) ──────────────────────────────────────

INSERT INTO reason_codes (code, label, category, direction, requires_note, requires_photo, sort_order) VALUES
  ('BIN_PULL',         'Pulled from bin',          'movement',  'out',    false, false, 10),
  ('BIN_ADD',          'Put into bin',             'movement',  'in',     false, false, 11),
  ('RECEIVED',         'Received from vendor',     'movement',  'in',     false, false, 12),
  ('SWAP_IN',          'Swap (in)',                'adjustment','in',     false, false, 20),
  ('SWAP_OUT',         'Swap (out)',               'adjustment','out',    false, false, 21),
  ('CYCLE_COUNT_ADJ',  'Cycle count adjustment',   'adjustment','either', false, false, 30),
  ('FOUND',            'Found extra units',        'adjustment','in',     true,  false, 31),
  ('DAMAGED',          'Damaged / unsellable',     'shrinkage', 'out',    true,  true,  40),
  ('SCRAP',            'Scrapped',                 'shrinkage', 'out',    true,  true,  41),
  ('THEFT',            'Theft / missing',          'shrinkage', 'out',    true,  false, 42),
  ('SOLD_DIRECT',      'Sold direct (cash sale)',  'sale',      'out',    false, false, 50),
  ('RETURN_VENDOR',    'Return to vendor (RTV)',   'return',    'out',    true,  false, 60),
  ('RETURN_CUSTOMER',  'Customer return',          'return',    'in',     false, false, 61),
  ('INITIAL_BALANCE',  'Initial balance',          'initial',   'in',     false, false, 99)
ON CONFLICT (code) DO UPDATE SET
  label = EXCLUDED.label,
  category = EXCLUDED.category,
  direction = EXCLUDED.direction,
  requires_note = EXCLUDED.requires_note,
  requires_photo = EXCLUDED.requires_photo,
  sort_order = EXCLUDED.sort_order;

-- ─── Link the ledger to reason_codes ────────────────────────────────────────

ALTER TABLE sku_stock_ledger
  ADD COLUMN IF NOT EXISTS reason_code_id INT REFERENCES reason_codes(id);

CREATE INDEX IF NOT EXISTS idx_sku_stock_ledger_reason_code
  ON sku_stock_ledger(reason_code_id)
  WHERE reason_code_id IS NOT NULL;

-- Backfill: stamp existing ledger rows whose text reason matches a code.
UPDATE sku_stock_ledger sl
SET reason_code_id = rc.id
FROM reason_codes rc
WHERE sl.reason_code_id IS NULL
  AND UPPER(sl.reason) = rc.code;

COMMIT;
