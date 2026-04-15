-- Backfill: link orphan receiving_lines rows to their PO-keyed receiving row.
--
-- Context: receiving_lines.receiving_id is the hard FK that unlocks per-carton
-- edits (platform, condition overrides, disposition propagation). When Zoho
-- sync creates lines before a physical scan exists, receiving_id stays NULL
-- and the sidebar's Platform dropdown stays disabled.
--
-- Fix runs in two passes and is idempotent — safe to re-run whenever new
-- Zoho lines land, and safe to embed in a nightly cron.
--
--   Pass 1: ensure every PO# referenced by a receiving_lines row has a
--           source='zoho_po' receiving row. The partial unique index
--           ux_receiving_zoho_po_matched prevents duplicates.
--   Pass 2: point every orphan line at its matching receiving row.

BEGIN;

-- Pass 1: create skeleton `receiving` rows for PO#s that don't have one yet.
-- Uses INSERT … SELECT … ON CONFLICT DO NOTHING against the partial unique
-- index so concurrent runs don't race. `zoho_purchaseorder_number` is left
-- NULL — the Zoho refresh button (or a follow-up sync) fills it in.
INSERT INTO receiving (
  source,
  zoho_purchaseorder_id,
  created_at,
  updated_at
)
SELECT DISTINCT
  'zoho_po',
  rl.zoho_purchaseorder_id,
  NOW(),
  NOW()
FROM receiving_lines rl
WHERE rl.zoho_purchaseorder_id IS NOT NULL
  AND rl.zoho_purchaseorder_id <> ''
  AND NOT EXISTS (
    SELECT 1 FROM receiving r
    WHERE r.source = 'zoho_po'
      AND r.zoho_purchaseorder_id = rl.zoho_purchaseorder_id
  )
ON CONFLICT DO NOTHING;

-- Pass 2: link every orphan line to the matching receiving row.
UPDATE receiving_lines rl
   SET receiving_id = r.id,
       updated_at   = NOW()
  FROM receiving r
 WHERE r.source = 'zoho_po'
   AND r.zoho_purchaseorder_id = rl.zoho_purchaseorder_id
   AND rl.receiving_id IS NULL
   AND rl.zoho_purchaseorder_id IS NOT NULL
   AND rl.zoho_purchaseorder_id <> '';

COMMIT;
