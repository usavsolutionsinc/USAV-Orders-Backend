-- ============================================================================
-- 2026-06-28b: seed the descriptive Class-D vocabularies (short_pick + repair_failure)
-- ============================================================================
-- D1 continued (docs/operations-studio/HARDCODED-STATUS-ENGINE-MIGRATION-PLAN.md
-- §3.D / D1): move the short-pick (ShortPickSheet) and repair-failure
-- (ReasonSelector) built-in arrays off hardcoded component literals into
-- reason_codes rows, per existing org. Both are DESCRIPTIVE — nothing in code
-- branches on the value — so this is a pure additive seed. `category` is NULL
-- (the inventory ledger axis doesn't apply). flow_context values are already
-- allowed by reason_codes_flow_context_chk (added 2026-06-28). Idempotent per org.
-- ============================================================================

BEGIN;

-- Short-pick reasons (mirrors src/lib/picking/short-pick-reasons.ts).
INSERT INTO reason_codes (organization_id, code, label, category, direction, flow_context, sort_order)
SELECT o.id, v.code, v.label, NULL, 'either', 'short_pick', v.sort_order
FROM organizations o
CROSS JOIN (VALUES
  ('NOT_FOUND_IN_BIN',   'Not in bin',          10),
  ('DAMAGED',            'Damaged',             20),
  ('WRONG_CONDITION',    'Wrong condition',     30),
  ('MISLABELED',         'Mislabeled',          40),
  ('INSUFFICIENT_STOCK', 'Insufficient stock',  50),
  ('OTHER',              'Other',               60)
) AS v(code, label, sort_order)
ON CONFLICT (organization_id, code) DO NOTHING;

-- Repair-failure reasons (mirrors src/lib/repair/repair-failure-reasons.ts).
INSERT INTO reason_codes (organization_id, code, label, category, direction, flow_context, sort_order)
SELECT o.id, v.code, v.label, NULL, 'either', 'repair_failure', v.sort_order
FROM organizations o
CROSS JOIN (VALUES
  ('PLEASE_WAIT',  'Please wait',  10),
  ('SKIP',         'Skip',         20),
  ('NO_SOUND',     'No sound',     30),
  ('SPEAKER_BUZZ', 'Speaker Buzz', 40),
  ('CD_ISSUES',    'CD Issues',    50),
  ('LCD_ISSUES',   'LCD Issues',   60)
) AS v(code, label, sort_order)
ON CONFLICT (organization_id, code) DO NOTHING;

COMMIT;
