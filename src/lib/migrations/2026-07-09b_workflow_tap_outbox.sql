-- ============================================================================
-- 2026-07-09b_workflow_tap_outbox.sql
--
-- Intended-tap outbox for the workflow engine (roi-execution/03 #10).
--
-- tapWorkflow (src/lib/workflow/tap.ts) is fire-and-forget by contract: an
-- engine failure never fails a production scan. The cost is that a lost tap
-- (crash between the domain mutation and advance(), transient lock) is
-- invisible. This table records the INTENT of each tap before advance() is
-- attempted (status='PENDING'), flips to 'LANDED' when the engine durably
-- applies it, and is re-driven by /api/cron/workflow/tap-reconcile for rows
-- stuck PENDING (idempotent by design — replaying a tap re-parks the unit).
--
-- Write path is flag-gated (WORKFLOW_TAP_OUTBOX, default OFF) so this
-- migration can land ahead of any traffic. NOT wired into vercel.json —
-- scheduling the reconcile cron is an owner decision.
--
-- Shape follows .claude/rules/polymorphic-tables.md (typed-fact contract):
--   * BIGSERIAL id, tenant-from-birth organization_id (no DEFAULT in DDL —
--     enforce_tenant_isolation() installs the GUC default + FORCE RLS below)
--   * named CHECK on the status discriminator (PENDING/LANDED/FAILED)
--   * org-led indexes
--   * single non-polymorphic parent → real FK ON DELETE CASCADE
--   * modeled in src/lib/drizzle/schema.ts in the same change
--
-- Reversible:
--   DROP TABLE IF EXISTS workflow_tap_outbox;
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS workflow_tap_outbox (
  id               BIGSERIAL PRIMARY KEY,
  organization_id  UUID NOT NULL,                 -- NO default; enforce_tenant_isolation() installs it
  serial_unit_id   BIGINT NOT NULL REFERENCES serial_units(id) ON DELETE CASCADE,
  event_type       TEXT NOT NULL,                 -- WorkflowTapEvent (code-owned vocabulary, deliberately un-CHECKed: node palette grows without schema churn)
  payload          JSONB NOT NULL DEFAULT '{}'::jsonb, -- { input, staffId, source, expectNodeType } — everything needed to re-drive
  status           TEXT NOT NULL DEFAULT 'PENDING',
  attempts         INTEGER NOT NULL DEFAULT 0,    -- bumped by each reconciler claim
  last_error       TEXT,                          -- reason for a FAILED flip (noop:<reason> / error:<msg> / max_attempts)
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE workflow_tap_outbox ADD CONSTRAINT workflow_tap_outbox_status_chk
    CHECK (status IN ('PENDING','LANDED','FAILED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON TABLE workflow_tap_outbox IS
  'Intended workflow taps: PENDING before advance(), LANDED on durable outcome, FAILED on permanent non-apply. Re-driven by /api/cron/workflow/tap-reconcile.';

COMMENT ON COLUMN workflow_tap_outbox.payload IS
  'Re-drive payload: { input, staffId, source, expectNodeType } as passed to tapWorkflow.';

-- Org-led lookup (per-unit history / triage).
CREATE INDEX IF NOT EXISTS idx_workflow_tap_outbox_org_unit
  ON workflow_tap_outbox (organization_id, serial_unit_id, created_at);

-- Reconciler claim scan: PENDING rows oldest-first. Partial + cross-org by
-- design — the reconcile cron is session-less and runs on the owner
-- connection (same pattern as entity_search_outbox drains).
CREATE INDEX IF NOT EXISTS idx_workflow_tap_outbox_pending
  ON workflow_tap_outbox (created_at)
  WHERE status = 'PENDING';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'enforce_tenant_isolation') THEN
    PERFORM enforce_tenant_isolation('workflow_tap_outbox');
  ELSE
    RAISE NOTICE 'enforce_tenant_isolation absent — workflow_tap_outbox left without FORCE RLS';
  END IF;
END $$;

COMMIT;
