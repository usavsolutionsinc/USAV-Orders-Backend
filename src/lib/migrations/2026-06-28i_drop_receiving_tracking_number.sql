-- ============================================================================
-- 2026-06-28i: drop the legacy receiving.receiving_tracking_number column
-- ============================================================================
-- Tracking now lives solely in shipping_tracking_numbers (the canonical STN
-- master), linked via receiving.shipment_id. All application reads were
-- repointed to stn.tracking_number_raw and all writes redirected through
-- registerShipmentPermissive → shipment_id; the reconcile jobs were re-keyed
-- onto STN. The 2026-06-28h backfill guarantees (with a RAISE EXCEPTION guard)
-- that no usable tracking remains only on the legacy column.
--
-- Two DB VIEWS still referenced the column and must be handled first, or the
-- DROP fails ("other objects depend on it"):
--   * receiving_with_tracking — a compat view (latest_tracking_number) with NO
--     application consumers → dropped outright (lean: it was dead).
--   * v_unfound_queue — actively used by the unfound-queue routes/UI → redefined
--     to source the unfound `context` tracking from STN (stn.tracking_number_raw
--     via receiving.shipment_id), mirroring the same swap done in app SQL.
--
-- ⚠️ DEPLOY ORDERING (hard requirement): apply this ONLY AFTER the column-free
-- application code is deployed. Run the 2026-06-28h backfill first (its guard
-- must pass). Recoverable via Neon PITR if needed.
-- ============================================================================

BEGIN;

-- 1. Dead compat view — no application consumers; remove its dependency.
DROP VIEW IF EXISTS receiving_with_tracking;

-- 2. Live view — repoint its `context` tracking from the legacy column to STN.
CREATE OR REPLACE VIEW v_unfound_queue AS
 SELECT 'unmatched_receiving'::text AS kind,
    r.id::text AS source_id,
    r.organization_id,
    NULLIF(string_agg(rl.item_name, ' | '::text), ''::text) AS product_title,
    NULLIF(string_agg(su.serial_number, ', '::text), ''::text) AS serial_numbers,
    stn.tracking_number_raw AS context,
    r.receiving_date_time AS created_at,
    ov.zendesk_ticket_id,
    ov.zendesk_synced_at,
    ov.usa_team_note,
    ov.vietnam_team_note,
    ov.follow_up_at,
    COALESCE(ov.checked, false) AS checked,
    ov.checked_at
   FROM receiving r
     LEFT JOIN receiving_lines rl ON rl.receiving_id = r.id
     LEFT JOIN serial_units su ON su.origin_receiving_line_id = rl.id
     LEFT JOIN unfound_overlay ov ON ov.source_kind = 'unmatched_receiving'::text AND ov.source_id = r.id::text AND ov.organization_id = r.organization_id
     LEFT JOIN shipping_tracking_numbers stn ON stn.id = r.shipment_id
  WHERE r.source = 'unmatched'::text AND NOT (EXISTS ( SELECT 1
           FROM receiving_lines rl2
          WHERE rl2.receiving_id = r.id)) AND r.unboxed_at IS NULL
  GROUP BY r.id, r.organization_id, stn.tracking_number_raw, r.receiving_date_time, ov.zendesk_ticket_id, ov.zendesk_synced_at, ov.usa_team_note, ov.vietnam_team_note, ov.follow_up_at, ov.checked, ov.checked_at
UNION ALL
 SELECT 'email_po'::text AS kind,
    empo.id::text AS source_id,
    empo.organization_id,
    NULL::text AS product_title,
    NULL::text AS serial_numbers,
        CASE
            WHEN COALESCE(array_length(empo.po_numbers, 1), 0) > 0 THEN (COALESCE(empo.email_subject, '(no subject)'::text) || ' · PO: '::text) || array_to_string(empo.po_numbers, ', '::text)
            ELSE COALESCE(empo.email_subject, '(no subject)'::text)
        END AS context,
    empo.scanned_at AS created_at,
    ov.zendesk_ticket_id,
    ov.zendesk_synced_at,
    ov.usa_team_note,
    ov.vietnam_team_note,
    ov.follow_up_at,
    COALESCE(ov.checked, false) AS checked,
    ov.checked_at
   FROM email_missing_purchase_orders empo
     LEFT JOIN unfound_overlay ov ON ov.source_kind = 'email_po'::text AND ov.source_id = empo.id::text AND ov.organization_id = empo.organization_id
  WHERE empo.pile <> 'done'::text;

-- 3. No remaining dependents — drop the legacy column.
ALTER TABLE receiving DROP COLUMN IF EXISTS receiving_tracking_number;

COMMIT;
