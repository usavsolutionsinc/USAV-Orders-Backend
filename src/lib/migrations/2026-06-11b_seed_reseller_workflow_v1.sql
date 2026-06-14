-- ============================================================================
-- 2026-06-11b: Seed the reseller operations graph — "Standard refurb-and-list" v1
-- ============================================================================
-- Phase 0 of the Operations Studio rollout (docs/operations-studio/
-- operations-studio-plan.md): seed workflow_definitions/nodes/edges with this
-- company's real flow and publish it active, so the Phase-1 engine taps
-- (receiving scan-in, tech verdict, repair completion) have a live graph to
-- advance units through.
--
--   receive ──received──▶ test-grade ──pass──▶ list-ebay ──listed──▶ pack ──packed──▶ ship
--                              │  ▲
--                           fail  └─repaired── repair
--
-- Conventions this seed relies on:
--   • node `type` keys are the engine registry keys the Phase-C/Phase-1
--     adapters will register (src/lib/workflow/nodes/*): receiving,
--     inspection, repair, list_ebay, pack, ship. The graph is data; until an
--     adapter exists, advance() on that node parks the unit in `error`.
--   • config.states reference src/lib/receiving/workflow-stages.ts keys
--     (the numbered-state SoT) — positions, never re-declared labels.
--   • config.station keys match the operations-catalog STATIONS registry
--     (the "node with no station bound" diagnostic reads this).
--   • the `ship` node's `shipped` port is intentionally unrouted: the engine
--     treats a port with no edge as terminal → item_workflow_state = done.
--   • a node returning the reserved `error` output parks for triage without
--     an edge (src/lib/workflow/runtime.ts ERROR_OUTPUT), which is how the
--     list_ebay listed/error channel contract resolves its error lane.
--   • slaHours sit on test-grade and repair — where this business's WIP
--     actually piles up — so the Flow² lens has thresholds from day one.
--
-- Idempotent: keyed on ux_workflow_definitions_org_name_version; node/edge
-- inserts are ON CONFLICT DO NOTHING.
-- ============================================================================

DO $$
DECLARE
  v_org uuid := '00000000-0000-0000-0000-000000000001';  -- USAV (org #1)
  v_def integer;
BEGIN
  SELECT id INTO v_def
    FROM workflow_definitions
   WHERE organization_id = v_org
     AND name = 'Standard refurb-and-list'
     AND version = 1;

  IF v_def IS NULL THEN
    INSERT INTO workflow_definitions (organization_id, name, version, is_active)
    VALUES (v_org, 'Standard refurb-and-list', 1, TRUE)
    RETURNING id INTO v_def;
  END IF;

  INSERT INTO workflow_nodes (id, workflow_definition_id, type, position_x, position_y, config) VALUES
    ('refurb-v1-receive',    v_def, 'receiving',  40,   200,
     '{"station": "RECEIVING", "states": ["EXPECTED", "ARRIVED", "MATCHED", "UNBOXED"]}'),
    ('refurb-v1-test-grade', v_def, 'inspection', 340,  200,
     '{"station": "TECH", "states": ["AWAITING_TEST", "IN_TEST", "PASSED", "FAILED"], "producesConditionGrade": true, "slaHours": 48}'),
    ('refurb-v1-repair',     v_def, 'repair',     340,  460,
     '{"station": "TECH", "slaHours": 96}'),
    ('refurb-v1-list-ebay',  v_def, 'list_ebay',  640,  200,
     '{"station": "ADMIN", "channel": "ebay"}'),
    ('refurb-v1-pack',       v_def, 'pack',       940,  200,
     '{"station": "PACK", "states": ["ALLOCATED", "PICKED", "PACKED"]}'),
    ('refurb-v1-ship',       v_def, 'ship',       1240, 200,
     '{"station": "PACK", "states": ["LABELED", "SHIPPED"]}')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO workflow_edges (id, workflow_definition_id, source_node, source_port, target_node) VALUES
    ('refurb-v1-e-received', v_def, 'refurb-v1-receive',    'received', 'refurb-v1-test-grade'),
    ('refurb-v1-e-pass',     v_def, 'refurb-v1-test-grade', 'pass',     'refurb-v1-list-ebay'),
    ('refurb-v1-e-fail',     v_def, 'refurb-v1-test-grade', 'fail',     'refurb-v1-repair'),
    ('refurb-v1-e-repaired', v_def, 'refurb-v1-repair',     'repaired', 'refurb-v1-test-grade'),
    ('refurb-v1-e-listed',   v_def, 'refurb-v1-list-ebay',  'listed',   'refurb-v1-pack'),
    ('refurb-v1-e-packed',   v_def, 'refurb-v1-pack',       'packed',   'refurb-v1-ship')
  ON CONFLICT (id) DO NOTHING;
END $$;
