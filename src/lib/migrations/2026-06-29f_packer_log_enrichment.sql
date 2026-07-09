-- ============================================================================
-- 2026-06-29f_packer_log_enrichment.sql
--
-- Shipped-table read model (CQRS projection) — Layer 1 (table only).
--
-- The dashboard "Shipped" table is served by /api/packerlogs → the ~400-line
-- query in src/lib/neon/packer-logs-week.ts. Its dominant per-row cost is a set
-- of NON-INDEXABLE LATERAL subqueries that resolve, for each PACK
-- station_activity_logs row: the product title across the ecwid / sku_catalog /
-- sku_stock catalogs (each UNNEST-ing an 8-13 element candidate array with
-- regexp_replace/UPPER per candidate), the v_sku lookup (sku_table_id / serial /
-- static_sku), the order match, and the order-tracking json_agg. These inputs
-- are effectively IMMUTABLE per PACK scan — they only change on a relink/unpair —
-- yet today they re-run on every cache-miss read.
--
-- This table precomputes exactly those stable outputs, keyed by the PACK scan
-- (station_activity_logs.id). The read query then JOINs this 1:1 by sal_id and
-- drops the heavy laterals; the genuinely VOLATILE fields (carrier/latest_status
-- from shipping_tracking_numbers, updated by the 15-min tracking-poll cron;
-- staff names; work-assignment deadlines; dock scan-out) stay LIVE joins on the
-- cheaply-rejoined orders row, so freshness is unchanged. Carrier status is
-- deliberately NOT stored here, so the tracking cron never touches this table.
--
-- Populated by src/lib/neon/packer-log-enrichment.ts:
--   • on PACK create (POST /api/packerlogs)
--   • on relink / unpair / scan-out (linkage changes)
--   • backfill: scripts/backfill-packer-log-enrichment.mjs
-- The read path COALESCEs to live fallbacks, so a not-yet-computed row degrades
-- gracefully (shows the order's own title) rather than going blank.
--
-- TENANT-FROM-BIRTH: organization_id NOT NULL with the GUC default; the writer
-- stamps it explicitly from the source sal row (defense-in-depth).
--
-- ⚠ RLS ARMED, NOT FORCED — mirrors receiving_line_* (2026-06-29c). The reader
-- (packer-logs-week.ts) runs as neondb_owner (BYPASSRLS) joined only to
-- already-filtered sal rows, so RLS is inert for it; the policy is in place for
-- when the FORCE set is extended. The writer stamps org explicitly regardless.
--
-- ADDITIVE + IDEMPOTENT: pure CREATE … IF NOT EXISTS. Nothing reads this until
-- the flag PACKER_LOG_ENRICHMENT_READ is enabled; nothing writes it until the
-- enrichment helpers land. No change to station_activity_logs / packer_logs.
--
-- ROLLBACK:  DROP TABLE IF EXISTS packer_log_enrichment;
-- VERIFY:    \d packer_log_enrichment ; INSERT under a tenant GUC stamps org.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS packer_log_enrichment (
  -- The PACK station_activity_logs row this enrichment is for (1:1).
  sal_id                  integer PRIMARY KEY REFERENCES station_activity_logs(id) ON DELETE CASCADE,
  organization_id         uuid NOT NULL
                            DEFAULT NULLIF(current_setting('app.current_org', true), '')::uuid,

  -- Resolved order match (replaces the `order_match` lateral). The read query
  -- LEFT JOINs orders ON orders.id = order_row_id to keep every other o.* column
  -- (status_history, notes, condition, quantity, …) LIVE and fresh.
  order_row_id            integer,

  -- The expensive catalog title resolution: COALESCE(ecwid, sku_catalog,
  -- sku_stock) product title. Read query COALESCEs ff/o titles ABOVE this and
  -- item_number/sku BELOW it, exactly as the inline laterals did.
  external_product_title  text,

  -- v_sku lookup outputs (the `sku_lookup` lateral).
  sku_table_id            bigint,
  sku_table_serial        text,
  sku_table_static_sku    text,

  -- Order tracking aggregation (the `order_trackings` json_agg UNION lateral).
  tracking_numbers        jsonb NOT NULL DEFAULT '[]'::jsonb,
  tracking_number_rows    jsonb NOT NULL DEFAULT '[]'::jsonb,

  computed_at             timestamptz NOT NULL DEFAULT now()
);

-- Org-scoped maintenance / RLS predicate support.
CREATE INDEX IF NOT EXISTS idx_packer_log_enrichment_org
  ON packer_log_enrichment (organization_id);
-- Reverse lookup for relink recompute (find rows whose match must be recomputed).
CREATE INDEX IF NOT EXISTS idx_packer_log_enrichment_order_row
  ON packer_log_enrichment (order_row_id)
  WHERE order_row_id IS NOT NULL;

COMMENT ON TABLE packer_log_enrichment IS
  'Shipped-table read model: precomputed, slowly-changing per-PACK-scan enrichments (catalog title, v_sku lookup, order match, tracking json) keyed by station_activity_logs.id. Removes the non-indexable title/sku LATERALs from the /api/packerlogs hot path; volatile carrier status stays a live join. Writer: src/lib/neon/packer-log-enrichment.ts.';

-- ── Arm RLS (NOT forced; matches the additive receiving_line_* pattern) ──────
ALTER TABLE packer_log_enrichment ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS packer_log_enrichment_tenant_isolation ON packer_log_enrichment;
CREATE POLICY packer_log_enrichment_tenant_isolation ON packer_log_enrichment
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

COMMIT;
