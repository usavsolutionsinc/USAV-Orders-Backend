-- ============================================================================
-- S4 verification — STN consolidation (receiving-triage Phase 6, §6.3)
-- ============================================================================
-- Read-only. Run in prod (or a prod clone) AFTER:
--   1) migrations 2026-06-08_inbound_handling_unit.sql + 2026-06-08_stn_consolidation.sql
--   2) backfills backfill-inbound-handling-unit.sql + backfill-receiving-scans-shipment-id.sql
--   3) RECEIVING_UNIFIED_INBOUND on (dual-write live)
--   4) at least one full incoming-sync + carrier-poll cycle has elapsed
--
-- This proves two things before the irreversible steps:
--   • S5 (read cutover off last-8 matching) won't change which rows show.
--   • S6 (dropping the legacy TEXT columns) loses no recoverable data.
--
-- Each query prints a PASS criterion. Treat a fail as "do NOT advance"; the
-- residual must be explainable as a genuine scan-before-STN / non-carrier case,
-- never a backfill/dual-write miss. Nothing here mutates data.
-- ============================================================================

\echo '== Q1: receiving_scans.shipment_id coverage =='
-- PASS: linked_pct is high and stable across runs; unlinked are explained by Q2.
SELECT
  count(*)                                                                          AS total_scans,
  count(*) FILTER (WHERE shipment_id IS NOT NULL)                                   AS linked,
  count(*) FILTER (WHERE shipment_id IS NULL)                                       AS unlinked,
  round(100.0 * count(*) FILTER (WHERE shipment_id IS NOT NULL)
        / NULLIF(count(*), 0), 1)                                                   AS linked_pct
FROM receiving_scans;

\echo '== Q2: unlinked scans that SHOULD have linked (dual-write/backfill misses) =='
-- A scan with no shipment_id whose tracking# DOES match an existing STN row is a
-- miss, not a genuine scan-before-STN. PASS: misses = 0 (or a tiny, explained
-- residual). If > 0, re-run the backfill and investigate dual-write before S5.
SELECT count(*) AS unlinked_but_stn_exists
FROM receiving_scans rs
WHERE rs.shipment_id IS NULL
  AND COALESCE(rs.tracking_number, '') <> ''
  AND EXISTS (
    SELECT 1 FROM shipping_tracking_numbers stn
     WHERE right(stn.tracking_number_normalized, 8)
         = right(regexp_replace(upper(rs.tracking_number), '[^A-Z0-9]', '', 'g'), 8)
  );

\echo '== Q2b: classify the genuinely-unlinked (sanity on the residual) =='
-- The acceptable NULLs: SKU-format/blank tracking, or sub-8-char, or no STN.
SELECT
  count(*) FILTER (WHERE COALESCE(tracking_number,'') = '')                         AS blank_tracking,
  count(*) FILTER (WHERE tracking_number LIKE '%:%')                                AS sku_format,
  count(*) FILTER (WHERE length(regexp_replace(upper(COALESCE(tracking_number,'')),
                                               '[^A-Z0-9]','','g')) < 8)            AS sub_8_char
FROM receiving_scans
WHERE shipment_id IS NULL;

