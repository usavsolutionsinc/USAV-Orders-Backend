-- ============================================================================
-- 2026-06-28f: reason_codes.applies_to (D3 — per-node reason palettes)
-- ============================================================================
-- Optional JSONB array of workflow_node ids (or item-type tags) a reason is
-- scoped to. NULL = global (applies to every node). The resolver filters
-- "global OR scoped-to-this-node", so a Studio editor can later narrow a node's
-- reason palette without code changes (the editor UI itself is D4 / follow-up).
-- Additive + idempotent; all existing rows stay global (NULL).
-- ============================================================================

BEGIN;

ALTER TABLE reason_codes ADD COLUMN IF NOT EXISTS applies_to JSONB;
COMMENT ON COLUMN reason_codes.applies_to IS
  'D3: JSONB array of workflow_node ids / item-type tags this reason is scoped to; NULL = applies to all nodes.';

COMMIT;
