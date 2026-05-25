-- Unfound queue — drop unmatched cartons that already have any
-- receiving_lines AND drop the station_exception branch entirely.
--
-- Before: v_unfound_queue's unmatched_receiving branch surfaced every
--   `receiving.source = 'unmatched'` row. The operator could link a
--   product (via Ecwid search) or a repair-service order (via the new
--   /api/ecwid/recent-repair-orders flow) but the carton stayed in the
--   queue until source flipped to 'zoho_po' (only happened when a PO#
--   was written). For the "add an item but no PO yet" case the carton
--   stuck around.
-- After: any unmatched receiving with at least one receiving_lines row
--   is treated as triaged and falls off the queue. Operator can still
--   reach it via the main receiving table.
--
-- The station_exception branch is dropped entirely — those exceptions
-- are now triaged at the affected station, not from the receiving
-- sidebar. Existing rows in orders_exceptions are unaffected.

BEGIN;

DROP VIEW IF EXISTS v_unfound_queue;

CREATE VIEW v_unfound_queue AS
-- ── Branch 1: unmatched receiving ────────────────────────────────────────
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
  -- New: hide cartons that already have at least one line. Operator has
  -- linked a product (regular Ecwid search) or a repair service
  -- (/api/ecwid/recent-repair-orders → add-unmatched-line) — the
  -- physical package is no longer "unidentified".
  AND NOT EXISTS (
    SELECT 1 FROM receiving_lines rl2 WHERE rl2.receiving_id = r.id
  )
GROUP BY
  r.id,
  r.organization_id,
  r.receiving_tracking_number,
  r.receiving_date_time,
  ov.zendesk_ticket_id, ov.zendesk_synced_at,
  ov.usa_team_note, ov.vietnam_team_note,
  ov.follow_up_at, ov.checked, ov.checked_at

UNION ALL

-- ── Branch 2: email_po (PO Mailbox) ──────────────────────────────────────
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
WHERE empo.pile <> 'done';

COMMENT ON VIEW v_unfound_queue IS
  'Unfound queue — unmatched_receiving (with NO linked lines) + email_po. station_exception branch retired 2026-05-25.';

COMMIT;
