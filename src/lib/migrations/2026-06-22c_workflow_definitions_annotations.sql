-- ============================================================================
-- 2026-06-22: workflow_definitions.annotations — canvas sticky-note layer (Studio ST6 / Phase E3)
-- ============================================================================
-- Adds a per-definition JSONB column holding the Operations Studio canvas's
-- sticky-note ANNOTATIONS — free-text decorations the builder drops on the
-- React Flow surface (e.g. "double-check torque before listing").
--
--   annotations :: jsonb  — an array of { id, text, x, y, color? }:
--     id     TEXT    client-minted (a-#### / uuid)
--     text   TEXT    the note body (length-bounded by the Zod schema, not here)
--     x, y   NUMBER  React Flow canvas coordinates (same space as workflow_nodes)
--     color? TEXT    optional sticky tone key (amber default)
--
-- Annotations are CANVAS DECORATIONS, not engine nodes: they never register a
-- node type, never get output ports, are not lintable by diagnostics, and never
-- participate in routing/simulate. They simply ride WITH the definition row —
-- copied on draft-fork, replaced on draft graph-save, and published atomically
-- with the version (it's the same row, so there is no separate publish step).
--
-- SAFETY / GATING
--   • Additive + idempotent: ADD COLUMN IF NOT EXISTS with a NOT NULL DEFAULT of
--     '[]'::jsonb, so every existing definition backfills to an empty array and
--     no writer needs to change to keep working.
--   • No new tenant surface: workflow_definitions already carries organization_id
--     + (RLS hook). This column inherits that scope — it is not separately keyed
--     or indexed (it's never a query predicate; it's loaded with the row).
--
-- ROLLBACK
--   ALTER TABLE workflow_definitions DROP COLUMN IF EXISTS annotations;
--   (Pure column drop — no data migration, no constraint to relax.)
--
-- VERIFY
--   \d workflow_definitions   → annotations | jsonb | not null | default '[]'::jsonb
-- ============================================================================

ALTER TABLE workflow_definitions
  ADD COLUMN IF NOT EXISTS annotations JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN workflow_definitions.annotations IS
  'Operations Studio canvas sticky-note decorations: array of { id, text, x, y, color? }. Pure canvas layer — not engine nodes (no routing/ports/diagnostics). Rides with the definition row (copied on draft-fork, published atomically).';
