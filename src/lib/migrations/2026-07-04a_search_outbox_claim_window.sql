-- ============================================================================
-- 2026-07-04a: entity_search_outbox claim window + line-table enqueue triggers
-- ============================================================================
-- Fixes from the adversarial review of AI-search Phase 0-3 (all EXPLAIN/
-- code-trace confirmed; see docs/ai-search-modernization-plan.md):
--
-- 1. BLOCKER — claim→mark dedupe race: a parent write that lands while its
--    outbox row is CLAIMED (drained but not yet marked processed) hit the
--    pending partial unique via ON CONFLICT ... DO NOTHING and was silently
--    dropped; markProcessed then stamped the PRE-update snapshot, leaving the
--    doc stale until some unrelated future write. Fix: a `claimed_at` column
--    closes the window — the pending-dedupe unique now covers only UNCLAIMED
--    pending rows, so a write during a drain inserts a FRESH pending row that
--    the next drain picks up. The worker stamps claimed_at at claim, releases
--    it on failure, and resets stale claims (crashed drains) after 15 min.
--
-- 2. Line-table freshness: buildSearchText aggregates receiving_lines
--    (item_name, sku) and fba_shipment_items (product_title/sku/fnsku/asin)
--    into the header docs, but only the six header tables had enqueue
--    triggers — a carton/shipment created BEFORE its lines was indexed with
--    blank line text and never healed. Dedicated line triggers re-enqueue the
--    HEADER entity on line INSERT/DELETE/UPDATE-of-searchable-columns.
--    fba_shipment_items has no organization_id column — org resolves from the
--    parent fba_shipments row (single PK lookup inside the trigger).
--
-- 3. repair_service UPDATE trigger was missing source_system (the builder
--    maps it to the source_platform facet) — recreated with it.
--
-- Idempotent (guarded ALTER, DROP IF EXISTS + CREATE, CREATE OR REPLACE);
-- safe against the already-applied 2026-07-03d state.
--
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS trg_enqueue_search_outbox_on_receiving_lines* /
--     ..._fba_shipment_items* ; DROP FUNCTION IF EXISTS
--     fn_enqueue_search_outbox_receiving_line(), fn_enqueue_search_outbox_fba_item();
--   recreate ux_entity_search_outbox_pending WHERE processed_at IS NULL only;
--   ALTER TABLE entity_search_outbox DROP COLUMN claimed_at;
--   re-run 2026-07-03d's CREATE OR REPLACE fn_enqueue_entity_search_outbox.
-- ============================================================================

BEGIN;

-- ── 1a. Claim-window column ─────────────────────────────────────────────────
ALTER TABLE entity_search_outbox ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

-- ── 1b. Pending-dedupe unique now excludes claimed rows ─────────────────────
-- (Every ON CONFLICT enqueue site — trigger fn below, backfill script, retry
-- sweep — targets this predicate; keep them in sync.)
DROP INDEX IF EXISTS ux_entity_search_outbox_pending;
CREATE UNIQUE INDEX IF NOT EXISTS ux_entity_search_outbox_pending
  ON entity_search_outbox (organization_id, entity_type, entity_id)
  WHERE processed_at IS NULL AND claimed_at IS NULL;

DROP INDEX IF EXISTS idx_entity_search_outbox_pending;
CREATE INDEX IF NOT EXISTS idx_entity_search_outbox_pending
  ON entity_search_outbox (id)
  WHERE processed_at IS NULL AND claimed_at IS NULL;

-- ── 1c. Header enqueue fn: ON CONFLICT matches the new predicate ────────────
CREATE OR REPLACE FUNCTION fn_enqueue_entity_search_outbox()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS NULL THEN
    RETURN NEW;  -- legacy/global rows have no tenant to index under
  END IF;
  INSERT INTO entity_search_outbox (organization_id, entity_type, entity_id)
  VALUES (NEW.organization_id, TG_ARGV[0], NEW.id)
  ON CONFLICT (organization_id, entity_type, entity_id)
  WHERE processed_at IS NULL AND claimed_at IS NULL
  DO NOTHING;
  RETURN NEW;
END;
$$;

-- ── 2a. receiving_lines → re-enqueue the parent RECEIVING doc ───────────────
CREATE OR REPLACE FUNCTION fn_enqueue_search_outbox_receiving_line()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  rid BIGINT;
  org UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    rid := OLD.receiving_id; org := OLD.organization_id;
  ELSE
    rid := NEW.receiving_id; org := NEW.organization_id;
  END IF;
  IF rid IS NULL OR org IS NULL THEN
    RETURN NULL;  -- AFTER trigger: return value is ignored
  END IF;
  INSERT INTO entity_search_outbox (organization_id, entity_type, entity_id)
  VALUES (org, 'RECEIVING', rid)
  ON CONFLICT (organization_id, entity_type, entity_id)
  WHERE processed_at IS NULL AND claimed_at IS NULL
  DO NOTHING;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_enqueue_search_outbox_on_receiving_lines_ins ON receiving_lines;
