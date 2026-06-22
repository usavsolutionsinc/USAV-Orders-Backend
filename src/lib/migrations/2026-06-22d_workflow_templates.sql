-- ============================================================================
-- 2026-06-22d: workflow_templates — system-owned graph blueprints (Studio ST6 / Phase E4)
-- ============================================================================
-- The Operations Studio template library: system-owned DEFAULT workflow graphs
-- that any tenant can CLONE into its own workflow_definitions as an editable
-- draft (onboarding = clone + edit + publish, zero deploy). A template carries
-- its graph as JSONB (the same { nodes, edges } shape the studio canvas paints),
-- so the import helper re-mints node ids, remaps edges, org-stamps the rows, and
-- writes a new is_active = FALSE draft into the caller's org.
--
--   graph :: jsonb  — { nodes:[{id,type,x,y,config}], edges:[{id,source,sourcePort,target}] }
--     nodes[].id      TEXT    template-local node id (re-minted on import)
--     nodes[].type    TEXT    engine registry key (e.g. 'inspection', 'list_ebay')
--     nodes[].x,y     NUMBER  React Flow canvas coordinates
--     nodes[].config  OBJECT  per-node form state (station / states / slaHours …)
--     edges[].id      TEXT    template-local edge id (re-minted on import)
--     edges[].source      TEXT  source node id
--     edges[].sourcePort  TEXT  named output port driving conditional routing
--     edges[].target      TEXT  target node id
--
-- ── DELIBERATELY GLOBAL / SYSTEM (the tenant-from-birth exception) ──
-- workflow_templates is intentionally CROSS-TENANT reference data: these rows are
-- system-owned blueprints shared by every org, so the table has NO
-- organization_id, NO per-org key, and is NOT run through
-- enforce_tenant_isolation(). It must never hold a tenant's live data — the seed
-- below is an org-agnostic blueprint, not a copy of any org's real graph. The
-- only tenant write path (import) targets the CALLER's workflow_definitions under
-- withTenantTransaction; this table itself is read-only to tenants. This is the
-- Step-4 (global-reference/system) case from the db-migration-author skill, not
-- an omission — tenancy:coverage should treat it as deliberately unscoped.
--
-- SAFETY / GATING
--   • Additive + idempotent: CREATE TABLE / INDEX IF NOT EXISTS; the seed is an
--     ON CONFLICT (slug) DO NOTHING upsert keyed on the unique slug, so re-running
--     is a no-op and never duplicates the blueprint.
--   • No tenant surface added (no organization_id) → no RLS/FORCE/default to wire.
--
-- ROLLBACK
--   DROP TABLE IF EXISTS workflow_templates;
--   (Pure system table — no FK children, no tenant data, no constraint to relax.)
--
-- VERIFY
--   \d workflow_templates
--   SELECT slug, name, category,
--          jsonb_array_length(graph->'nodes') AS nodes,
--          jsonb_array_length(graph->'edges') AS edges
--     FROM workflow_templates;   → standard-refurb-and-list · 6 nodes · 6 edges
-- ============================================================================

CREATE TABLE IF NOT EXISTS workflow_templates (
  id          BIGSERIAL PRIMARY KEY,
  slug        TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  category    TEXT,
  graph       JSONB NOT NULL DEFAULT '{"nodes":[],"edges":[]}'::jsonb,
  is_system   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Slug is the stable, human-readable template key (the import route resolves by
-- id, but the seed upsert is idempotent on slug). Unique GLOBALLY by design —
-- there is no org dimension on this table.
CREATE UNIQUE INDEX IF NOT EXISTS ux_workflow_templates_slug
  ON workflow_templates (slug);

COMMENT ON TABLE workflow_templates IS
  'Operations Studio system-owned workflow graph blueprints (Studio ST6 / Phase E4). GLOBAL / cross-tenant by design: no organization_id, not RLS-enforced. Tenants CLONE a template into their own workflow_definitions (re-minted ids, org-stamped) — this table is never tenant-written.';

-- ── Seed the first system template: "Standard refurb-and-list" ──
-- Generalized, org-agnostic blueprint lifted from the node/edge SHAPE of
-- 2026-06-11b_seed_reseller_workflow_v1.sql (USAV's live seed) but with NO org,
-- NO is_active, and NO USAV-specific identity — the import clone re-mints every
-- id and org-stamps the cloned rows into the calling tenant.
--
--   receive ──received──▶ test-grade ──pass──▶ list-ebay ──listed──▶ pack ──packed──▶ ship
--                              │  ▲
--                           fail  └─repaired── repair
--
-- node `type` keys are the engine registry keys; config.station / config.states
-- mirror the live seed so a freshly-imported draft lints and previews the same.
INSERT INTO workflow_templates (slug, name, description, category, graph)
VALUES (
  'standard-refurb-and-list',
  'Standard refurb-and-list',
  'Receive → test/grade → (pass) list on eBay → pack → ship, with a repair loop on failed tests. The canonical used-goods reseller flow — import it, tweak the stations, and publish.',
  'reseller',
  '{
    "nodes": [
      { "id": "receive",    "type": "receiving",  "x": 40,   "y": 200,
        "config": { "station": "RECEIVING", "states": ["EXPECTED", "ARRIVED", "MATCHED", "UNBOXED"] } },
      { "id": "test-grade", "type": "inspection", "x": 340,  "y": 200,
        "config": { "station": "TECH", "states": ["AWAITING_TEST", "IN_TEST", "PASSED", "FAILED"], "producesConditionGrade": true, "slaHours": 48 } },
      { "id": "repair",     "type": "repair",     "x": 340,  "y": 460,
        "config": { "station": "TECH", "slaHours": 96 } },
      { "id": "list-ebay",  "type": "list_ebay",  "x": 640,  "y": 200,
        "config": { "station": "ADMIN", "channel": "ebay" } },
      { "id": "pack",       "type": "pack",       "x": 940,  "y": 200,
        "config": { "station": "PACK", "states": ["ALLOCATED", "PICKED", "PACKED"] } },
      { "id": "ship",       "type": "ship",       "x": 1240, "y": 200,
        "config": { "station": "PACK", "states": ["LABELED", "SHIPPED"] } }
    ],
    "edges": [
      { "id": "e-received", "source": "receive",    "sourcePort": "received", "target": "test-grade" },
      { "id": "e-pass",     "source": "test-grade", "sourcePort": "pass",     "target": "list-ebay" },
      { "id": "e-fail",     "source": "test-grade", "sourcePort": "fail",     "target": "repair" },
      { "id": "e-repaired", "source": "repair",     "sourcePort": "repaired", "target": "test-grade" },
      { "id": "e-listed",   "source": "list-ebay",  "sourcePort": "listed",   "target": "pack" },
      { "id": "e-packed",   "source": "pack",       "sourcePort": "packed",   "target": "ship" }
    ]
  }'::jsonb
)
ON CONFLICT (slug) DO NOTHING;
