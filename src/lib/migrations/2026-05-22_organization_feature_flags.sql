-- ============================================================================
-- 2026-05-22_organization_feature_flags.sql
--
-- Per-tenant feature flags. Replaces the env-var-only flag mechanism in
-- src/lib/feature-flags.ts. Env vars stay as the system-wide default; a row
-- in this table overrides for a specific org.
--
-- Schema is deliberately narrow: one row per (org, flag, value). No history,
-- no rollout-percentage column yet — keep it simple, add when needed.
-- ============================================================================

CREATE TABLE IF NOT EXISTS organization_feature_flags (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  flag            text NOT NULL,
  enabled         boolean NOT NULL,
  -- Optional jsonb config payload — e.g. {"percentage": 25}. NULL for the
  -- common "just a boolean" case.
  config          jsonb,
  updated_by      integer REFERENCES staff(id) ON DELETE SET NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, flag)
);

CREATE INDEX IF NOT EXISTS idx_org_feature_flags_flag
  ON organization_feature_flags (flag);
