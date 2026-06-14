-- ============================================================================
-- 2026-06-13: Standing (saved) sourcing searches
-- ============================================================================
-- Sourcing Hub plan §4.3. A saved query the scour watcher re-runs on a cadence —
-- "watch this product across channels". Each due row triggers one scour (one
-- call per enabled adapter), saving below-threshold hits to the watchlist.
--
-- Distinct from the per-SKU replenish watcher (2026-06-06j), which is keyed on
-- replenish alerts + replenish_target_cents; this is a general, user-defined
-- saved search.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS sourcing_searches (
  id                serial PRIMARY KEY,
  sku_id            integer REFERENCES sku_catalog(id) ON DELETE SET NULL,
  sourcing_alert_id integer REFERENCES sourcing_alerts(id) ON DELETE SET NULL,
  label             text,
  query             text NOT NULL,
  sources           text[],                                 -- adapter ids; NULL/empty = all enabled
  conditions        text[],                                 -- condition filter (new|refurbished|used|for_parts)
  max_price_cents   integer,
  cadence           text NOT NULL DEFAULT 'off',            -- off|daily|weekly
  is_active         boolean NOT NULL DEFAULT true,
  last_run_at       timestamptz,
  last_hit_count    integer,
  created_by        integer REFERENCES staff(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sourcing_searches_cadence_chk CHECK (cadence IN ('off','daily','weekly')),
  CONSTRAINT sourcing_searches_query_chk   CHECK (length(btrim(query)) > 0)
);

-- The watcher's due-set: active, scheduled rows ordered by oldest run.
CREATE INDEX IF NOT EXISTS idx_sourcing_searches_due
  ON sourcing_searches (last_run_at NULLS FIRST)
  WHERE is_active = true AND cadence <> 'off';

CREATE INDEX IF NOT EXISTS idx_sourcing_searches_sku
  ON sourcing_searches (sku_id) WHERE sku_id IS NOT NULL;

COMMENT ON TABLE sourcing_searches IS
  'Standing/saved sourcing searches re-run by the scour watcher on a cadence (Sourcing Hub §4.3).';

COMMIT;
