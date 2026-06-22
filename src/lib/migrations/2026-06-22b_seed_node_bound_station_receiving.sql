-- ============================================================================
-- 2026-06-22b: Seed ONE node-bound station_definition (Operations Studio ST5)
-- ============================================================================
-- Phase D of the Operations Studio Part-2 roadmap connects the station builder
-- to the workflow graph: a composed station can be bound to a precise workflow
-- node via station_definitions.workflow_node_id, so zoom-L2 on that node shows
-- a real composed screen instead of "No station bound".
--
-- This seed binds the org-1 receive node ('refurb-v1-receive', the RECEIVING
-- step of the active "Standard refurb-and-list" v1 graph seeded in
-- 2026-06-11b) to a single Checklist station that works the
-- receiving.awaiting_tracking_pos feed. It exists purely to make L2 demoable;
-- owners edit/rebind it from the Studio thereafter (PUT
-- /api/studio/nodes/[id]/station + .../publish).
--
-- Reserved node-station namespace (so it never collides with the page-bound
-- station rows the /api/stations builder writes):
--   page_key = 'studio-node'
--   mode_key = <workflow_node_id>           ('refurb-v1-receive')
-- Mirrors src/lib/studio/node-station.ts (NODE_STATION_PAGE_KEY).
--
-- The config is a Checklist (the one real registered block) in the `queue`
-- slot, bound to the receiving.awaiting_tracking_pos data source with the
-- incoming.attach_tracking action as its done-action — a registry-valid
-- composition (validateStationConfig passes), so publish would accept it.
--
-- Tenant safety: organization_id is set explicitly to org-1; station_definitions
-- already carries the per-org unique key (org, page_key, mode_key, version), so
-- this row coexists with every other org's stations.
--
-- Idempotent: ON CONFLICT on ux_station_definitions_org_page_mode_version
-- (org, page_key, mode_key, version) DO NOTHING — re-running is a no-op and it
-- never clobbers an owner's later edits (those bump version / flip is_active).
--
-- Rollback (manual, dev only):
--   DELETE FROM station_definitions
--    WHERE organization_id = '00000000-0000-0000-0000-000000000001'
--      AND page_key = 'studio-node' AND mode_key = 'refurb-v1-receive'
--      AND version = 1;
-- ============================================================================

DO $$
DECLARE
  v_org  uuid := '00000000-0000-0000-0000-000000000001';  -- USAV (org #1)
  v_node text := 'refurb-v1-receive';
BEGIN
  -- Only seed when the bound node actually exists in this org's active graph,
  -- so a fresh DB without the 2026-06-11b workflow seed simply skips it.
  IF NOT EXISTS (
    SELECT 1
      FROM workflow_nodes wn
      JOIN workflow_definitions wd ON wd.id = wn.workflow_definition_id
     WHERE wn.id = v_node AND wd.organization_id = v_org
  ) THEN
    RAISE NOTICE 'node % not present for org % — skipping node-station seed', v_node, v_org;
    RETURN;
  END IF;

  INSERT INTO station_definitions
    (organization_id, page_key, mode_key, label, workflow_node_id,
     config, version, is_active, updated_by)
  VALUES (
    v_org,
    'studio-node',
    v_node,
    'Receiving — incoming tracking',
    v_node,
    jsonb_build_object(
      'slots', jsonb_build_object(
        'queue', jsonb_build_array(
          jsonb_build_object(
            'id', 'blk_seedrx',
            'block', 'checklist',
            'source', jsonb_build_object(
              'id', 'receiving.awaiting_tracking_pos',
              'fields', jsonb_build_object(
                'title', 'po_number',
                'ref',   'vendor_name',
                'meta',  'po_date'
              )
            ),
            'display', jsonb_build_object('variant', 'check_act'),
            'actions', jsonb_build_array('incoming.attach_tracking'),
            'done_when', 'incoming.attach_tracking'
          )
        )
      )
    ),
    1,
    TRUE,
    NULL
  )
  ON CONFLICT (organization_id, page_key, mode_key, version) DO NOTHING;
END $$;
