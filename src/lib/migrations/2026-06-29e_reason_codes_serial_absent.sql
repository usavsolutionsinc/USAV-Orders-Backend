-- ============================================================================
-- 2026-06-29e: seed the serial-absent waiver vocabulary
-- (flow_context='serial_absent_reason')
-- ============================================================================
-- When a received unit has no serial number, the operator records an explicit,
-- auditable reason instead of a silent blank — NOT_SERIALIZED (cables / parts),
-- UNREADABLE (rubbed off / won't scan), MISSING_LABEL, BULK. The built-in
-- registry SoT is src/lib/receiving/serial-absent-reasons.ts (the picker's
-- bootstrap fallback); these rows make the vocabulary tenant-visible and
-- relabelable. category NULL (not a ledger axis), direction 'either'. Idempotent
-- per org via the composite natural key.
--
-- NOTE on the discriminator CHECK: this migration sorts LAST among the
-- reason_codes CHECK redefinitions, so its value list is the one that sticks. It
-- is therefore the full CURRENT UNION — the eight contexts from 28e PLUS the two
-- lifecycle_* contexts the labels layer (src/lib/labels) reads PLUS the new
-- serial_absent_reason — so nothing in active use is dropped.
-- ============================================================================

BEGIN;

-- Allow the new vocabulary (and re-affirm every in-use context) in the CHECK.
ALTER TABLE reason_codes DROP CONSTRAINT IF EXISTS reason_codes_flow_context_chk;
ALTER TABLE reason_codes ADD CONSTRAINT reason_codes_flow_context_chk
  CHECK (flow_context IN (
    'inventory_event','substitution','short_pick','receiving_exception',
    'repair_failure','verdict_detail','warranty_denial','inventory_adjust',
    'lifecycle_unshipped','lifecycle_outbound',
    'serial_absent_reason'
  ));

INSERT INTO reason_codes (organization_id, code, label, category, direction, flow_context, sort_order)
SELECT o.id, v.code, v.label, NULL, 'either', 'serial_absent_reason', v.sort_order
FROM organizations o CROSS JOIN (VALUES
  ('NOT_SERIALIZED', 'Not serialized', 10),
  ('UNREADABLE',     'Unreadable',     20),
  ('MISSING_LABEL',  'Missing label',  30),
  ('BULK',           'Bulk',           40)
) AS v(code, label, sort_order)
ON CONFLICT (organization_id, flow_context, code) DO NOTHING;

COMMIT;
