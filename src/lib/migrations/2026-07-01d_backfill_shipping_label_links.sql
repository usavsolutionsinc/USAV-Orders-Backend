-- 2026-07-01d_backfill_shipping_label_links.sql
-- docs/outbound-documents-plan.md Phase 0 — dual-link backfill (Decision D6).
-- Runs AFTER 2026-07-01c_outbound_document_entity_links.sql (needs the table).
--
-- For every legacy `documents` row shaped entity_type='SHIPPING_LABEL':
--   1. Insert a (ORDER, entity_id, secondary) link — always, since entity_id
--      already IS orders.id for these rows.
--   2. Resolve the order's primary STN — orders.shipment_id first, falling
--      back to the shipment_links primary row (§ read resolution order,
--      docs/outbound-documents-plan.md §2) — and insert (SHIPMENT, stn.id,
--      primary) when one is found. Orders without a resolvable STN keep the
--      ORDER-only link (flagged by scripts/verify-outbound-document-links.sql).
--   3. Normalize documents.entity_type to 'ORDER' (entity_id is untouched —
--      it already holds orders.id). This is the one column rewrite; nothing
--      is deleted, so a stale reader hardcoded to 'SHIPPING_LABEL' just stops
--      matching new rows going forward, per the plan's dual-read window.
--
-- Idempotent: every INSERT is guarded by the table's own UNIQUE constraint
-- (ON CONFLICT DO NOTHING), and the final UPDATE's WHERE clause only ever
-- matches rows that haven't been normalized yet.
--
-- ROLLBACK: this migration only adds rows / relabels entity_type — the
-- original entity_id and document_data are untouched, so there is no data
-- loss to reverse. To undo the relabel:
--   UPDATE documents SET entity_type = 'SHIPPING_LABEL'
--     WHERE entity_type = 'ORDER' AND document_type = 'shipping_label';
-- (harmless to re-run this migration afterward — it will just re-normalize).

BEGIN;

-- Step 1: ORDER (secondary) link for every legacy label row.
INSERT INTO document_entity_links (document_id, organization_id, entity_type, entity_id, link_role)
SELECT d.id, d.organization_id, 'ORDER', d.entity_id, 'secondary'
  FROM documents d
 WHERE d.entity_type = 'SHIPPING_LABEL'
   AND d.organization_id IS NOT NULL
ON CONFLICT ON CONSTRAINT ux_document_entity_links_unique DO NOTHING;

-- Step 2: SHIPMENT (primary) link when the order's STN is resolvable.
INSERT INTO document_entity_links (document_id, organization_id, entity_type, entity_id, link_role)
SELECT d.id, d.organization_id, 'SHIPMENT', resolved.stn_id, 'primary'
  FROM documents d
  JOIN orders o
    ON o.id = d.entity_id
   AND o.organization_id = d.organization_id
  CROSS JOIN LATERAL (
    SELECT COALESCE(
      o.shipment_id,
      (SELECT sl.shipment_id
         FROM shipment_links sl
        WHERE sl.organization_id = d.organization_id
          AND sl.owner_type = 'ORDER'
          AND sl.owner_id = o.id
          AND sl.is_primary
        LIMIT 1)
    ) AS stn_id
  ) resolved
 WHERE d.entity_type = 'SHIPPING_LABEL'
   AND d.organization_id IS NOT NULL
   AND resolved.stn_id IS NOT NULL
ON CONFLICT ON CONSTRAINT ux_document_entity_links_unique DO NOTHING;

-- Step 3: normalize entity_type last (steps 1-2's WHERE clauses depend on the
-- legacy value, so this must run after both).
UPDATE documents
   SET entity_type = 'ORDER'
 WHERE entity_type = 'SHIPPING_LABEL';

COMMIT;
