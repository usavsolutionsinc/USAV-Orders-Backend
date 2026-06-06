-- ============================================================================
-- 2026-06-06: pending_skus — the "create in Zoho" to-do queue (P3 §7)
-- ============================================================================
-- Problem: an operational SKU (sku_stock / orders / receiving / scan) often
-- can't resolve to sku_catalog because the product hasn't been created in Zoho
-- yet (Zoho is the SoT). We need (1) a durable, deduped, prioritized "needs to
-- be created in Zoho" list, (2) an FK that is NULL while pending and is
-- auto-stamped the moment the Zoho SKU lands in sku_catalog, and (3) an
-- explicit unmatched state.
--
-- Design (mirrors orders_exceptions): one row per unmatched normalized SKU.
-- `sku_catalog_id` stays NULL until resolution. An AFTER INSERT trigger on
-- sku_catalog stamps the FK + flips status to CREATED automatically. The queue
-- key (normalized_sku) and the trigger comparison BOTH go through the same
-- fn_normalize_sku() so they can never drift.
-- ============================================================================

BEGIN;

-- ─── Shared normalizer ─────────────────────────────────────────────────────
-- trim + upper, and left-pad a purely-leading numeric base to 5 digits so the
-- known padding variants collapse (1103 / 01103, 145 / 00145). Suffixes are
-- preserved (01103-1 stays 01103-1). IMMUTABLE so it can be indexed/used in
-- the trigger. Keep this the single definition of "canonical SKU form".
CREATE OR REPLACE FUNCTION fn_normalize_sku(raw text) RETURNS text AS $$
DECLARE s text; base text; rest text;
BEGIN
  s := upper(btrim(coalesce(raw, '')));
  IF s = '' THEN RETURN NULL; END IF;
  base := substring(s from '^[0-9]+');
  IF base IS NOT NULL THEN
    rest := substring(s from '^[0-9]+(.*)$');
    IF length(base) < 5 THEN base := lpad(base, 5, '0'); END IF;
    RETURN base || coalesce(rest, '');
  END IF;
  RETURN s;
END $$ LANGUAGE plpgsql IMMUTABLE;

-- ─── The queue ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pending_skus (
  id              serial PRIMARY KEY,
  normalized_sku  text NOT NULL UNIQUE,                 -- fn_normalize_sku(raw); dedup key
  raw_sku         text NOT NULL,                        -- first raw form seen
  status          text NOT NULL DEFAULT 'PENDING',      -- PENDING|CREATED|IGNORED|DUPLICATE
  occurrences     integer NOT NULL DEFAULT 1,           -- how often it's blocking work (priority)
  first_source    text,                                 -- 'sku_stock'|'orders'|'receiving'|'scan'
  suggested_title text,                                 -- best-guess to seed the Zoho item
  sku_catalog_id  integer REFERENCES sku_catalog(id) ON DELETE SET NULL,  -- NULL until created
  resolved_at     timestamptz,
  assigned_to     integer REFERENCES staff(id) ON DELETE SET NULL,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pending_skus_status_chk CHECK (status IN ('PENDING','CREATED','IGNORED','DUPLICATE'))
);

CREATE INDEX IF NOT EXISTS idx_pending_skus_open
  ON pending_skus (occurrences DESC) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_pending_skus_catalog
  ON pending_skus (sku_catalog_id) WHERE sku_catalog_id IS NOT NULL;

COMMENT ON TABLE pending_skus IS
  'To-do queue of SKUs seen in operations but not yet in sku_catalog (need creating in Zoho). sku_catalog_id is auto-stamped by trg_resolve_pending_sku when the matching catalog row is created.';

-- ─── Auto-resolve on catalog creation ──────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_resolve_pending_sku() RETURNS trigger AS $$
BEGIN
  UPDATE pending_skus
     SET sku_catalog_id = NEW.id,
         status         = 'CREATED',
         resolved_at    = now(),
         updated_at     = now()
   WHERE status = 'PENDING'
     AND normalized_sku = fn_normalize_sku(NEW.sku);
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_resolve_pending_sku ON sku_catalog;
CREATE TRIGGER trg_resolve_pending_sku
  AFTER INSERT ON sku_catalog
  FOR EACH ROW EXECUTE FUNCTION fn_resolve_pending_sku();

COMMIT;
