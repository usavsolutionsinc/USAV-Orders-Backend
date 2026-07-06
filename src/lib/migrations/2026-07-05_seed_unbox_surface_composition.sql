-- ============================================================================
-- 2026-07-05: Seed the Unbox surface composition (operator-surfaces Phase 3b)
-- ============================================================================
-- Models the Unbox surface as a page-bound station_definitions row so the
-- SurfaceRenderer has a real composition to mount. Page/mode key match the
-- SURFACE_REGISTRY entry for `unbox` (src/lib/stations/surface-keys.ts):
--   page_key = 'receiving'   mode_key = 'receive'
--
-- Composition (all ids/sources/blocks are registered CODE, so
-- validateStationConfig passes and publish would accept it):
--   trigger slot → scan_band  (surface-aware scan classifier → station:scan event)
--   queue slot   → rail_feed   bound to receiving.unbox_queue (cartons awaiting unbox)
--
-- SAFETY — this is DORMANT by default. The SurfaceGate renders the composition
-- ONLY when BOTH this active row exists AND the per-org
-- organization_feature_flags(flag='surface_composed_render') is enabled (default
-- OFF, see src/lib/feature-flags.ts isSurfaceComposedRender). So seeding an
-- ACTIVE row changes nothing until an org explicitly flips the flag — the
-- 'legacy' hard-coded Unbox tree keeps rendering for everyone.
--
-- Bound to the org-1 receive workflow node when present (so Studio L2 shows a
-- real composed screen), mirroring 2026-06-22b's node-bind approach but on the
-- page-bound namespace.
--
-- Idempotent: ON CONFLICT (org, page_key, mode_key, version) DO NOTHING.
--
-- Rollback (manual, dev only):
--   DELETE FROM station_definitions
--    WHERE organization_id = '00000000-0000-0000-0000-000000000001'
--      AND page_key = 'receiving' AND mode_key = 'receive' AND version = 1;
-- ============================================================================

DO $$
DECLARE
  v_org  uuid := '00000000-0000-0000-0000-000000000001';  -- USAV (org #1)
  v_node text := 'refurb-v1-receive';
  v_bound_node text;
BEGIN
  -- Bind to the receive node if it exists in this org's graph; else leave null.
  SELECT wn.id INTO v_bound_node
    FROM workflow_nodes wn
    JOIN workflow_definitions wd ON wd.id = wn.workflow_definition_id
   WHERE wn.id = v_node AND wd.organization_id = v_org
   LIMIT 1;

  INSERT INTO station_definitions
    (organization_id, page_key, mode_key, label, workflow_node_id,
     config, version, is_active, updated_by)
  VALUES (
    v_org,
    'receiving',
    'receive',
    'Unbox',
    v_bound_node,
    jsonb_build_object(
      'slots', jsonb_build_object(
        'trigger', jsonb_build_array(
          jsonb_build_object(
            'id', 'blk_unbox_scan',
            'block', 'scan_band',
            'display', jsonb_build_object(
              'surface', 'unbox',
              'placeholder', 'Scan tracking, serial, or SKU…'
            )
          )
        ),
        'queue', jsonb_build_array(
          jsonb_build_object(
            'id', 'blk_unbox_queue',
            'block', 'rail_feed',
            'source', jsonb_build_object(
              'id', 'receiving.unbox_queue',
              'filters', jsonb_build_object('status', 'ARRIVED_MATCHED', 'limit', '100'),
              'fields', jsonb_build_object(
                'title', 'title',
                'ref',   'tracking_number',
                'meta',  'carrier'
              )
            ),
            'display', jsonb_build_object(
              'empty_text', 'No cartons awaiting unbox.',
              'show_count', true
            )
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
