-- ============================================================================
-- 2026-06-28: reason_codes flow_context discriminator (Class-D multi-vocabulary)
-- ============================================================================
-- reason_codes began as an INVENTORY-EVENT vocabulary (category CHECK =
-- shrinkage|adjustment|sale|return|movement|initial, later + warranty_denial).
-- The Class-D plan (docs/operations-studio/HARDCODED-STATUS-ENGINE-MIGRATION-PLAN.md
-- §2.2 / §3.D / D1) generalizes it into ONE multi-vocabulary store keyed by a
-- `flow_context` discriminator, so substitution / short-pick / receiving-exception
-- / repair-failure reasons live in the SAME table WITHOUT polluting the ledger's
-- `category` axis.
--
-- Strictly additive + idempotent: existing rows backfill to 'inventory_event' via
-- the column DEFAULT, so every current query (which never references flow_context)
-- is byte-for-byte unchanged.
-- ============================================================================

BEGIN;

-- 1. The discriminator. Existing rows backfill to 'inventory_event' via DEFAULT.
ALTER TABLE reason_codes
  ADD COLUMN IF NOT EXISTS flow_context TEXT NOT NULL DEFAULT 'inventory_event';

-- 2. `category` is only meaningful for the inventory-event vocabulary; the other
--    vocabularies carry NULL. Relax NOT NULL and allow NULL in the CHECK so the
--    ledger semantics stay intact for inventory rows but substitution/etc. rows
--    don't have to invent a fake category.
ALTER TABLE reason_codes ALTER COLUMN category DROP NOT NULL;

ALTER TABLE reason_codes DROP CONSTRAINT IF EXISTS reason_codes_category_chk;
ALTER TABLE reason_codes
  ADD CONSTRAINT reason_codes_category_chk
  CHECK (
    category IS NULL
    OR category IN ('shrinkage','adjustment','sale','return','movement','initial','warranty_denial')
  );

-- 3. Constrain the discriminator to the known vocabularies (extend here as new
--    Class-D vocabularies migrate — D2 adds short_pick / receiving_exception).
ALTER TABLE reason_codes DROP CONSTRAINT IF EXISTS reason_codes_flow_context_chk;
ALTER TABLE reason_codes
  ADD CONSTRAINT reason_codes_flow_context_chk
  CHECK (flow_context IN (
    'inventory_event','substitution','short_pick','receiving_exception','repair_failure','verdict_detail','warranty_denial'
  ));

-- 4. Keep warranty-denial rows in their own vocabulary rather than the
--    'inventory_event' default they'd otherwise inherit.
UPDATE reason_codes SET flow_context = 'warranty_denial' WHERE category = 'warranty_denial';

-- 5. Resolver hot path: getActiveReasonCodes(orgId, { flowContext }).
CREATE INDEX IF NOT EXISTS idx_reason_codes_flow_context
  ON reason_codes(organization_id, flow_context, sort_order)
  WHERE is_active = true;

-- 6. Seed the BUILT-IN substitution vocabulary for every EXISTING org — D1's
--    first descriptive vocabulary to move off a hardcoded TS array. Mirrors the
--    codes/labels in src/lib/fulfillment/substitution-reasons.ts (tone + hint
--    stay code-side as built-in display metadata; the DB owns code + label so a
--    tenant can rename or add). New orgs get the same set via seedOrgCatalog.
--    Idempotent per org via the (organization_id, code) unique key.
INSERT INTO reason_codes (organization_id, code, label, category, direction, flow_context, sort_order)
SELECT o.id, v.code, v.label, NULL, 'either', 'substitution', v.sort_order
FROM organizations o
CROSS JOIN (VALUES
  ('CUSTOMER_REQUEST',  'Customer request',      10),
  ('CONDITION_REGRADE', 'Condition regrade',     20),
  ('DAMAGE_FOUND',      'Damage found',          30),
  ('WRONG_ITEM_LISTED', 'Wrong item listed',     40),
  ('OUT_OF_STOCK',      'Out of stock',          50),
  ('BETTER_AVAILABLE',  'Better unit available', 60),
  ('OTHER',             'Other',                 70)
) AS v(code, label, sort_order)
ON CONFLICT (organization_id, code) DO NOTHING;

COMMIT;
