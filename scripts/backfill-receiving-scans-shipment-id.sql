-- ============================================================================
-- backfill-receiving-scans-shipment-id.sql
--
-- Backfill historical receiving_scans.shipment_id (the FK to
-- shipping_tracking_numbers added in 2026-06-08_stn_consolidation.sql, Phase 6).
-- That migration only ADDED the nullable column + index; the prior data backfill
-- (2026-06-20_backfill_receiving_stn_linkage.sql) populated receiving +
-- receiving_lines + the receiving_shipments junction, but NOT receiving_scans —
-- this script closes that gap so every recoverable dock-scan event links to its
-- canonical STN row by id.
--
-- This is a STANDALONE OWNER-RUN SCRIPT, NOT a migration. It contains no DDL and
-- no constraint changes — pure DATA. It is idempotent and re-run-safe: every
-- UPDATE is gated on `shipment_id IS NULL`, so a second run touches 0 rows, and
-- the trailing SELECT only reads. It mirrors the get-or-create + linking
-- semantics of src/lib/receiving/record-scan.ts (linkScanToStn /
-- registerShipmentPermissive) — except minting: like
-- 2026-06-20_backfill_receiving_stn_linkage.sql §4, NO new STN rows are minted
-- here (many legacy scan values are Zoho PO refs, not carrier tracking).
-- registerShipmentPermissive owns minting at scan time; this script only LINKS
-- scans to STN rows that already exist.
--
-- ── RUN ORDER ───────────────────────────────────────────────────────────────
--   Run this AFTER scripts/verify-stn-consolidation.sql is green (it proves the
--   receiving.shipment_id spine is populated, which Pass 1 inherits from).
--   verify-stn-consolidation.sql's own header names this script as a required
--   step (S4 §6.3) before S5 (read cutover) and S6.
--
-- ── DO NOT DROP tracking_number / carrier ───────────────────────────────────
--   The legacy receiving_scans.tracking_number + carrier TEXT columns are read
--   by Pass 2 below and stay in place. Dropping them is the SEPARATE, DEFERRED
--   S6 step (a later migration, after read cutover bakes) — never here.
-- ============================================================================

BEGIN;

-- ── Pass 1: inherit the parent carton's STN ─────────────────────────────────
-- The receiving row already carries the canonical shipment_id (populated by
-- 2026-06-20_backfill_receiving_stn_linkage.sql and back-stamped live by
-- linkScanToStn's `UPDATE receiving SET shipment_id = ...`). A scan inherits its
-- carton's tracking by definition, so this is the high-confidence majority path.
UPDATE receiving_scans rs
   SET shipment_id = r.shipment_id
  FROM receiving r
 WHERE rs.receiving_id = r.id
   AND rs.shipment_id IS NULL
   AND r.shipment_id IS NOT NULL;

-- ── Pass 2: link remaining scans by their own tracking_number ───────────────
-- For scans whose parent carton has no shipment_id (e.g. a loose / unmatched
-- scan, or a carton received before its STN existed), recover the link from the
-- scan's own denormalized tracking_number against an EXISTING STN row by
-- normalized match. Normalization mirrors 2026-06-20_backfill_receiving_stn_
-- linkage.sql §4 exactly (strip non-alphanumerics, upper-case; NULLIF so an
-- all-symbol/blank tracking can never falsely match an empty normalized value).
-- shipping_tracking_numbers.tracking_number_normalized is globally UNIQUE, so a
-- match resolves to exactly one STN row. No STN rows are minted (see header).
UPDATE receiving_scans rs
   SET shipment_id = stn.id
  FROM shipping_tracking_numbers stn
 WHERE rs.shipment_id IS NULL
   AND rs.tracking_number IS NOT NULL
   AND btrim(rs.tracking_number) <> ''
   AND stn.tracking_number_normalized =
       NULLIF(upper(regexp_replace(rs.tracking_number, '[^A-Za-z0-9]', '', 'g')), '');

COMMIT;

-- ── Verification: how many scans remain unlinked ────────────────────────────
-- An acceptable residual is a genuine scan-before-STN or a non-carrier code
-- (SKU-format / Zoho PO ref) with no minted STN row — exactly the NULLABLE case
-- 2026-06-08_stn_consolidation.sql documents. A LARGE residual whose
-- tracking_number DOES match an existing STN is a miss — re-check Pass 2.
-- (scripts/verify-stn-consolidation.sql Q2 classifies the residual in detail.)
SELECT
  count(*)                                          AS total_scans,
  count(*) FILTER (WHERE shipment_id IS NOT NULL)   AS linked,
  count(*) FILTER (WHERE shipment_id IS NULL)       AS still_null
FROM receiving_scans;
