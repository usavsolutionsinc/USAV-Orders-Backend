-- ============================================================================
-- 2026-06-03: Workflow graph layer (node-based "Operations" engine)
-- ============================================================================
-- Adds the GRAPH-DEFINITION tables for the visual, node-based operations
-- builder (see docs/NODE_WORKFLOW_ARCHITECTURE.md and
-- docs/NODE_WORKFLOW_IMPLEMENTATION_PLAN.md). These tables describe which node
-- connects to which (with conditional routing) and hold a pointer into the
-- EXISTING item state machine — they add no behavior on their own.
--
-- Single source of truth is unchanged: the canonical per-unit state still lives
-- on serial_units.current_status + station_activity_logs. item_workflow_state
-- only records WHERE a unit currently sits in its active workflow; it never
-- duplicates the unit's serial/SKU/condition (every reader JOINs serial_units).
--
-- Tables:
--   workflow_definitions  — one named, versioned graph per org
--   workflow_nodes        — canvas nodes (type = engine registry key)
--   workflow_edges        — port-to-node connections (drives conditional routing)
--   item_workflow_state   — a serial unit's current position (one active/unit)
--   workflow_runs         — append-only node-execution log (observability)
--
-- organization_id mirrors the orgIdCol() helper in schema.ts: it defaults from
-- the app.current_org session GUC so tenant-scoped writes populate it
-- automatically (RLS hook, not yet enforced).
--
-- Engine / writers: src/lib/workflow/* (added in Phase B+).
-- ============================================================================

BEGIN;

-- ─── workflow_definitions ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workflow_definitions (
  id              SERIAL PRIMARY KEY,
  organization_id UUID NOT NULL
                    DEFAULT NULLIF(current_setting('app.current_org', true), '')::uuid,
  name            TEXT NOT NULL,
  version         INTEGER NOT NULL DEFAULT 1,
  is_active       BOOLEAN NOT NULL DEFAULT FALSE,
  created_by      INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE workflow_definitions IS
  'One named, versioned operations graph per org. Publishing a new version flips is_active; in-flight items finish on their old version.';

CREATE INDEX IF NOT EXISTS idx_workflow_definitions_organization_id
  ON workflow_definitions (organization_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_workflow_definitions_org_name_version
  ON workflow_definitions (organization_id, name, version);

-- ─── workflow_nodes ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workflow_nodes (
  id                     TEXT PRIMARY KEY,  -- client-generated canvas uuid
  workflow_definition_id INTEGER NOT NULL
                           REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  type                   TEXT NOT NULL,     -- engine registry key (e.g. 'inspection')
  position_x             NUMERIC NOT NULL,  -- React Flow coordinates
  position_y             NUMERIC NOT NULL,
  config                 JSONB NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE workflow_nodes IS
  'Canvas nodes for a workflow_definition. type maps to the engine node registry; config is the per-node form state; position_x/y are React Flow coordinates.';

CREATE INDEX IF NOT EXISTS idx_workflow_nodes_definition_id
  ON workflow_nodes (workflow_definition_id);

-- ─── workflow_edges ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workflow_edges (
  id                     TEXT PRIMARY KEY,
  workflow_definition_id INTEGER NOT NULL
                           REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  source_node            TEXT NOT NULL,
  source_port            TEXT NOT NULL,     -- named output port → conditional routing
  target_node            TEXT NOT NULL
);

COMMENT ON TABLE workflow_edges IS
  'Connections from a node output port to another node. (source_node, source_port) is the routing key: e.g. an inspection node''s ''fail'' port edge points at the repair node.';

CREATE INDEX IF NOT EXISTS idx_workflow_edges_definition_id
  ON workflow_edges (workflow_definition_id);

CREATE INDEX IF NOT EXISTS idx_workflow_edges_source
  ON workflow_edges (workflow_definition_id, source_node, source_port);

-- ─── item_workflow_state ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS item_workflow_state (
  id                     SERIAL PRIMARY KEY,
  organization_id        UUID NOT NULL
                           DEFAULT NULLIF(current_setting('app.current_org', true), '')::uuid,
  serial_unit_id         INTEGER NOT NULL
                           REFERENCES serial_units(id) ON DELETE CASCADE,
  workflow_definition_id INTEGER NOT NULL
                           REFERENCES workflow_definitions(id),
  current_node_id        TEXT NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'active',  -- active | blocked | done | error
  context                JSONB NOT NULL DEFAULT '{}'::jsonb,
  entered_node_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE item_workflow_state IS
  'Where a serial unit currently sits in its active workflow. References serial_units by id only (serial/SKU/condition are JOINed, never copied). One active row per unit (ux_item_workflow_state_unit). context accumulates upstream node outputs.';

-- One active workflow position per unit. (Re-enrolling a unit replaces the row.)
CREATE UNIQUE INDEX IF NOT EXISTS ux_item_workflow_state_unit
  ON item_workflow_state (serial_unit_id);

CREATE INDEX IF NOT EXISTS idx_item_workflow_state_organization_id
  ON item_workflow_state (organization_id);

-- ─── workflow_runs ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workflow_runs (
  id                     SERIAL PRIMARY KEY,
  organization_id        UUID NOT NULL
                           DEFAULT NULLIF(current_setting('app.current_org', true), '')::uuid,
  serial_unit_id         INTEGER NOT NULL,
  workflow_definition_id INTEGER,
  node_type              TEXT NOT NULL,
  output                 TEXT,
  duration_ms            INTEGER,
  error                  TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE workflow_runs IS
  'Append-only log of every node execution (time-in-node, output port, errors) for throughput/bottleneck analytics. Mirrors the pipeline_cycles observability pattern.';

CREATE INDEX IF NOT EXISTS idx_workflow_runs_serial_unit_id
  ON workflow_runs (serial_unit_id);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_org_created
  ON workflow_runs (organization_id, created_at DESC);

COMMIT;
