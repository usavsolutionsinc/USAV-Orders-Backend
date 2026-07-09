-- ============================================================================
-- 2026-07-03n: insight_links — seeded + (later) anonymized benchmarks
-- (Phase 0 of docs/todo/universal-feed-polymorphic-plan.md §2.5)
-- ============================================================================
-- Lean benchmark/comparison rows the AI and /operations read for "you vs
-- typical": Phase 1 hand-authors seeded rows for the used-electronics-reseller
-- vertical (test-fail %, return %, receive→list days); anonymized cross-org
-- aggregates come later (multi-tenant), source='anonymized_agg'.
--
-- ── DELIBERATE TENANCY EXCEPTION (read before copying this shape) ────────────
-- organization_id is NULLABLE: NULL = a global/seeded benchmark row readable
-- by EVERY org. That makes the canonical enforce_tenant_isolation() helper
-- WRONG for this table on all three counts:
--   • its loud-fail DEFAULT would break intentional NULL-org seed inserts,
--   • its tenant_isolation policy (org = GUC) hides NULL rows from everyone,
--   • NOT NULL is part of its contract.
-- So RLS is HAND-WRITTEN here instead, with the same FORCE posture:
--   READ  — a tenant sees global rows (organization_id IS NULL) plus its own;
--   WRITE — a tenant (GUC path) may only write rows stamped with its own org.
--   Seeded/global rows are written by trusted server code on the OWNER pool
--   (neondb_owner has BYPASSRLS), never via the tenant pool — the WITH CHECK
--   below structurally blocks tenant-path writes of global rows. A GUC
--   DEFAULT (no NOT NULL) auto-stamps org on GUC-wrapped writes that omit the
--   column, so only the no-GUC owner-pool path can mint NULL-org rows.
-- The hermes_agent read bypass is mirrored from enforce_tenant_isolation().
-- tenancy:coverage will show this table outside the standard cohort — that is
-- expected; this header is the documentation of why.
--
-- Contract notes: no (entity_type, entity_id) pair — subject_ref is a TEXT
-- registry ref ('node_type:test'/'signal_kind:return_reason'/...), so the
-- parent-delete trigger family does not apply. linkage_type/subject_kind are
-- registry-validated (src/lib/surfaces/registry.ts); source is a small stable
-- set → named CHECK.
--
-- Idempotent seeding: the two partial unique indexes below give seeds a
-- conflict target (global rows: (linkage_type, subject_kind, subject_ref);
-- org rows: org-led). Seed rows always set subject_ref — NULL subject_ref
-- rows fall outside the uniqueness net by design.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS insight_links;
--
-- VERIFY (after apply):
--   \d insight_links  -- FORCE RLS + insight_links_tenant_read/write policies
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS insight_links (
  id              BIGSERIAL PRIMARY KEY,
  organization_id UUID,                      -- NULL = global/seeded benchmark row (see header)
  linkage_type    TEXT NOT NULL,             -- registry-validated ('industry_benchmark','power_user_comparison','suggestion_seed')
  subject_kind    TEXT NOT NULL,             -- registry-validated ('node_type','feed_key','signal_kind')
  subject_ref     TEXT,
  metrics         JSONB,
  source          TEXT NOT NULL,             -- named CHECK below
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE insight_links ADD CONSTRAINT insight_links_source_chk
    CHECK (source IN ('seeded','anonymized_agg'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Auto-stamp org when a GUC-wrapped tenant path forgets the column; with no
-- GUC set (owner-pool seed path) this evaluates to NULL, preserving deliberate
-- global rows. Closes the fail-open case where a tenant-intended write lands
-- as a NULL-org row visible to every org.
ALTER TABLE insight_links ALTER COLUMN organization_id
  SET DEFAULT NULLIF(current_setting('app.current_org', true), '')::uuid;

-- Idempotent-seed conflict targets (NULLs are distinct in a plain unique, so
-- global rows need their own partial index).
CREATE UNIQUE INDEX IF NOT EXISTS ux_insight_links_global_subject
  ON insight_links (linkage_type, subject_kind, subject_ref)
  WHERE organization_id IS NULL AND subject_ref IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_insight_links_org_subject
  ON insight_links (organization_id, linkage_type, subject_kind, subject_ref)
  WHERE organization_id IS NOT NULL AND subject_ref IS NOT NULL;

-- Read path: "benchmarks for this subject" (get_benchmarks tool).
CREATE INDEX IF NOT EXISTS idx_insight_links_subject
  ON insight_links (subject_kind, subject_ref, linkage_type);

COMMENT ON TABLE insight_links IS
  'Seeded + anonymized benchmark/comparison rows (plan: universal-feed-polymorphic-plan.md §2.5). organization_id NULL = global seeded row readable by all orgs — deliberate tenancy exception with hand-written RLS (see migration 2026-07-03n header). linkage_type/subject_kind validated by src/lib/surfaces/registry.ts.';

-- ── Hand-written RLS (FORCE posture, custom NULL-aware policies) ─────────────
ALTER TABLE insight_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE insight_links FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS insight_links_tenant_read ON insight_links;
CREATE POLICY insight_links_tenant_read ON insight_links
  FOR SELECT
  USING (
    organization_id IS NULL
    OR organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid
  );

DROP POLICY IF EXISTS insight_links_tenant_write ON insight_links;
CREATE POLICY insight_links_tenant_write ON insight_links
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- Mirror enforce_tenant_isolation()'s hermes_agent read-everything bypass.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hermes_agent') THEN
    DROP POLICY IF EXISTS hermes_agent_read ON insight_links;
    CREATE POLICY hermes_agent_read ON insight_links FOR SELECT TO hermes_agent USING (true);
  END IF;
END $$;

COMMIT;
