-- Unfound queue — Phase 2.5: fold the PO Mailbox source into v_unfound_queue.
--
-- Phase 2 baseline (2026-05-22_unfound_overlay.sql) defined the view with
-- the unmatched_receiving branch only. This migration adds the email_po
-- UNION ALL branch. After this lands, /inventory/po-mailbox can be
-- decommissioned (Phase 2.4) since the queue shows mailbox rows alongside
-- unmatched-receiving rows with a Kind filter.
--
-- email_missing_purchase_orders semantics:
--   • pile = inbox | upload | ignore | done
--   • status (legacy) stays in lockstep via trigger (see
--     2026-05-24_po_mailbox_triage_phase1.sql)
--   • pile <> 'done' = unresolved → belongs in the queue
--
-- product_title / serial_numbers stay NULL for mailbox rows (no product
-- info parsed at intake). context surfaces the email subject so operators
-- still see what came in. po_numbers[] is appended to context so the queue
-- shows the extracted PO numbers without needing a column reshuffle.

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

-- ── Branch 2: email_po (PO Mailbox) ──────────────────────────────────────
SELECT
  'email_po'::text                             AS kind,
  empo.id::text                                AS source_id,
  empo.organization_id                         AS organization_id,
  NULL::text                                   AS product_title,
  NULL::text                                   AS serial_numbers,
  -- context: subject + extracted PO #s for at-a-glance triage
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

-- ── Branch 3 (Phase 2.6): station_exception will UNION ALL here ──────────

COMMENT ON VIEW v_unfound_queue IS
  'Unfound queue surface. Phase 2.5 = unmatched_receiving + email_po. '
  'Phase 2.6 will add the station_exception branch.';

COMMIT;
