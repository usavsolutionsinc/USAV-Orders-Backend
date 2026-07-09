-- ============================================================================
-- 2026-06-28d: reason_codes → tenant-customizable lifecycle LABELS (Phase 2)
-- ============================================================================
-- The label layer (src/lib/labels) makes a stable lifecycle `code`
-- (PENDING / TESTED / IN_CUSTODY / …) render through a tenant-overridable
-- label. Per docs/operations-studio/HARDCODED-STATUS-ENGINE-MIGRATION-PLAN.md
-- this REUSES the reason_codes multi-vocabulary store (it already owns
-- per-org code+label, flow_context discriminator, natural key
-- (organization_id, flow_context, code), RLS) rather than a new table.
--
-- This migration adds the two presentation columns reason_codes lacked (`tone`,
-- `icon`) and registers two new label vocabularies on the flow_context CHECK.
-- It SEEDS NOTHING: the code registry (src/lib/labels/registry.ts LABEL_DEFAULTS)
-- is the system default; a row here exists only when a tenant OVERRIDES a label.
--
-- Strictly additive + idempotent. Existing reason_codes rows + every current
-- query are byte-for-byte unchanged (new columns are nullable, no backfill).
-- ============================================================================

BEGIN;

-- 1. Presentation columns. NULL = "use the code-side default" (the resolver's
--    org layer only overrides a field when the row supplies a non-null value).
ALTER TABLE reason_codes ADD COLUMN IF NOT EXISTS tone TEXT;
ALTER TABLE reason_codes ADD COLUMN IF NOT EXISTS icon TEXT;

-- 2. Register the lifecycle-label vocabularies on the discriminator CHECK.
--    flow_context for a label = 'lifecycle_' + LabelKind (see
--    src/lib/labels/load.ts `labelKindToFlowContext`). Extend this list as new
--    LabelKinds gain tenant-overridable labels.
ALTER TABLE reason_codes DROP CONSTRAINT IF EXISTS reason_codes_flow_context_chk;
ALTER TABLE reason_codes
  ADD CONSTRAINT reason_codes_flow_context_chk
  CHECK (flow_context IN (
    'inventory_event','inventory_adjust','substitution','short_pick','receiving_exception','repair_failure','verdict_detail','warranty_denial',
    'lifecycle_unshipped','lifecycle_outbound'
  ));

COMMIT;
