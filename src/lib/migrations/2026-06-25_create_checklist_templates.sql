-- Polymorphic checklist templates — one tenant-owned base table for fill-in
-- checklists across scopes. Starts serving the receiving line Checklist tab
-- (scope_type = 'GLOBAL', one org-wide list) and generalizes later to per-
-- category and per-SKU lists (scope_type = 'CATEGORY' / 'SKU', scope_id set).
--
-- Mirrors qc_check_templates' column shape (step_label/type/status + structured
-- value config + failure_mode_id) so per-SKU checklists can be sourced from the
-- same QC display logic. Distinct table (not a refactor of qc_check_templates)
-- so the existing QC surface is untouched.
--
-- Tenant-from-birth: organization_id NOT NULL with the GUC default; routes scope
-- via withTenantTransaction. enforce_tenant_isolation() is applied later (after
-- all readers/writers go through the tenant client), matching the house rollout.

BEGIN;

CREATE TABLE IF NOT EXISTS checklist_templates (
  id               BIGSERIAL PRIMARY KEY,
  organization_id  UUID NOT NULL
                     DEFAULT NULLIF(current_setting('app.current_org', true), '')::uuid,
  -- Polymorphic scope. GLOBAL → one org-wide list (scope_id NULL).
  -- CATEGORY → scope_id is a category key; SKU → scope_id is sku_catalog.id.
  scope_type       TEXT NOT NULL DEFAULT 'GLOBAL',
  scope_id         INTEGER,
  step_label       TEXT NOT NULL,
  step_type        TEXT NOT NULL DEFAULT 'PASS_FAIL',
  status           TEXT NOT NULL DEFAULT 'published',
  -- Structured-value config (parity with qc_check_templates; unused by the
  -- simple GLOBAL list today, present so per-SKU checklists reuse the QC shape).
  value_kind       TEXT,
  value_unit       TEXT,
  value_enum       JSONB,
  pass_min         NUMERIC,
  pass_max         NUMERIC,
  failure_mode_id  INTEGER REFERENCES failure_modes(id) ON DELETE SET NULL,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  ALTER TABLE checklist_templates
    ADD CONSTRAINT checklist_templates_scope_chk
    CHECK (scope_type IN ('GLOBAL', 'CATEGORY', 'SKU'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE checklist_templates
    ADD CONSTRAINT checklist_templates_status_chk
    CHECK (status IN ('draft', 'published'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- GLOBAL rows have no scope_id; CATEGORY/SKU rows must carry one.
DO $$ BEGIN
  ALTER TABLE checklist_templates
    ADD CONSTRAINT checklist_templates_scope_id_chk
    CHECK (
      (scope_type = 'GLOBAL' AND scope_id IS NULL)
      OR (scope_type <> 'GLOBAL' AND scope_id IS NOT NULL)
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The hot path: load a scope's published steps in order, per org.
CREATE INDEX IF NOT EXISTS idx_checklist_templates_lookup
  ON checklist_templates (organization_id, scope_type, scope_id, status, sort_order);

COMMIT;
