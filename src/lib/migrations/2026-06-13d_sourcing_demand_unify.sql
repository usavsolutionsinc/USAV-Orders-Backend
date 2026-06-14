-- ============================================================================
-- 2026-06-13: Unify demand — widen sourcing_alerts into a universal demand queue
-- ============================================================================
-- Sourcing Hub plan (docs/sourcing-hub-integration-plan.md §3.1). The existing
-- alert/candidate/acquisition spine is already brand-agnostic; this widens the
-- queue so EVERY "we need to buy/find this" signal can live in it — including
-- free-text targets with no catalog SKU yet (genuinely new/different products).
--
-- Purely additive: new columns are nullable or defaulted; existing rows keep
-- working (demand_source backfills to 'scan', replenish rows to 'replenish').
-- ============================================================================

BEGIN;

-- ─── Demand metadata ────────────────────────────────────────────────────────
ALTER TABLE sourcing_alerts
  ADD COLUMN IF NOT EXISTS demand_source   text NOT NULL DEFAULT 'scan',
  ADD COLUMN IF NOT EXISTS demand_ref_type text,            -- order|repair|warranty_claim|pending_sku|fba_shipment|...
  ADD COLUMN IF NOT EXISTS demand_ref_id   integer,         -- originating row id (back-link)
  ADD COLUMN IF NOT EXISTS target_qty      integer,         -- how many we need (default 1 in app)
  ADD COLUMN IF NOT EXISTS search_query    text;            -- free-text scour target when no SKU resolves

-- A queue row no longer requires a catalog SKU — free-text / pre-catalog demand.
ALTER TABLE sourcing_alerts ALTER COLUMN sku_id DROP NOT NULL;

-- ─── Vocab: demand_source ───────────────────────────────────────────────────
ALTER TABLE sourcing_alerts DROP CONSTRAINT IF EXISTS sourcing_alerts_demand_src_chk;
ALTER TABLE sourcing_alerts ADD CONSTRAINT sourcing_alerts_demand_src_chk
  CHECK (demand_source IN (
    'scan','replenish','missing_part','repair','warranty','order_exception','pending_sku','fba','manual'
  ));

-- ─── Vocab: alert_type (keep existing 5, add demand-origin + manual types) ───
ALTER TABLE sourcing_alerts DROP CONSTRAINT IF EXISTS sourcing_alerts_type_chk;
ALTER TABLE sourcing_alerts ADD CONSTRAINT sourcing_alerts_type_chk
  CHECK (alert_type IN (
    'eol','discontinued','low_stock','demand_no_stock','replenish',
    'missing_part','repair_part','warranty_part','fba_replenish','manual'
  ));

-- Either a SKU or a free-text target must be present (no empty queue rows).
ALTER TABLE sourcing_alerts DROP CONSTRAINT IF EXISTS sourcing_alerts_target_chk;
ALTER TABLE sourcing_alerts ADD CONSTRAINT sourcing_alerts_target_chk
  CHECK (sku_id IS NOT NULL OR search_query IS NOT NULL);

-- ─── Idempotency for demand-origin rows ─────────────────────────────────────
-- The existing uniq_sourcing_alert_live (sku_id, alert_type) keeps one live
-- alert per (SKU, type). This second guard keeps one live alert per originating
-- row (e.g. one 'repair_part' per repair) even before the SKU is resolved.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_sourcing_alert_live_demand
  ON sourcing_alerts (demand_ref_type, demand_ref_id, alert_type)
  WHERE status IN ('open','sourcing') AND demand_ref_id IS NOT NULL;

-- ─── Backfill ───────────────────────────────────────────────────────────────
UPDATE sourcing_alerts
   SET demand_source = 'replenish'
 WHERE alert_type = 'replenish' AND demand_source = 'scan';

COMMENT ON COLUMN sourcing_alerts.demand_source IS
  'Where the demand came from: scan|replenish|missing_part|repair|warranty|order_exception|pending_sku|fba|manual.';
COMMENT ON COLUMN sourcing_alerts.search_query IS
  'Free-text scour target when no catalog SKU resolves (pre-catalog / different products).';

COMMIT;
