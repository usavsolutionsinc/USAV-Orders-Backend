-- ============================================================================
-- 2026-07-05c: Seed the Test surface composition (operator-surfaces Phase 13)
-- ============================================================================
-- Models the Test surface as a page-bound station_definitions row so the
-- SurfaceRenderer has a real composition to mount. Page/mode key match the
-- SURFACE_REGISTRY entry for `test` (src/lib/stations/surface-keys.ts):
--   page_key = 'tech'   mode_key = 'testing'
--
-- Composition (all ids/sources/blocks are registered CODE, so
-- validateStationConfig passes and publish would accept it — proven DB-free by
-- src/lib/stations/composition-cutover.test.ts):
--   trigger slot → scan_band (surface: 'test' → the test scan classifier)
--   queue slot   → rail_feed  bound to testing.tech_queue (units awaiting test /
--                  orders ready to ship, from GET /api/inbox/tech-queue)
--
-- SAFETY — this is DORMANT by default, exactly like the unbox seed. The
-- SurfaceGate on `/test` renders the composition ONLY when BOTH this active row
-- exists AND the per-org organization_feature_flags(flag='surface_composed_render')
-- is enabled (default OFF, see src/lib/feature-flags.ts isSurfaceComposedRender).
-- Seeding an ACTIVE row changes nothing until an org explicitly flips the flag —
-- the 'legacy' hard-coded Testing tree keeps rendering for everyone.
--
-- Bound to the org-1 testing workflow node when present (so Studio L2 shows a
-- real composed screen); else page-bound (null), which still renders.
--
-- Idempotent: ON CONFLICT (org, page_key, mode_key, version) DO NOTHING.
--
-- Rollback (manual, dev only):
--   DELETE FROM station_definitions
--    WHERE organization_id = '00000000-0000-0000-0000-000000000001'
--      AND page_key = 'tech' AND mode_key = 'testing' AND version = 1;
-- ============================================================================

DO $$
DECLARE
  v_org  uuid := '00000000-0000-0000-0000-000000000001';  -- USAV (org #1)
  v_node text := 'refurb-v1-testing';
  v_bound_node text;
BEGIN
  -- Bind to the testing node if it exists in this org's graph; else leave null.
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
    'tech',
    'testing',
    'Testing',
    v_bound_node,
    jsonb_build_object(
      'slots', jsonb_build_object(
        'trigger', jsonb_build_array(
          jsonb_build_object(
            'id', 'blk_test_scan',
            'block', 'scan_band',
            'display', jsonb_build_object(
              'surface', 'test',
              'placeholder', 'Scan a serial, tracking, or order…'
            )
          )
        ),
        'queue', jsonb_build_array(
          jsonb_build_object(
            'id', 'blk_test_queue',
            'block', 'rail_feed',
            'source', jsonb_build_object(
              'id', 'testing.tech_queue',
              'filters', jsonb_build_object(),
              'fields', jsonb_build_object(
                'title', 'title',
                'ref',   'tracking_number',
                'meta',  'queue_kind'
              )
            ),
            'display', jsonb_build_object(
              'empty_text', 'No units awaiting test.',
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
