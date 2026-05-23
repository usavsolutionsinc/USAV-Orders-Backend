-- Unfound queue — Phase 2.6: add the station_exception source.
--
-- orders_exceptions captures scans from tech/packer/verify/mobile/fba
-- stations where a serial or tracking didn't resolve to a known order.
-- Some of those scans share a tracking number with rows the
-- unmatched_receiving branch already surfaces — those should be
-- suppressed from this branch so each physical event only appears once
-- in the queue.
--
-- Dedup rule:
--   Hide a station_exception row if there is already an unmatched
--   `receiving` row with the same shipping_tracking_number AND same
--   organization. The operator sees + handles the receiving row; the
--   station_exception will auto-resolve via the station's own resolution
--   path once the receiving lands.
--
-- Rows that pass the dedup show:
--   context        = shipping_tracking_number (• {source_station})
--   product_title  = NULL (no SKU on these rows)
--   serial_numbers = NULL
--   notes are surfaced into context too, when present, so the operator
--   doesn't have to drill in to read them.

BEGIN;

DROP VIEW IF EXISTS v_unfound_queue;

CREATE VIEW v_unfound_queue AS
-- ── Branch 1: unmatched receiving (Phase 2 baseline) ─────────────────────
SELECT
  'unmatched_receiving'::text                  AS kind,
  r.id::text                                   AS source_id,
  r.organization_id                            AS organization_id,
  NULLIF(string_agg(rl.item_name, ' | '), '') AS product_title,
  NULLIF(string_agg(su.serial_number, ', '),'') AS serial_numbers,
  r.receiving_tracking_number                  AS context,
  r.receiving_date_time                        AS created_at,
  ov.zendesk_ticket_id,
  ov.zendesk_synced_at,
  ov.usa_team_note,
  ov.vietnam_team_note,
  ov.follow_up_at,
  COALESCE(ov.checked, FALSE)                  AS checked,
  ov.checked_at
FROM receiving r
LEFT JOIN receiving_lines rl
  ON rl.receiving_id = r.id
LEFT JOIN serial_units su
  ON su.origin_receiving_line_id = rl.id
LEFT JOIN unfound_overlay ov
  ON ov.source_kind = 'unmatched_receiving'
 AND ov.source_id  = r.id::text
 AND ov.organization_id = r.organization_id
WHERE r.source = 'unmatched'
GROUP BY
  r.id,
  r.organization_id,
  r.receiving_tracking_number,
  r.receiving_date_time,
  ov.zendesk_ticket_id, ov.zendesk_synced_at,
  ov.usa_team_note, ov.vietnam_team_note,
  ov.follow_up_at, ov.checked, ov.checked_at

UNION ALL

-- ── Branch 2: email_po (PO Mailbox, added Phase 2.5) ─────────────────────
SELECT
  'email_po'::text                             AS kind,
  empo.id::text                                AS source_id,
  empo.organization_id                         AS organization_id,
  NULL::text                                   AS product_title,
  NULL::text                                   AS serial_numbers,
  CASE
    WHEN coalesce(array_length(empo.po_numbers, 1), 0) > 0 THEN
      COALESCE(empo.email_subject, '(no subject)')
        || ' · PO: ' || array_to_string(empo.po_numbers, ', ')
    ELSE
      COALESCE(empo.email_subject, '(no subject)')
  END                                          AS context,
  empo.scanned_at                              AS created_at,
  ov.zendesk_ticket_id,
  ov.zendesk_synced_at,
  ov.usa_team_note,
  ov.vietnam_team_note,
  ov.follow_up_at,
  COALESCE(ov.checked, FALSE)                  AS checked,
  ov.checked_at
FROM email_missing_purchase_orders empo
LEFT JOIN unfound_overlay ov
  ON ov.source_kind = 'email_po'
 AND ov.source_id  = empo.id::text
 AND ov.organization_id = empo.organization_id
WHERE empo.pile <> 'done'

UNION ALL

-- ── Branch 3: station_exception (NEW in Phase 2.6) ──────────────────────
SELECT
  'station_exception'::text                    AS kind,
  oe.id::text                                  AS source_id,
  oe.organization_id                           AS organization_id,
  NULL::text                                   AS product_title,
  NULL::text                                   AS serial_numbers,
  -- context = tracking + station + (notes when present), comma-joined so
  -- the queue cell stays single-line at typical widths.
  oe.shipping_tracking_number
    || ' · ' || lower(oe.source_station)
    || COALESCE(' · ' || NULLIF(oe.notes, ''), '')
                                               AS context,
  oe.created_at                                AS created_at,
  ov.zendesk_ticket_id,
  ov.zendesk_synced_at,
  ov.usa_team_note,
  ov.vietnam_team_note,
  ov.follow_up_at,
  COALESCE(ov.checked, FALSE)                  AS checked,
  ov.checked_at
FROM orders_exceptions oe
LEFT JOIN unfound_overlay ov
  ON ov.source_kind = 'station_exception'
 AND ov.source_id  = oe.id::text
 AND ov.organization_id = oe.organization_id
WHERE oe.status = 'open'
  -- Dedup: hide rows that overlap with an unmatched receiving on the same
  -- tracking + organization. The receiving branch already surfaces the
  -- physical package; the station-side exception will auto-resolve once
  -- the receiving flow lands.
  AND NOT EXISTS (
    SELECT 1
      FROM receiving r2
     WHERE r2.source = 'unmatched'
       AND r2.organization_id = oe.organization_id
       AND r2.receiving_tracking_number = oe.shipping_tracking_number
  );

COMMENT ON VIEW v_unfound_queue IS
  'Unfound queue surface — all three sources merged. Phase 2.6 final.';

COMMIT;
