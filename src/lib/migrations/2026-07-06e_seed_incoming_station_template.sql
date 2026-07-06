-- ============================================================================
-- 2026-07-06e: Seed the default Incoming station template (Universal Incoming §9.7)
-- ============================================================================
-- Gives the ('receiving','incoming') surface a ready-to-review composed station:
-- two Checklist blocks in the `queue` slot —
--   1. receiving.incoming_all       (all sources, attach-tracking + link-Zoho-PO)
--   2. receiving.awaiting_tracking_pos (POs still needing a tracking#)
-- — a registry-valid composition (validateStationConfig passes) that ALSO passes
-- the Universal-Incoming publish gate for a Zoho-only org (both sources default to
-- inbound='all', so no eBay flag / buyer account is required to publish it).
--
-- Seeded as a DRAFT (is_active = FALSE): it is inert until the owner publishes it
-- from the Studio (POST /api/stations/publish) AND enables surface_composed_render.
-- The surface renders its legacy tree by default, so this changes no behavior — it
-- only hands tenants a starting point instead of a blank builder.
--
-- Long-term home: new-org provisioning (seedOrgCatalog) should clone this template
-- per org (plan §9.7). This migration seeds ONLY org #1 (USAV), mirroring the
-- 2026-06-22b node-station seed — a demoable default, not a per-tenant backfill.
--
-- Tenant safety: organization_id set explicitly; station_definitions carries the
-- per-org unique key (org, page_key, mode_key, version), so this coexists with
-- every other org's stations.
--
-- Idempotent: ON CONFLICT (organization_id, page_key, mode_key, version)
-- DO NOTHING — re-running is a no-op and never clobbers an owner's later edits
-- (those bump version / flip is_active).
--
-- Rollback (manual, dev only):
--   DELETE FROM station_definitions
--    WHERE organization_id = '00000000-0000-0000-0000-000000000001'
--      AND page_key = 'receiving' AND mode_key = 'incoming' AND version = 1
--      AND is_active = FALSE;
-- ============================================================================

DO $$
DECLARE
  v_org uuid := '00000000-0000-0000-0000-000000000001';  -- USAV (org #1)
BEGIN
  INSERT INTO station_definitions
    (organization_id, page_key, mode_key, label, workflow_node_id,
     config, version, is_active, updated_by)
  VALUES (
    v_org,
    'receiving',
    'incoming',
    'Incoming — all sources',
    NULL,
    jsonb_build_object(
      'slots', jsonb_build_object(
        'queue', jsonb_build_array(
          jsonb_build_object(
            'id', 'blk_incoming_all',
            'block', 'checklist',
            'source', jsonb_build_object(
              'id', 'receiving.incoming_all',
              'filters', jsonb_build_object('inbound', 'all', 'limit', '50'),
              'fields', jsonb_build_object(
                'title', 'po_number',
                'ref',   'vendor_name',
                'meta',  'inbound_source'
              )
            ),
            'display', jsonb_build_object('variant', 'check_act'),
            'actions', jsonb_build_array('incoming.attach_tracking', 'incoming.link_zoho_po'),
            'done_when', NULL
          ),
          jsonb_build_object(
            'id', 'blk_awaiting_tracking',
            'block', 'checklist',
            'source', jsonb_build_object(
              'id', 'receiving.awaiting_tracking_pos',
              'filters', jsonb_build_object('inbound', 'all', 'limit', '50'),
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
    FALSE,
    NULL
  )
  ON CONFLICT (organization_id, page_key, mode_key, version) DO NOTHING;
END $$;
