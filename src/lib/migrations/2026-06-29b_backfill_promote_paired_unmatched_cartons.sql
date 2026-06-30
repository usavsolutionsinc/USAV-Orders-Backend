-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill: promote unmatched cartons whose line is already PO-linked.
-- ─────────────────────────────────────────────────────────────────────────────
-- Bug: a tracking-scanned box can duplicate an already-imported Zoho PO carton
-- (or a scope='line' relink rewrote only the line), leaving the carton at
-- source='unmatched' with a NULL header PO even though one of its lines carries
-- a real zoho_purchaseorder_id. Such cartons render the "No PO" badge and sit in
-- the Unfound queue despite being paired (e.g. carton for PO 18-14799-42907).
--
-- This promotes every such carton to its line's PO — exactly the runtime fix in
-- recomputeCartonSourceLink (src/lib/receiving/carton-source-link.ts), applied to
-- existing rows. The forward path now keeps these promoted on every relink.
--
-- Safety / idempotency:
--   • Only touches cartons that are source='unmatched' AND have a NULL header PO
--     (never a carton already matched to a real Zoho PO — its header is canonical).
--   • Representative PO = the earliest line (lowest id) carrying a non-blank
--     zoho_purchaseorder_id, mirroring the helper's `ORDER BY id ASC LIMIT 1`.
--   • COLLISION GUARD: skips any carton whose PO is already held by a matched
--     (source='zoho_po') carton. `ux_receiving_zoho_po_matched` allows exactly
--     one matched carton per PO, and the common case here is an empty Zoho-import
--     "PO shell" already holding it. Promoting into that collides — that's a
--     duplicate-carton DEDUPE (which must also reconcile the shell's
--     receiving_scans), handled separately, not a blind promotion. Skipping keeps
--     this migration safe to run in the all-files runner without ever throwing.
--   • organization_id is untouched; each carton is promoted from its OWN lines
--     (same tenant), so no cross-tenant write is possible.
--   • Re-runnable: after promotion source becomes 'zoho_po', so a second run
--     matches nothing.
-- ─────────────────────────────────────────────────────────────────────────────

WITH promo AS (
  SELECT DISTINCT ON (l.receiving_id)
         l.receiving_id,
         btrim(l.zoho_purchaseorder_id)       AS zoho_purchaseorder_id,
         NULLIF(btrim(COALESCE(l.zoho_purchaseorder_number, '')), '') AS zoho_purchaseorder_number
    FROM receiving_lines l
    JOIN receiving rc ON rc.id = l.receiving_id
   WHERE rc.source = 'unmatched'
     AND rc.zoho_purchaseorder_id IS NULL
     AND l.zoho_purchaseorder_id IS NOT NULL
     AND btrim(l.zoho_purchaseorder_id) <> ''
     -- collision guard: PO not already claimed by a matched carton
     AND NOT EXISTS (
       SELECT 1 FROM receiving m
        WHERE m.zoho_purchaseorder_id = btrim(l.zoho_purchaseorder_id)
          AND m.source = 'zoho_po'
     )
   ORDER BY l.receiving_id, l.id ASC
)
UPDATE receiving rc
   SET zoho_purchaseorder_id     = promo.zoho_purchaseorder_id,
       zoho_purchaseorder_number = COALESCE(promo.zoho_purchaseorder_number, rc.zoho_purchaseorder_number),
       source                    = 'zoho_po',
       updated_at                = NOW()
  FROM promo
 WHERE rc.id = promo.receiving_id
   AND rc.source = 'unmatched'
   AND rc.zoho_purchaseorder_id IS NULL;
