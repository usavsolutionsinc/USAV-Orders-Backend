-- ============================================================================
-- Outbound documents — backfill verification (docs/outbound-documents-plan.md
-- Phase 0, §7.1 acceptance criteria)
-- ============================================================================
-- Read-only. Run AFTER:
--   1) 2026-07-01c_outbound_document_entity_links.sql
--   2) 2026-07-01d_backfill_shipping_label_links.sql
--
-- Nothing here mutates data. Treat Q1 < 95% or any Q3 row as "investigate
-- before Phase 1 ships" — see docs/outbound-documents-plan.md §7.3.
-- ============================================================================

\echo '== Q1: label→STN link coverage (target: >95% per §7.3) =='
SELECT
  count(*)                                                                          AS total_labels,
  count(*) FILTER (WHERE has_shipment)                                             AS with_shipment_link,
  count(*) FILTER (WHERE NOT has_shipment)                                         AS order_only,
  round(100.0 * count(*) FILTER (WHERE has_shipment) / NULLIF(count(*), 0), 1)     AS with_shipment_pct
FROM (
  SELECT d.id,
         EXISTS (
           SELECT 1 FROM document_entity_links l
            WHERE l.document_id = d.id AND l.entity_type = 'SHIPMENT'
         ) AS has_shipment
    FROM documents d
   WHERE d.document_type = 'shipping_label'
     AND d.entity_type = 'ORDER'
) labels;

\echo '== Q2: entity_type normalization — any legacy rows left un-migrated? =='
-- PASS: 0. A non-zero count means the backfill migration has not run, or new
-- rows were written with the legacy shape after the cutover (regression).
SELECT count(*) AS legacy_shipping_label_rows
FROM documents
WHERE entity_type = 'SHIPPING_LABEL';

\echo '== Q3: every migrated label has AT LEAST an ORDER link (no orphans) =='
-- PASS: 0. A miss here means a documents row survived the backfill without
-- gaining even the baseline ORDER link — data integrity bug, investigate.
SELECT d.id AS document_id, d.entity_id AS order_id
  FROM documents d
 WHERE d.document_type = 'shipping_label'
   AND d.entity_type = 'ORDER'
   AND NOT EXISTS (
     SELECT 1 FROM document_entity_links l
      WHERE l.document_id = d.id AND l.entity_type = 'ORDER'
   );

\echo '== Q4: orphan links — link rows pointing at a document that no longer exists =='
-- PASS: 0 (ON DELETE CASCADE should make this structurally impossible; sanity check).
SELECT count(*) AS orphan_links
FROM document_entity_links l
WHERE NOT EXISTS (SELECT 1 FROM documents d WHERE d.id = l.document_id);

\echo '== Q5: order-only labels — orders missing a resolvable STN (expected residual) =='
-- Informational, not a failure: these are labels whose order had neither
-- orders.shipment_id nor a primary shipment_links row at backfill time.
SELECT d.id AS document_id, d.entity_id AS order_id, o.order_id AS order_ref
  FROM documents d
  JOIN orders o ON o.id = d.entity_id
 WHERE d.document_type = 'shipping_label'
   AND d.entity_type = 'ORDER'
   AND NOT EXISTS (
     SELECT 1 FROM document_entity_links l
      WHERE l.document_id = d.id AND l.entity_type = 'SHIPMENT'
   )
 ORDER BY d.id;

-- ============================================================================
-- Advance criteria (Phase 0 → Phase 1): Q1 with_shipment_pct > 95, Q2 = 0, Q3 = 0, Q4 = 0.
-- Q5 residual is expected and informational — prompt those orders for tracking.
-- ============================================================================
