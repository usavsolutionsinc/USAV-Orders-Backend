-- ============================================================================
-- 2026-06-28c: reason_codes natural key → (organization_id, flow_context, code)
-- ============================================================================
-- Now that reason_codes is a MULTI-VOCABULARY store (2026-06-28 flow_context),
-- the per-org-global `(organization_id, code)` unique is too strict: the same
-- code legitimately means different things in different vocabularies —
-- 'DAMAGED' is both an inventory reason AND a short-pick reason; 'OTHER' is both
-- a substitution AND a short-pick reason. The natural key is
-- (organization_id, flow_context, code). Codes stay unique WITHIN a vocabulary,
-- so the POST /api/reason-codes 409-on-23505 path still fires for a real dup.
-- Then re-seed the descriptive vocabularies to fill the rows the old global
-- unique silently skipped. Idempotent.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'reason_codes'::regclass AND conname = 'reason_codes_org_code_key'
  ) THEN
    ALTER TABLE reason_codes DROP CONSTRAINT reason_codes_org_code_key;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'reason_codes'::regclass AND conname = 'reason_codes_org_flow_code_key'
  ) THEN
    ALTER TABLE reason_codes
      ADD CONSTRAINT reason_codes_org_flow_code_key UNIQUE (organization_id, flow_context, code);
  END IF;
END $$;

-- Re-seed (fills rows skipped by the old global (org,code) collisions).
INSERT INTO reason_codes (organization_id, code, label, category, direction, flow_context, sort_order)
SELECT o.id, v.code, v.label, NULL, 'either', 'substitution', v.sort_order
FROM organizations o CROSS JOIN (VALUES
  ('CUSTOMER_REQUEST','Customer request',10),('CONDITION_REGRADE','Condition regrade',20),
  ('DAMAGE_FOUND','Damage found',30),('WRONG_ITEM_LISTED','Wrong item listed',40),
  ('OUT_OF_STOCK','Out of stock',50),('BETTER_AVAILABLE','Better unit available',60),('OTHER','Other',70)
) AS v(code,label,sort_order)
ON CONFLICT (organization_id, flow_context, code) DO NOTHING;

INSERT INTO reason_codes (organization_id, code, label, category, direction, flow_context, sort_order)
SELECT o.id, v.code, v.label, NULL, 'either', 'short_pick', v.sort_order
FROM organizations o CROSS JOIN (VALUES
  ('NOT_FOUND_IN_BIN','Not in bin',10),('DAMAGED','Damaged',20),('WRONG_CONDITION','Wrong condition',30),
  ('MISLABELED','Mislabeled',40),('INSUFFICIENT_STOCK','Insufficient stock',50),('OTHER','Other',60)
) AS v(code,label,sort_order)
ON CONFLICT (organization_id, flow_context, code) DO NOTHING;

INSERT INTO reason_codes (organization_id, code, label, category, direction, flow_context, sort_order)
SELECT o.id, v.code, v.label, NULL, 'either', 'repair_failure', v.sort_order
FROM organizations o CROSS JOIN (VALUES
  ('PLEASE_WAIT','Please wait',10),('SKIP','Skip',20),('NO_SOUND','No sound',30),
  ('SPEAKER_BUZZ','Speaker Buzz',40),('CD_ISSUES','CD Issues',50),('LCD_ISSUES','LCD Issues',60)
) AS v(code,label,sort_order)
ON CONFLICT (organization_id, flow_context, code) DO NOTHING;

COMMIT;
