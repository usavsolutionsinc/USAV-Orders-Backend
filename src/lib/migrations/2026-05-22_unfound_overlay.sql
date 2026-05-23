-- Unfound queue — polymorphic overlay + presentation view.
--
-- Phase 2 puts a single flat "Unfound" tab on the receiving page. The queue is
-- a thin handoff log: notes + Zendesk ticket + check + follow-up. Domain truth
-- stays in the source tables.
--
-- Three source kinds will eventually feed the queue:
--
--   • email_po              — email_missing_purchase_orders (PO Mailbox)
--   • unmatched_receiving   — receiving WHERE source='unmatched'
--   • station_exception     — orders_exceptions WHERE status='open'
--
-- The overlay table is created with the full 3-kind CHECK from day one so
-- adding the other branches later is a view-only change with zero data
-- migration. The view in this migration only includes unmatched_receiving;
-- Phases 2.5 and 2.6 will UNION ALL the other two branches in (markers below).
--
-- Why an overlay table instead of polymorphic columns on each source table:
--   • Each source table already has its own write paths (lookup-po,
--     scan-tracking, po-gmail/reconcile). Duplicating zendesk/notes/check
--     columns on all three forces every writer to think about queue state.
--   • The overlay row is LAZY — it only exists once a human edits the row in
--     the queue. View LEFT JOINs handle absence.
--   • Adding a 4th source kind later = one CHECK addition + one view branch.

BEGIN;

-- ── 1. unfound_overlay (polymorphic-ready) ────────────────────────────────

CREATE TABLE IF NOT EXISTS unfound_overlay (
  id                SERIAL PRIMARY KEY,
  organization_id   UUID NOT NULL DEFAULT (
    COALESCE(
      NULLIF(current_setting('app.current_org', true), '')::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid
    )
  ),
  source_kind       TEXT NOT NULL
    CHECK (source_kind IN ('email_po', 'unmatched_receiving', 'station_exception')),
  source_id         TEXT NOT NULL,

  -- Queue metadata
  zendesk_ticket_id TEXT,
  zendesk_synced_at TIMESTAMPTZ,
  usa_team_note     TEXT,
  vietnam_team_note TEXT,
  follow_up_at      TIMESTAMPTZ,
  checked           BOOLEAN NOT NULL DEFAULT FALSE,
  checked_at        TIMESTAMPTZ,
  checked_by        INTEGER REFERENCES staff(id) ON DELETE SET NULL,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by        INTEGER REFERENCES staff(id) ON DELETE SET NULL,

  UNIQUE (organization_id, source_kind, source_id)
);

-- Primary read path: list unchecked rows for an org, newest first, by kind.
CREATE INDEX IF NOT EXISTS idx_unfound_overlay_filter
  ON unfound_overlay (organization_id, source_kind, checked, updated_at DESC);

-- Reverse lookup: "is this zendesk ticket already wired to a queue row?"
CREATE INDEX IF NOT EXISTS idx_unfound_overlay_zendesk
  ON unfound_overlay (zendesk_ticket_id)
  WHERE zendesk_ticket_id IS NOT NULL;

-- Keep updated_at fresh on UPDATEs.
CREATE OR REPLACE FUNCTION unfound_overlay_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  -- Stamp checked_at the moment the box gets ticked, clear when un-ticked.
  IF NEW.checked IS DISTINCT FROM OLD.checked THEN
    NEW.checked_at := CASE WHEN NEW.checked THEN NOW() ELSE NULL END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_unfound_overlay_touch_updated_at ON unfound_overlay;

CREATE TRIGGER trg_unfound_overlay_touch_updated_at
  BEFORE UPDATE ON unfound_overlay
  FOR EACH ROW
  EXECUTE FUNCTION unfound_overlay_touch_updated_at();


-- ── 2. v_unfound_queue — presentation view (unmatched_receiving only) ────
--
-- Shape (all branches must match):
--   kind, source_id, organization_id, product_title, serial_numbers,
--   context, created_at,
--   zendesk_ticket_id, zendesk_synced_at,
--   usa_team_note, vietnam_team_note,
--   follow_up_at, checked, checked_at
--
-- Phase 2.5 UNION ALL branch: email_missing_purchase_orders WHERE pile <> 'done'
-- Phase 2.6 UNION ALL branch: orders_exceptions WHERE status = 'open'
--
-- Drop+recreate so column re-orderings during Phase 2.5/2.6 don't require
-- careful ALTER VIEW dances.

DROP VIEW IF EXISTS v_unfound_queue;

CREATE VIEW v_unfound_queue AS
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
  ov.follow_up_at, ov.checked, ov.checked_at;

COMMENT ON VIEW v_unfound_queue IS
  'Unfound queue surface. Phase 2 baseline = unmatched_receiving only. '
  'Phase 2.5 adds email_po branch, Phase 2.6 adds station_exception branch.';

COMMIT;
