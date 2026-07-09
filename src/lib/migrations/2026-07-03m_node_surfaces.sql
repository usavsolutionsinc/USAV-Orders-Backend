-- ============================================================================
-- 2026-07-03m: node_surfaces — Studio graph ↔ rails/surfaces linkage
-- (Phase 0 of docs/todo/universal-feed-polymorphic-plan.md §2.4)
-- ============================================================================
-- Declares which feed(s) a workflow node exposes and in what role: the SoT for
-- "this node's inbox is feed_key X". feed_memberships denormalize
-- (workflow_definition_id, node_id) from here for rail speed; the canvas
-- surface-occupancy lens joins through here.
--
-- Contract notes (.claude/rules/polymorphic-tables.md):
--   • This is NOT an (entity_type, entity_id) polymorphic table — both parents
--     are fixed. workflow_definition_id gets a real FK ON DELETE CASCADE
--     (discarding a draft cleans its surfaces).
--   • node_id is deliberately FK-FREE, with integrity handled at the
--     definition level only: the Studio graph-save route
--     (PUT /api/studio/definitions/[id]/graph) replaces workflow_nodes rows
--     wholesale (DELETE + INSERT in one tx), so an FK/trigger on
--     workflow_nodes would sever every surface on every draft save. A surface
--     whose node was genuinely removed from the graph is an app-level lint
--     (Studio diagnostics / AI read tools flag it), not a DB error. This gap
--     is explicit and documented per contract point 5.
--   • feed_key + role — second axes validated in the app-layer registry
--     (src/lib/surfaces/registry.ts); no CHECKs by design (additive kinds).
--   • created_at/updated_at added beyond the plan's minimal sketch, per the
--     contract's canonical skeleton.
--
-- Safety gating: brand-new table, zero writers at author time. Phase 3
-- writers (applyAgentMutation node_surface.* kinds) stamp organization_id
-- explicitly under withTenantTransaction → tenant-from-birth safe.
--
-- ROLLBACK:
--   select relax_tenant_isolation('node_surfaces');
--   DROP TABLE IF EXISTS node_surfaces;
--
-- VERIFY (after apply): npm run tenancy:coverage
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS node_surfaces (
  id                     BIGSERIAL PRIMARY KEY,
  organization_id        UUID NOT NULL,             -- no DEFAULT; enforce_tenant_isolation() installs it
  workflow_definition_id INTEGER NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  node_id                TEXT NOT NULL,             -- no FK by design (see header)
  feed_key               TEXT NOT NULL,             -- registry-validated
  role                   TEXT NOT NULL DEFAULT 'inbox',  -- registry-validated
  config                 JSONB NOT NULL DEFAULT '{}',
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One surface per (definition, node, feed).
CREATE UNIQUE INDEX IF NOT EXISTS ux_node_surfaces_natural
  ON node_surfaces (organization_id, workflow_definition_id, node_id, feed_key);

-- "Which nodes expose this feed" (rail → canvas reverse lookup).
CREATE INDEX IF NOT EXISTS idx_node_surfaces_org_feed
  ON node_surfaces (organization_id, feed_key);

COMMENT ON TABLE node_surfaces IS
  'Studio graph node ↔ feed/surface declaration (plan: universal-feed-polymorphic-plan.md §2.4). node_id integrity is definition-scoped by design (graph saves replace workflow_nodes wholesale); orphaned-surface detection is an app-level lint. feed_key/role validated by src/lib/surfaces/registry.ts. Tenant-scoped from birth.';

-- ── Tenant-from-birth enforcement ────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'enforce_tenant_isolation') THEN
    PERFORM enforce_tenant_isolation('node_surfaces');
  ELSE
    RAISE NOTICE 'enforce_tenant_isolation absent — node_surfaces left without FORCE RLS';
  END IF;
END $$;

COMMIT;
