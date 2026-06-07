-- ============================================================================
-- 2026-06-06: sourcing alerts + candidates + acquisitions ledger (P0)
-- ============================================================================
-- The sourcing workflow tables:
--   sourcing_alerts      — the auto-flag queue (EOL / discontinued / low stock /
--                          demand-with-no-stock). Upserted by runSourcingScanJob.
--   sourcing_candidates  — normalized secondary-market (eBay Browse) hits a user
--                          captured against a SKU/model/alert.
--   part_acquisitions    — cost + condition ledger bridging a candidate to the
--                          receiving/serial_units pipeline on import.
-- See docs/bose-parts-sourcing-engine-plan.md §3.6–3.8.
-- ============================================================================

BEGIN;

-- ─── Auto-flag queue ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sourcing_alerts (
  id              serial PRIMARY KEY,
  sku_id          integer NOT NULL REFERENCES sku_catalog(id) ON DELETE CASCADE,
  bose_model_id   integer REFERENCES bose_models(id) ON DELETE SET NULL,
  alert_type      text NOT NULL,                       -- eol|discontinued|low_stock|demand_no_stock
  severity        text NOT NULL DEFAULT 'warn',        -- info|warn|critical
  status          text NOT NULL DEFAULT 'open',        -- open|sourcing|resolved|dismissed
  reason          text,
  opened_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz,
  resolved_by     integer REFERENCES staff(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sourcing_alerts_type_chk CHECK (alert_type IN ('eol','discontinued','low_stock','demand_no_stock')),
  CONSTRAINT sourcing_alerts_sev_chk  CHECK (severity IN ('info','warn','critical')),
  CONSTRAINT sourcing_alerts_status_chk CHECK (status IN ('open','sourcing','resolved','dismissed'))
);

-- Idempotent upsert target for the scan job: at most one *live* alert per
-- (sku, type). Resolved/dismissed rows stay as history and don't block re-open.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_sourcing_alert_live
  ON sourcing_alerts (sku_id, alert_type)
  WHERE status IN ('open','sourcing');

CREATE INDEX IF NOT EXISTS idx_sourcing_alerts_open
  ON sourcing_alerts (severity, opened_at DESC) WHERE status IN ('open','sourcing');

COMMENT ON TABLE sourcing_alerts IS
  'Auto-flag queue for EOL/discontinued/low-stock/no-stock SKUs. Upserted idempotently by runSourcingScanJob.';

-- ─── Secondary-market candidates ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sourcing_candidates (
  id                 serial PRIMARY KEY,
  sku_id             integer REFERENCES sku_catalog(id) ON DELETE SET NULL,
  bose_model_id      integer REFERENCES bose_models(id) ON DELETE SET NULL,
  sourcing_alert_id  integer REFERENCES sourcing_alerts(id) ON DELETE SET NULL,
  supplier_id        integer REFERENCES suppliers(id) ON DELETE SET NULL,
  source             text NOT NULL DEFAULT 'ebay',     -- ebay|manual
  external_id        text,                             -- eBay item id
  title              text NOT NULL,
  url                text,
  image_url          text,
  condition          text,                             -- new|refurbished|used|for_parts
  price_cents        integer,
  shipping_cents     integer,
  currency           text NOT NULL DEFAULT 'USD',
  seller_name        text,
  status             text NOT NULL DEFAULT 'candidate', -- candidate|watching|ordered|imported|rejected
  raw                jsonb,                            -- full normalized eBay payload
  captured_at        timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sourcing_candidates_source_chk    CHECK (source IN ('ebay','manual')),
  CONSTRAINT sourcing_candidates_condition_chk CHECK (condition IS NULL OR condition IN ('new','refurbished','used','for_parts')),
  CONSTRAINT sourcing_candidates_status_chk    CHECK (status IN ('candidate','watching','ordered','imported','rejected'))
);

-- Dedupe re-searches: one row per external listing. Manual candidates have a
-- NULL external_id and are never deduped by this index.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_sourcing_candidate_external
  ON sourcing_candidates (source, external_id) WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sourcing_candidates_sku   ON sourcing_candidates (sku_id);
CREATE INDEX IF NOT EXISTS idx_sourcing_candidates_alert ON sourcing_candidates (sourcing_alert_id);
CREATE INDEX IF NOT EXISTS idx_sourcing_candidates_watch
  ON sourcing_candidates (updated_at DESC) WHERE status IN ('watching','ordered');

COMMENT ON TABLE sourcing_candidates IS
  'Normalized secondary-market (eBay Browse) listings captured against a SKU/model/alert; the watchlist + import source.';

-- ─── Acquisition cost/condition ledger ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS part_acquisitions (
  id                    serial PRIMARY KEY,
  sourcing_candidate_id integer REFERENCES sourcing_candidates(id) ON DELETE SET NULL,
  supplier_id           integer REFERENCES suppliers(id) ON DELETE SET NULL,
  sku_id                integer NOT NULL REFERENCES sku_catalog(id) ON DELETE CASCADE,
  receiving_id          integer REFERENCES receiving(id) ON DELETE SET NULL,
  serial_unit_id        integer REFERENCES serial_units(id) ON DELETE SET NULL,
  acquisition_cost_cents integer,
  shipping_cost_cents   integer,
  condition             text,                          -- new|refurbished|used|for_parts
  status                text NOT NULL DEFAULT 'ordered', -- ordered|received|imported|returned
  ordered_at            timestamptz NOT NULL DEFAULT now(),
  received_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT part_acquisitions_condition_chk CHECK (condition IS NULL OR condition IN ('new','refurbished','used','for_parts')),
  CONSTRAINT part_acquisitions_status_chk    CHECK (status IN ('ordered','received','imported','returned'))
);

CREATE INDEX IF NOT EXISTS idx_part_acquisitions_sku        ON part_acquisitions (sku_id);
CREATE INDEX IF NOT EXISTS idx_part_acquisitions_receiving  ON part_acquisitions (receiving_id) WHERE receiving_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_part_acquisitions_candidate  ON part_acquisitions (sourcing_candidate_id) WHERE sourcing_candidate_id IS NOT NULL;

COMMENT ON TABLE part_acquisitions IS
  'Cost + condition ledger linking a sourcing candidate to the receiving/serial_units pipeline on import; feeds margin.';

COMMIT;