\echo '== Q3: delivered-unscanned PO resolution — unified vs legacy =='
-- For the SAME shipment-anchored delivered-unscanned set, does resolving the PO
-- via receiving_lines.shipment_id agree with the legacy (receiving row / ref#)
-- path? regressions = a shipment the legacy path resolved but unified did NOT
-- (must be 0). improvements = unified resolved one legacy missed (expected > 0,
-- that's the whole point — blank SKU/order# rows now resolve).
WITH du AS (
  SELECT stn.id AS shipment_id, stn.tracking_number_normalized AS tn
    FROM shipping_tracking_numbers stn
   WHERE stn.is_delivered = true
     AND stn.delivered_at > NOW() - interval '30 days'
     AND NOT EXISTS (
       SELECT 1 FROM receiving r2
        JOIN receiving_scans rs ON rs.receiving_id = r2.id
       WHERE r2.shipment_id = stn.id
     )
), resolved AS (
  SELECT du.shipment_id,
         -- legacy: linked receiving row, else tracking#→reference# match
         COALESCE(
           (SELECT r.zoho_purchaseorder_id FROM receiving r
             WHERE r.shipment_id = du.shipment_id AND r.zoho_purchaseorder_id IS NOT NULL
             ORDER BY r.id LIMIT 1),
           (SELECT m.zoho_purchaseorder_id FROM zoho_po_mirror m
             WHERE COALESCE(m.reference_number,'') <> ''
               AND regexp_replace(upper(m.reference_number),'[^A-Z0-9]','','g') = du.tn
             LIMIT 1)
         ) AS legacy_po,
         -- unified: direct via receiving_lines.shipment_id
         (SELECT rl.zoho_purchaseorder_id FROM receiving_lines rl
           WHERE rl.shipment_id = du.shipment_id AND rl.zoho_purchaseorder_id IS NOT NULL
           ORDER BY rl.id LIMIT 1) AS unified_po
    FROM du
)
SELECT
  count(*)                                                                          AS delivered_unscanned,
  count(*) FILTER (WHERE legacy_po IS NOT NULL AND unified_po IS NULL)              AS regressions,
  count(*) FILTER (WHERE legacy_po IS NULL AND unified_po IS NOT NULL)              AS improvements,
  count(*) FILTER (WHERE legacy_po IS NOT NULL AND unified_po IS NOT NULL
                        AND legacy_po <> unified_po)                                AS conflicts
FROM resolved;

\echo '== Q4: Phase-3 line/carton shipment_id coverage (feeds Q3) =='
-- PASS: linked_lines_pct on lines that HAVE a received carton is high. Lines on
-- not-yet-scanned incoming POs legitimately have shipment_id NULL.
SELECT
  count(*)                                                                          AS lines_with_receiving,
  count(*) FILTER (WHERE rl.shipment_id IS NOT NULL)                                AS linked_lines,
  round(100.0 * count(*) FILTER (WHERE rl.shipment_id IS NOT NULL)
        / NULLIF(count(*),0), 1)                                                    AS linked_lines_pct
FROM receiving_lines rl
JOIN receiving r ON r.id = rl.receiving_id
WHERE r.shipment_id IS NOT NULL;

\echo '== Q5: S6 drop-safety — tracking recoverable from shipment_id→STN =='
-- Before dropping receiving_scans.tracking_number, every non-blank tracking must
-- be reconstructable from its shipment_id. PASS: tracking_only_on_scan = only the
-- genuine unlinked residual from Q2b (blank/sku/sub-8/no-STN). Anything else
-- means dropping the column would lose data — do NOT run S6.
SELECT count(*) AS tracking_only_on_scan
FROM receiving_scans rs
WHERE COALESCE(rs.tracking_number, '') <> ''
  AND rs.tracking_number NOT LIKE '%:%'
  AND length(regexp_replace(upper(rs.tracking_number),'[^A-Z0-9]','','g')) >= 8
  AND (
    rs.shipment_id IS NULL
    OR NOT EXISTS (SELECT 1 FROM shipping_tracking_numbers stn WHERE stn.id = rs.shipment_id)
  );

\echo '== Q5b: S6 drop-safety — receiving.receiving_tracking_number recoverable =='
-- Same gate for the carton-level legacy TEXT column.
SELECT count(*) AS carton_tracking_only_on_receiving
FROM receiving r
WHERE COALESCE(r.receiving_tracking_number, '') <> ''
  AND r.receiving_tracking_number NOT LIKE '%:%'
  AND length(regexp_replace(upper(r.receiving_tracking_number),'[^A-Z0-9]','','g')) >= 8
  AND (
    r.shipment_id IS NULL
    OR NOT EXISTS (SELECT 1 FROM shipping_tracking_numbers stn WHERE stn.id = r.shipment_id)
  );

-- ============================================================================
-- Advance criteria:
--   S5 (read cutover):  Q2 misses ≈ 0  AND  Q3 regressions = 0, conflicts = 0.
--   S6 (drop columns):  Q5 + Q5b each ≈ the explained Q2b residual, stable across
--                       two runs ≥1 full sync cycle apart.
-- ============================================================================
