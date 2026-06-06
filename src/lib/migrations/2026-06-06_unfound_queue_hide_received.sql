-- Unfound queue — drop unmatched cartons that have already been RECEIVED.
--
-- Before: v_unfound_queue's unmatched_receiving branch surfaced every
--   `receiving.source = 'unmatched'` carton that had no linked lines —
--   regardless of whether it had been received/unboxed at the dock. A
--   received-but-unmatched carton (no Zoho PO, but physically handled →
--   receiving.unboxed_at set) is no longer "to identify" work, yet it kept
--   showing in the Receiving-triage UNFOUND list.
-- After: add `AND r.unboxed_at IS NULL` to Branch 1. Once a carton is
--   received (unboxed_at stamped — by the receive flow or the
--   backfill-unfound-received --all pass), it falls off the unfound queue.
--   New scans (unboxed_at NULL) still appear as pending identification.
--
-- email_po (Branch 2) is unchanged. View shape is identical to
-- 2026-05-25_unfound_queue_drop_linked.sql plus the one new predicate.

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
  -- Hide cartons that already have at least one line (operator linked a
  -- product / repair service — no longer "unidentified").
  AND NOT EXISTS (
    SELECT 1 FROM receiving_lines rl2 WHERE rl2.receiving_id = r.id
  )
  -- New (2026-06-06): hide cartons that have been RECEIVED. A received
  -- unfound carton is done, not pending identification.
  AND r.unboxed_at IS NULL
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
  'Unfound queue — unmatched_receiving (no linked lines, NOT yet received) + email_po. Received cartons hidden 2026-06-06.';

COMMIT;
