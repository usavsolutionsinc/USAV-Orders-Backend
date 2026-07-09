-- ============================================================================
-- 2026-07-03j: feed_memberships — universal rail/feed working set (Phase 0 of
-- docs/todo/universal-feed-polymorphic-plan.md §2.1)
-- ============================================================================
-- The shared/global "active selection" layer for operator rails and AI feed
-- tools: one row = one entity's membership in one feed (feed_key), with
-- denormalized display fields (title/subtitle/tone/occurred_at) for
-- ultra-low-latency sidebars. SoT stays in the domain masters +
-- item_workflow_state + ops_events — memberships are a projection and can be
-- rebuilt (plan §-1 "Locked invariants").
--
-- Contract: .claude/rules/polymorphic-tables.md point-for-point.
--   • entity_type — named CHECK below (7 day-one parents, all confirmed).
--   • feed_key    — second discriminator axis, validated in the app-layer
--     registry (src/lib/surfaces/registry.ts), deliberately NOT a CHECK so
--     tenants/AI can add feeds without a migration (plan §2 "Key properties").
--   • state/tone  — small stable sets → named CHECKs.
--   • workflow_definition_id/node_id — denorm of the Studio linkage (SoT is
--     node_surfaces + item_workflow_state). Real FK SET NULL on the definition;
--     node_id is deliberately FK-free: workflow_nodes ids are re-minted per
--     draft and the graph-save route replaces rows wholesale (DELETE+INSERT),
--     so an FK would sever memberships on every draft save.
--   • Parent-delete integrity: trigger family below (dispatch on TG_ARGV[0]),
--     one trigger per nameable parent — same pattern as
--     2026-07-01j_polymorphic_orphan_delete_triggers.sql.
--
-- Safety gating: brand-new table, zero writers at author time. All Phase 1+
-- writers (syncFeedMembership / applyAgentMutation) stamp organization_id
-- explicitly and run inside withTenantTransaction, so tenant-from-birth
-- (loud-fail GUC default + FORCE RLS via enforce_tenant_isolation) is safe.
--
-- ROLLBACK (order matters — the 7 triggers live ON THE PARENT TABLES, so the
-- function must go first WITH CASCADE or every parent DELETE starts erroring):
--   select relax_tenant_isolation('feed_memberships');
--   DROP FUNCTION IF EXISTS fn_delete_feed_memberships_on_parent_delete() CASCADE;  -- drops the 7 parent triggers
--   DROP TABLE IF EXISTS feed_memberships;
--
-- VERIFY (after apply):
--   npm run tenancy:coverage
--   \d feed_memberships   -- FORCE RLS + tenant_isolation policy present
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS feed_memberships (
  id                     BIGSERIAL PRIMARY KEY,
  organization_id        UUID NOT NULL,              -- no DEFAULT; enforce_tenant_isolation() installs the loud-fail GUC default
  feed_key               TEXT NOT NULL,              -- registry-validated (e.g. 'receiving_triage', 'fba_outbound')
  entity_type            TEXT NOT NULL,              -- named CHECK below
  entity_id              BIGINT NOT NULL,

  -- Studio/graph linkage (denorm for efficiency; SoT is item_workflow_state + node_surfaces)
  workflow_definition_id INTEGER REFERENCES workflow_definitions(id) ON DELETE SET NULL,
  node_id                TEXT,                       -- no FK by design (draft saves replace workflow_nodes rows)

  state                  TEXT NOT NULL DEFAULT 'active',
  priority_tier          SMALLINT,                   -- tier-0 = priority (mirrors receiving.priority_tier convention)
  occurred_at            TIMESTAMPTZ NOT NULL,
  title                  TEXT NOT NULL,
  subtitle               TEXT,
  tone                   TEXT NOT NULL DEFAULT 'default',
  meta                   JSONB,

  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE feed_memberships ADD CONSTRAINT feed_memberships_entity_type_chk
    CHECK (entity_type IN ('RECEIVING','RECEIVING_LINE','SERIAL_UNIT','ORDER','FBA_SHIPMENT','REPAIR','WARRANTY_CLAIM'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE feed_memberships ADD CONSTRAINT feed_memberships_state_chk
    CHECK (state IN ('active','needs_match','done'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Tone vocabulary = the shared TimelineTone registry (src/lib/timeline/types.ts).
DO $$ BEGIN
  ALTER TABLE feed_memberships ADD CONSTRAINT feed_memberships_tone_chk
    CHECK (tone IN ('default','info','success','warning','danger','muted'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- One membership per entity per feed (multi-membership = same entity in
-- DIFFERENT feeds, never duplicated within one feed).
CREATE UNIQUE INDEX IF NOT EXISTS ux_feed_memberships_natural
  ON feed_memberships (organization_id, feed_key, entity_type, entity_id);

-- Hot rail read: "active rows for this feed, newest first".
CREATE INDEX IF NOT EXISTS idx_feed_memberships_org_feed_state_time
  ON feed_memberships (organization_id, feed_key, state, occurred_at DESC, id DESC);

-- Reverse lookup: "which feeds is this entity in" (write-through + AI tools).
CREATE INDEX IF NOT EXISTS idx_feed_memberships_org_entity
  ON feed_memberships (organization_id, entity_type, entity_id);

-- Canvas surface-occupancy lens: memberships grouped by graph node.
CREATE INDEX IF NOT EXISTS idx_feed_memberships_org_node
  ON feed_memberships (organization_id, node_id)
  WHERE node_id IS NOT NULL;

COMMENT ON TABLE feed_memberships IS
  'Universal rail/feed working set (plan: universal-feed-polymorphic-plan.md §2.1). Projection of domain masters — rebuildable; feed_key validated by src/lib/surfaces/registry.ts. Tenant-scoped from birth.';

-- ── Parent-delete integrity: cascade-delete memberships when the parent row
--    dies (dispatch-on-TG_ARGV[0] family, per polymorphic-tables.md #5).
--    All 7 day-one entity_type values have a confirmed parent table:
--    RECEIVING→receiving, RECEIVING_LINE→receiving_lines,
--    SERIAL_UNIT→serial_units, ORDER→orders, FBA_SHIPMENT→fba_shipments,
--    REPAIR→repair_service, WARRANTY_CLAIM→warranty_claims. No skips.
CREATE OR REPLACE FUNCTION fn_delete_feed_memberships_on_parent_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM feed_memberships
  WHERE entity_type = TG_ARGV[0]
    AND entity_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_delete_feed_memberships_on_receiving_delete ON receiving;
CREATE TRIGGER trg_delete_feed_memberships_on_receiving_delete
AFTER DELETE ON receiving
FOR EACH ROW EXECUTE FUNCTION fn_delete_feed_memberships_on_parent_delete('RECEIVING');

DROP TRIGGER IF EXISTS trg_delete_feed_memberships_on_receiving_line_delete ON receiving_lines;
CREATE TRIGGER trg_delete_feed_memberships_on_receiving_line_delete
AFTER DELETE ON receiving_lines
FOR EACH ROW EXECUTE FUNCTION fn_delete_feed_memberships_on_parent_delete('RECEIVING_LINE');

DROP TRIGGER IF EXISTS trg_delete_feed_memberships_on_serial_unit_delete ON serial_units;
CREATE TRIGGER trg_delete_feed_memberships_on_serial_unit_delete
AFTER DELETE ON serial_units
FOR EACH ROW EXECUTE FUNCTION fn_delete_feed_memberships_on_parent_delete('SERIAL_UNIT');

DROP TRIGGER IF EXISTS trg_delete_feed_memberships_on_order_delete ON orders;
CREATE TRIGGER trg_delete_feed_memberships_on_order_delete
AFTER DELETE ON orders
FOR EACH ROW EXECUTE FUNCTION fn_delete_feed_memberships_on_parent_delete('ORDER');

DROP TRIGGER IF EXISTS trg_delete_feed_memberships_on_fba_shipment_delete ON fba_shipments;
CREATE TRIGGER trg_delete_feed_memberships_on_fba_shipment_delete
AFTER DELETE ON fba_shipments
FOR EACH ROW EXECUTE FUNCTION fn_delete_feed_memberships_on_parent_delete('FBA_SHIPMENT');

DROP TRIGGER IF EXISTS trg_delete_feed_memberships_on_repair_service_delete ON repair_service;
CREATE TRIGGER trg_delete_feed_memberships_on_repair_service_delete
AFTER DELETE ON repair_service
FOR EACH ROW EXECUTE FUNCTION fn_delete_feed_memberships_on_parent_delete('REPAIR');

DROP TRIGGER IF EXISTS trg_delete_feed_memberships_on_warranty_claim_delete ON warranty_claims;
CREATE TRIGGER trg_delete_feed_memberships_on_warranty_claim_delete
AFTER DELETE ON warranty_claims
FOR EACH ROW EXECUTE FUNCTION fn_delete_feed_memberships_on_parent_delete('WARRANTY_CLAIM');

-- ── Tenant-from-birth: loud-fail org default + FORCE RLS + canonical policy ─
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'enforce_tenant_isolation') THEN
    PERFORM enforce_tenant_isolation('feed_memberships');
  ELSE
    RAISE NOTICE 'enforce_tenant_isolation absent — feed_memberships left without FORCE RLS';
  END IF;
END $$;

COMMIT;
