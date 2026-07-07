-- ============================================================================
-- 2026-07-06: ops_events — entity_type CHECK + workflow_node_id (where-in-flow)
-- ============================================================================
-- Executes Phases 0–1 of docs/todo/ops-events-station-workflow-unification-plan.md.
-- Two additive, backfill-free changes to the long-term event spine (ops_events,
-- born 2026-06-30). No data migration: both are new constraints/columns and
-- existing rows are valid as-is (they already only carry enumerated entity_type
-- values — Phase 0 audit below — and get workflow_node_id = NULL).
--
-- ── 1. entity_type CHECK (closes the table's own contract gap) ───────────────
--   ops_events shipped with entity_type as free TEXT ("validated app-side", but
--   nothing enforced it) — a gap against .claude/rules/polymorphic-tables.md
--   point 1. This adds the named CHECK.
--
--   Phase 0 audit — the value list is the UNION of the only two write paths
--   that exist today (grep-verified: the only `INSERT INTO ops_events` sites):
--     • recordOpsEvent (src/lib/ops-events.ts) — OpsEntityType union:
--         receiving | receiving_line | serial_unit | shipment | other
--     • recordEntitySignal (src/lib/surfaces/record-entity-signal.ts) — emits
--       SURFACE_ENTITY_TYPES[*].opsEventEntityType (src/lib/surfaces/registry.ts):
--         receiving | receiving_line | serial_unit | order | fba_shipment |
--         repair | warranty_claim
--   The union (9 values) is the exported SoT `OPS_EVENT_ENTITY_TYPES` in
--   src/lib/ops-events.ts; src/lib/ops-events.test.ts pins THIS CHECK list
--   byte-for-byte against that array AND asserts every registry
--   opsEventEntityType is covered, so code and DDL can never drift silently
--   (same drift-guard idea as surfaces/registry.test.ts). Adding a value =
--   extend OPS_EVENT_ENTITY_TYPES + this CHECK (new migration) together.
--
-- ── 2. workflow_node_id — the tenant-customizable "where" axis ───────────────
--   The plan's whole point: name WHERE in a tenant's own Studio flow an event
--   happened, using the runtime-created, per-org, zero-deploy workflow_nodes.id
--   space (not a hardcoded station vocabulary).
--
--   DELIBERATE DEVIATION from the plan's §3.3 DDL sketch, which wrote
--   `TEXT REFERENCES workflow_nodes(id) ON DELETE SET NULL`. That is WRONG for
--   this schema and would introduce a real bug — the plan (2026-07-01) predates
--   the entity_signals decision (2026-07-03l) that established the opposite,
--   correct convention for exactly this column semantics:
--     • Studio graph saves REPLACE workflow_nodes rows WHOLESALE — every save is
--       `DELETE FROM workflow_nodes WHERE workflow_definition_id = $1` then
--       re-INSERT all nodes (src/app/api/studio/definitions/[id]/graph/route.ts,
--       src/lib/workflow/draft-graph-writes.ts). A real FK with ON DELETE SET
--       NULL would therefore null out this annotation on EVERY ordinary edit —
--       destroying the "where in the flow" history this column exists to keep —
--       and a draft-only / not-yet-persisted node id would fail the INSERT
--       outright.
--     • No table in this schema takes a real FK to workflow_nodes(id). The
--       established pattern for "a node id annotation" is FK-FREE TEXT:
--       entity_signals.node_id (2026-07-03l: "no FK by design — node ids
--       re-minted per draft, graph saves replace workflow_nodes rows wholesale")
--       and station_definitions.workflow_node_id (2026-06-11, soft-linked TEXT).
--   So this column is plain TEXT, FK-free. Nullable: most events (system events,
--   receiving scans before any Studio graph exists for the org) have no node.
--   Partial index — zero cost/size for the (currently 100% of) writes that omit
--   it.
-- ============================================================================

BEGIN;

-- 1. entity_type CHECK. Single-line value list intentionally (mirrors the
--    entity_signals_entity_type_chk format that ops-events.test.ts /
--    surfaces/registry.test.ts parse).
DO $$ BEGIN
  ALTER TABLE ops_events ADD CONSTRAINT ops_events_entity_type_chk
    CHECK (entity_type IN ('receiving','receiving_line','serial_unit','shipment','order','fba_shipment','repair','warranty_claim','other'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. workflow_node_id — FK-FREE TEXT (see header). "Where in the tenant's flow".
ALTER TABLE ops_events
  ADD COLUMN IF NOT EXISTS workflow_node_id TEXT;

COMMENT ON COLUMN ops_events.workflow_node_id IS
  'Soft (FK-free) reference to workflow_nodes.id — WHERE in the tenant''s own Studio flow this event happened. FK-free by design: workflow_nodes rows are replaced wholesale on every graph save, so a real FK would null this on ordinary edits (see 2026-07-03l entity_signals.node_id, station_definitions.workflow_node_id). Nullable — most events have no node.';

-- Partial index: node-scoped, time-ordered event reads ("activity at this node,
-- newest first"). WHERE workflow_node_id IS NOT NULL keeps it out of the hot
-- node-less write path entirely.
CREATE INDEX IF NOT EXISTS idx_ops_events_org_node_time
  ON ops_events (organization_id, workflow_node_id, occurred_at DESC)
  WHERE workflow_node_id IS NOT NULL;

COMMIT;
