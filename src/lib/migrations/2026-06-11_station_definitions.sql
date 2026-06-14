-- ============================================================================
-- 2026-06-11: station_definitions (Operations Studio layer 2 — station builder)
-- ============================================================================
-- One row per (page, mode) station composition, e.g. ('receiving','incoming').
-- `config` holds the ordered slots → block instances → source/action bindings
-- (docs/operations-studio/station-builder-ui-plan.md §2.4). Blocks, data
-- sources and actions are CODE (src/lib/stations registries); this table is
-- the DATA — graphs/configs are versioned rows published without deploys.
--
-- Versioning + is_active publish semantics copy workflow_definitions exactly:
-- only one row per (org, page_key, mode_key) is active at a time; publishing a
-- new version flips the flag in one transaction.
--
-- organization_id mirrors the orgIdCol() helper in schema.ts: it defaults from
-- the app.current_org session GUC so tenant-scoped writes populate it
-- automatically (RLS hook, not yet enforced).
--
-- Readers/writers: /api/stations (+ /api/stations/publish), renderer in
-- src/components/stations/*.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS station_definitions (
  id               SERIAL PRIMARY KEY,
  organization_id  UUID NOT NULL
                     DEFAULT NULLIF(current_setting('app.current_org', true), '')::uuid,
  page_key         TEXT NOT NULL,
  mode_key         TEXT NOT NULL,
  label            TEXT NOT NULL,
  workflow_node_id TEXT,
  config           JSONB NOT NULL DEFAULT '{}'::jsonb,
  version          INTEGER NOT NULL DEFAULT 1,
  is_active        BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by       INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_station_definitions_organization_id
  ON station_definitions (organization_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_station_definitions_org_page_mode_version
  ON station_definitions (organization_id, page_key, mode_key, version);

COMMIT;
