-- ============================================================================
-- 2026-06-28e: seed the SKU-stock manual-adjust vocabulary (flow_context='inventory_adjust')
-- ============================================================================
-- The SkuStockCard quick-adjust reasons (RECEIVED/SOLD/DAMAGED/ADJUSTMENT/
-- RETURNED/CYCLE_COUNT) were hardcoded in the component. Move them to reason_codes
-- for tenant relabeling. BEHAVIOR-BEARING: the code string is written to
-- sku_stock_ledger.reason and the replenish trigger keys on reason='SOLD', so the
-- CODES are preserved EXACTLY (the trigger is unchanged). Idempotent per org.
-- ============================================================================

BEGIN;

-- Allow the new vocabulary in the discriminator CHECK.
ALTER TABLE reason_codes DROP CONSTRAINT IF EXISTS reason_codes_flow_context_chk;
ALTER TABLE reason_codes ADD CONSTRAINT reason_codes_flow_context_chk
  CHECK (flow_context IN (
    'inventory_event','substitution','short_pick','receiving_exception',
    'repair_failure','verdict_detail','warranty_denial','inventory_adjust'
  ));

INSERT INTO reason_codes (organization_id, code, label, category, direction, flow_context, sort_order)
SELECT o.id, v.code, v.label, NULL, 'either', 'inventory_adjust', v.sort_order
FROM organizations o CROSS JOIN (VALUES
  ('RECEIVED',    'Received',     10),
  ('SOLD',        'Sold',         20),
  ('DAMAGED',     'Damaged',      30),
  ('ADJUSTMENT',  'Adjustment',   40),
  ('RETURNED',    'Returned',     50),
  ('CYCLE_COUNT', 'Cycle count',  60)
) AS v(code, label, sort_order)
ON CONFLICT (organization_id, flow_context, code) DO NOTHING;

COMMIT;
