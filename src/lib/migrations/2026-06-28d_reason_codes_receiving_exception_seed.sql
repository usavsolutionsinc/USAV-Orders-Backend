-- ============================================================================
-- 2026-06-28d: seed the receiving-exception vocabulary (visibility for a
-- BEHAVIOR-BEARING system vocab)
-- ============================================================================
-- RECEIVING_EXCEPTION_CODES (src/lib/receiving/exception-codes.ts) is
-- behavior-bearing: lookup-po decides CARRIER_MISMATCH vs NO_PO, and downstream
-- delivery-state filters branch on CARRIER_MISMATCH. So the CODES stay a SYSTEM
-- vocabulary owned by that registry (the engine's branch SoT) — we do NOT free
-- them. We seed them into reason_codes (flow_context='receiving_exception') so a
-- tenant can SEE + relabel them in the Admin reason-codes manager. Labels mirror
-- RECEIVING_EXCEPTION_META. Idempotent per org (composite key).
-- ============================================================================

BEGIN;

INSERT INTO reason_codes (organization_id, code, label, category, direction, flow_context, sort_order)
SELECT o.id, v.code, v.label, NULL, 'either', 'receiving_exception', v.sort_order
FROM organizations o CROSS JOIN (VALUES
  ('NO_PO',           'No PO',       10),
  ('CARRIER_MISMATCH','Carrier?',    20),
  ('SHORT',           'Short',       30),
  ('OVER',            'Over',        40),
  ('DAMAGED',         'Damaged',     50),
  ('WRONG_ITEM',      'Wrong item',  60)
) AS v(code, label, sort_order)
ON CONFLICT (organization_id, flow_context, code) DO NOTHING;

COMMIT;