CREATE TRIGGER trg_enqueue_search_outbox_on_receiving_lines_ins
  AFTER INSERT OR DELETE ON receiving_lines
  FOR EACH ROW EXECUTE FUNCTION fn_enqueue_search_outbox_receiving_line();

DROP TRIGGER IF EXISTS trg_enqueue_search_outbox_on_receiving_lines_upd ON receiving_lines;
CREATE TRIGGER trg_enqueue_search_outbox_on_receiving_lines_upd
  AFTER UPDATE OF item_name, sku, receiving_id ON receiving_lines
  FOR EACH ROW
  WHEN (OLD.item_name    IS DISTINCT FROM NEW.item_name
     OR OLD.sku          IS DISTINCT FROM NEW.sku
     OR OLD.receiving_id IS DISTINCT FROM NEW.receiving_id)
  EXECUTE FUNCTION fn_enqueue_search_outbox_receiving_line();

-- ── 2b. fba_shipment_items → re-enqueue the parent FBA_SHIPMENT doc ─────────
-- No organization_id on the line table; resolve from the parent shipment.
CREATE OR REPLACE FUNCTION fn_enqueue_search_outbox_fba_item()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  sid BIGINT;
  parent_org UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    sid := OLD.shipment_id;
  ELSE
    sid := NEW.shipment_id;
  END IF;
  IF sid IS NULL THEN
    RETURN NULL;  -- AFTER trigger: return value is ignored
  END IF;
  SELECT organization_id INTO parent_org FROM fba_shipments WHERE id = sid;
  IF parent_org IS NULL THEN
    RETURN NULL;
  END IF;
  INSERT INTO entity_search_outbox (organization_id, entity_type, entity_id)
  VALUES (parent_org, 'FBA_SHIPMENT', sid)
  ON CONFLICT (organization_id, entity_type, entity_id)
  WHERE processed_at IS NULL AND claimed_at IS NULL
  DO NOTHING;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_enqueue_search_outbox_on_fba_shipment_items_ins ON fba_shipment_items;
CREATE TRIGGER trg_enqueue_search_outbox_on_fba_shipment_items_ins
  AFTER INSERT OR DELETE ON fba_shipment_items
  FOR EACH ROW EXECUTE FUNCTION fn_enqueue_search_outbox_fba_item();

DROP TRIGGER IF EXISTS trg_enqueue_search_outbox_on_fba_shipment_items_upd ON fba_shipment_items;
CREATE TRIGGER trg_enqueue_search_outbox_on_fba_shipment_items_upd
  AFTER UPDATE OF product_title, sku, fnsku, asin, shipment_id ON fba_shipment_items
  FOR EACH ROW
  WHEN (OLD.product_title IS DISTINCT FROM NEW.product_title
     OR OLD.sku           IS DISTINCT FROM NEW.sku
     OR OLD.fnsku         IS DISTINCT FROM NEW.fnsku
     OR OLD.asin          IS DISTINCT FROM NEW.asin
     OR OLD.shipment_id   IS DISTINCT FROM NEW.shipment_id)
  EXECUTE FUNCTION fn_enqueue_search_outbox_fba_item();

-- ── 3. repair_service UPDATE trigger: add source_system (facet source) ──────
DROP TRIGGER IF EXISTS trg_enqueue_search_outbox_on_repair_service_upd ON repair_service;
CREATE TRIGGER trg_enqueue_search_outbox_on_repair_service_upd
  AFTER UPDATE OF ticket_number, product_title, serial_number, issue,
    notes, status, source_system, source_order_id, source_tracking_number,
    source_sku, received_at
  ON repair_service
  FOR EACH ROW
  WHEN (OLD.ticket_number   IS DISTINCT FROM NEW.ticket_number
     OR OLD.product_title   IS DISTINCT FROM NEW.product_title
     OR OLD.serial_number   IS DISTINCT FROM NEW.serial_number
     OR OLD.issue           IS DISTINCT FROM NEW.issue
     OR OLD.notes           IS DISTINCT FROM NEW.notes
     OR OLD.status          IS DISTINCT FROM NEW.status
     OR OLD.source_system   IS DISTINCT FROM NEW.source_system
     OR OLD.source_order_id IS DISTINCT FROM NEW.source_order_id
     OR OLD.source_tracking_number IS DISTINCT FROM NEW.source_tracking_number
     OR OLD.source_sku      IS DISTINCT FROM NEW.source_sku
     OR OLD.received_at     IS DISTINCT FROM NEW.received_at)
  EXECUTE FUNCTION fn_enqueue_entity_search_outbox('REPAIR');

COMMIT;
