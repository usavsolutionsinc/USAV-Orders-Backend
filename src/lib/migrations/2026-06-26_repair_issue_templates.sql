-- ============================================================================
-- 2026-06-26_repair_issue_templates.sql
--
-- Creates repair_issue_templates (missing from this DB — baseline section was
-- never applied) and seeds the six global intake reasons.
--
-- Tenant-scoped from birth: organization_id NOT NULL. Writers in
-- src/lib/neon/repair-issue-queries.ts stamp org via tenantQuery.
--
-- ROLLBACK: SELECT relax_tenant_isolation('repair_issue_templates');
--           DROP TABLE IF EXISTS repair_issue_templates;
-- ============================================================================

CREATE TABLE IF NOT EXISTS repair_issue_templates (
  id              SERIAL PRIMARY KEY,
  favorite_sku_id INTEGER REFERENCES favorite_skus(id) ON DELETE CASCADE,
  label           TEXT NOT NULL,
  category        TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  organization_id UUID NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_repair_issue_templates_favorite
  ON repair_issue_templates (favorite_sku_id, active, sort_order);

CREATE INDEX IF NOT EXISTS idx_repair_issue_templates_org_favorite
  ON repair_issue_templates (organization_id, favorite_sku_id, active, sort_order);

-- Seed global issue labels for USAV org (idempotent).
INSERT INTO repair_issue_templates (organization_id, favorite_sku_id, label, sort_order)
SELECT '00000000-0000-0000-0000-000000000001'::uuid, NULL, v.label, v.sort_order
FROM (VALUES
  ('Please wait', 10),
  ('Skip',        20),
  ('No sound',    30),
  ('Speaker Buzz', 40),
  ('CD Issues',   50),
  ('LCD Issues',  60)
) AS v(label, sort_order)
WHERE NOT EXISTS (
  SELECT 1
    FROM repair_issue_templates t
   WHERE t.organization_id = '00000000-0000-0000-0000-000000000001'::uuid
     AND t.favorite_sku_id IS NULL
     AND t.label = v.label
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'enforce_tenant_isolation') THEN
    PERFORM enforce_tenant_isolation('repair_issue_templates');
  ELSE
    RAISE NOTICE 'enforce_tenant_isolation absent — repair_issue_templates left without FORCE RLS';
  END IF;
END $$;
