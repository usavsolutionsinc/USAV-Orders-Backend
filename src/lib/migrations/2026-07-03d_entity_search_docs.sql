-- ============================================================================
-- 2026-07-03d: entity_search_docs + entity_search_outbox — AI search Phase 0
-- ============================================================================
-- docs/ai-search-modernization-plan.md (Locked Decisions 2026-07-03) — the
-- single hybrid (keyword + pgvector) index for the 5 P0 CommandBar entity
-- groups, plus the trigger→outbox→worker freshness pipeline. Follows
-- .claude/rules/polymorphic-tables.md EXACTLY:
--   • entity_type TEXT with a NAMED CHECK (no pg ENUM — the set will grow),
--     values matching the house discriminator vocabulary
--     (photo_entity_links / work_assignments): ORDER, SERIAL_UNIT, RECEIVING,
--     SKU, REPAIR, FBA_SHIPMENT.
--   • entity_id BIGINT (all 6 parents are integer-keyed today; BIGINT so no
--     future widening).
--   • org-led unique index (organization_id, entity_type, entity_id).
--   • parent-delete integrity: one trigger per parent sharing a generic
--     TG_ARGV[0]-dispatch function, wired for EVERY discriminator value in
--     THIS migration (the work_assignments lesson — no silent gaps).
--   • tenant-from-birth via enforce_tenant_isolation() below (loud-fail GUC
--     default + FORCE RLS + canonical policy). Safe: both tables are written
--     ONLY by (a) triggers firing inside parent writes — every parent is
--     itself FORCE-RLS'd, so a successful parent write implies the GUC (or a
--     BYPASSRLS role, which bypasses here too; same posture as the
--     2026-07-03a serial_unit_provenance dual-write trigger) — and (b) the
--     outbox worker / backfill, which run org-scoped via withTenantTransaction.
--   • Drizzle models land in src/lib/drizzle/schema.ts in the same change.
--   • Parent-existence validation is app-side (the worker loads the parent
--     row org-scoped before upserting a doc) — per contract point 6, no
--     existence trigger.
--
-- FRESHNESS (locked decision 5): AFTER INSERT OR UPDATE-OF-searchable-columns
-- triggers on the 6 parent tables enqueue (org, entity_type, entity_id) into
-- entity_search_outbox, deduped on the pending partial unique. The async
-- worker (src/lib/search/search-outbox-worker.ts, cron route
-- /api/cron/search-outbox) builds search_text + embeds. Domain helpers are
-- NEVER edited to call upsertSearchDoc — the trigger can't be forgotten at a
-- new write site. The UPDATE OF column lists mirror the fields
-- src/lib/search/build-search-text.ts reads — keep the two in sync.
--
-- KNOWN GAP (deliberate, documented): order serials/tracking live on join
-- tables (tech_serial_numbers, shipping_tracking_numbers — the latter has no
-- organization_id column yet). Changes there alone do not re-enqueue the
-- order; they surface on the next orders write or a backfill sweep. Adding
-- join-table triggers is a later phase, not silently skipped.
--
-- embedding vector(768) is NULLABLE by design — keyword search works the
-- moment the worker upserts search_text; the embed fills in asynchronously
-- (and retries when the provider is down). 768 dims per locked decision 3
-- (openai/text-embedding-3-small @ 768 prod / nomic-embed-text dev) — this is
-- NOT the 1536-dim RAG scheme; rag_document_chunks is untouched.
--
-- ROLLBACK:
--   DROP TRIGGER per trg_enqueue_search_outbox_on_* / trg_delete_search_docs_on_*;
--   DROP FUNCTION IF EXISTS fn_enqueue_entity_search_outbox(), fn_delete_entity_search_docs_on_parent_delete();
--   DROP TABLE IF EXISTS entity_search_outbox, entity_search_docs;
--   (or SELECT relax_tenant_isolation('entity_search_docs') etc. to soften RLS only)
--
-- VERIFY (after apply):
--   UPDATE orders SET notes = notes WHERE id = <any> ;  -- enqueues 1 pending outbox row
--   SELECT * FROM entity_search_outbox WHERE processed_at IS NULL LIMIT 5;
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ─── entity_search_docs: the hybrid search index ────────────────────────────
CREATE TABLE IF NOT EXISTS entity_search_docs (
  id              BIGSERIAL PRIMARY KEY,
  organization_id UUID NOT NULL,            -- NO default; enforce_tenant_isolation() installs it
  entity_type     TEXT NOT NULL,
  entity_id       BIGINT NOT NULL,
  -- Denormalized display fields so retrieval is one-table (SearchHit maps
  -- straight off this row, no parent joins on the keystroke path).
  title           TEXT NOT NULL,
  subtitle        TEXT,
  -- Canonical denormalized text the keyword arm matches and the embedding is
  -- generated from (src/lib/search/build-search-text.ts is the builder SoT).
  search_text     TEXT NOT NULL,
  -- NULLABLE: keyword works before the worker embeds; NULL also marks retry.
  embedding       vector(768),
  embedded_at     TIMESTAMPTZ,
  -- Typed facet columns (real columns, not jsonb — they are queryable
  -- business facts used for structured filtering alongside the vector arm).
  status          TEXT,
  condition_grade TEXT,
  source_platform TEXT,
  happened_at     TIMESTAMPTZ,              -- entity-relevant date (order date, received-at, …)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE entity_search_docs ADD CONSTRAINT entity_search_docs_entity_type_chk
    CHECK (entity_type IN ('ORDER','SERIAL_UNIT','RECEIVING','SKU','REPAIR','FBA_SHIPMENT'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_entity_search_docs_natural
  ON entity_search_docs (organization_id, entity_type, entity_id);

-- Recency ranking / date-facet filtering.
CREATE INDEX IF NOT EXISTS idx_entity_search_docs_org_happened
  ON entity_search_docs (organization_id, happened_at DESC NULLS LAST);

-- Keyword arm: trigram GIN over the canonical text (same shape as the
-- existing shipped-search / sku-catalog trgm indexes). GIN can't lead with a
-- uuid column; org isolation comes from the WHERE organization_id filter +
-- FORCE RLS, per the existing trgm-index precedent.
CREATE INDEX IF NOT EXISTS idx_entity_search_docs_search_trgm
  ON entity_search_docs USING gin (lower(search_text) gin_trgm_ops);

-- Semantic arm: HNSW cosine, same operator class as rag_document_chunks.
-- NULL embeddings are simply absent from the index.
CREATE INDEX IF NOT EXISTS idx_entity_search_docs_embedding_hnsw
  ON entity_search_docs USING hnsw (embedding vector_cosine_ops);

-- ─── entity_search_outbox: freshness queue (trigger → worker) ──────────────
CREATE TABLE IF NOT EXISTS entity_search_outbox (
  id              BIGSERIAL PRIMARY KEY,
  organization_id UUID NOT NULL,            -- NO default; enforce_tenant_isolation() installs it
  entity_type     TEXT NOT NULL,
  entity_id       BIGINT NOT NULL,
  enqueued_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  processed_at    TIMESTAMPTZ
);

DO $$ BEGIN
  ALTER TABLE entity_search_outbox ADD CONSTRAINT entity_search_outbox_entity_type_chk
    CHECK (entity_type IN ('ORDER','SERIAL_UNIT','RECEIVING','SKU','REPAIR','FBA_SHIPMENT'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Dedupe: at most ONE pending row per (org, entity, id); reprocessed rows keep
-- history (processed_at set) without blocking a fresh enqueue.
CREATE UNIQUE INDEX IF NOT EXISTS ux_entity_search_outbox_pending
  ON entity_search_outbox (organization_id, entity_type, entity_id)
  WHERE processed_at IS NULL;

-- Drain scan: the worker reads pending rows in id order.
CREATE INDEX IF NOT EXISTS idx_entity_search_outbox_pending
  ON entity_search_outbox (id)
  WHERE processed_at IS NULL;

-- Retention sweep: /api/cron/cleanup prunes processed rows older than 7 days
-- (same pattern as cron_runs); this keeps that DELETE from scanning the heap.
CREATE INDEX IF NOT EXISTS idx_entity_search_outbox_processed
  ON entity_search_outbox (processed_at)
  WHERE processed_at IS NOT NULL;

-- ─── Enqueue triggers: one INSERT + one UPDATE trigger per parent ──────────
-- Generic TG_ARGV[0] dispatch. The UPDATE trigger is DOUBLE-guarded:
-- `UPDATE OF <cols>` (skip when unrelated columns are set) AND a
-- `WHEN (... IS DISTINCT FROM ...)` clause — because several sync writers
-- (eBay/Amazon order sync, Zoho receiving sync) blanket-SET the watched
-- columns with unchanged COALESCE values on every poll; UPDATE OF alone
-- would re-enqueue (and re-embed) every synced row every interval. Split
-- from the INSERT trigger since an INSERT trigger cannot reference OLD.
-- ON CONFLICT targets the pending partial unique (dedupe).
CREATE OR REPLACE FUNCTION fn_enqueue_entity_search_outbox()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS NULL THEN
    RETURN NEW;  -- legacy/global rows have no tenant to index under
  END IF;
  INSERT INTO entity_search_outbox (organization_id, entity_type, entity_id)
  VALUES (NEW.organization_id, TG_ARGV[0], NEW.id)
  ON CONFLICT (organization_id, entity_type, entity_id) WHERE processed_at IS NULL
  DO NOTHING;
  RETURN NEW;
END;
$$;

-- orders
DROP TRIGGER IF EXISTS trg_enqueue_search_outbox_on_orders ON orders;
DROP TRIGGER IF EXISTS trg_enqueue_search_outbox_on_orders_ins ON orders;
CREATE TRIGGER trg_enqueue_search_outbox_on_orders_ins
  AFTER INSERT ON orders
  FOR EACH ROW EXECUTE FUNCTION fn_enqueue_entity_search_outbox('ORDER');
DROP TRIGGER IF EXISTS trg_enqueue_search_outbox_on_orders_upd ON orders;
CREATE TRIGGER trg_enqueue_search_outbox_on_orders_upd
  AFTER UPDATE OF order_id, product_title, sku, account_source, status,
    condition, notes, shipment_id, order_date
  ON orders
  FOR EACH ROW
  WHEN (OLD.order_id       IS DISTINCT FROM NEW.order_id
     OR OLD.product_title  IS DISTINCT FROM NEW.product_title
     OR OLD.sku            IS DISTINCT FROM NEW.sku
     OR OLD.account_source IS DISTINCT FROM NEW.account_source
     OR OLD.status         IS DISTINCT FROM NEW.status
     OR OLD.condition      IS DISTINCT FROM NEW.condition
     OR OLD.notes          IS DISTINCT FROM NEW.notes
     OR OLD.shipment_id    IS DISTINCT FROM NEW.shipment_id
     OR OLD.order_date     IS DISTINCT FROM NEW.order_date)
  EXECUTE FUNCTION fn_enqueue_entity_search_outbox('ORDER');

-- serial_units
DROP TRIGGER IF EXISTS trg_enqueue_search_outbox_on_serial_units ON serial_units;
DROP TRIGGER IF EXISTS trg_enqueue_search_outbox_on_serial_units_ins ON serial_units;
CREATE TRIGGER trg_enqueue_search_outbox_on_serial_units_ins
  AFTER INSERT ON serial_units
  FOR EACH ROW EXECUTE FUNCTION fn_enqueue_entity_search_outbox('SERIAL_UNIT');
DROP TRIGGER IF EXISTS trg_enqueue_search_outbox_on_serial_units_upd ON serial_units;
CREATE TRIGGER trg_enqueue_search_outbox_on_serial_units_upd
  AFTER UPDATE OF serial_number, normalized_serial, sku, unit_uid,
    current_status, condition_grade, current_location, notes, sku_catalog_id, received_at
  ON serial_units
  FOR EACH ROW
  WHEN (OLD.serial_number    IS DISTINCT FROM NEW.serial_number
     OR OLD.normalized_serial IS DISTINCT FROM NEW.normalized_serial
     OR OLD.sku              IS DISTINCT FROM NEW.sku
     OR OLD.unit_uid         IS DISTINCT FROM NEW.unit_uid
     OR OLD.current_status   IS DISTINCT FROM NEW.current_status
     OR OLD.condition_grade  IS DISTINCT FROM NEW.condition_grade
     OR OLD.current_location IS DISTINCT FROM NEW.current_location
     OR OLD.notes            IS DISTINCT FROM NEW.notes
     OR OLD.sku_catalog_id   IS DISTINCT FROM NEW.sku_catalog_id
     OR OLD.received_at      IS DISTINCT FROM NEW.received_at)
  EXECUTE FUNCTION fn_enqueue_entity_search_outbox('SERIAL_UNIT');

-- receiving
DROP TRIGGER IF EXISTS trg_enqueue_search_outbox_on_receiving ON receiving;
DROP TRIGGER IF EXISTS trg_enqueue_search_outbox_on_receiving_ins ON receiving;
CREATE TRIGGER trg_enqueue_search_outbox_on_receiving_ins
  AFTER INSERT ON receiving
  FOR EACH ROW EXECUTE FUNCTION fn_enqueue_entity_search_outbox('RECEIVING');
DROP TRIGGER IF EXISTS trg_enqueue_search_outbox_on_receiving_upd ON receiving;
-- NOTE: receiving.quantity exists in the Drizzle model but NOT in the live
-- DB (pre-existing drift; SQL migrations are the schema SoT) — deliberately
-- absent from this column list.
CREATE TRIGGER trg_enqueue_search_outbox_on_receiving_upd
  AFTER UPDATE OF carrier, source_platform, intake_type, exception_code,
    zoho_purchaseorder_number, lpn, support_notes, zoho_notes,
    condition_grade, qa_status, shipment_id, received_at, zendesk_ticket
  ON receiving
  FOR EACH ROW
  WHEN (OLD.carrier          IS DISTINCT FROM NEW.carrier
     OR OLD.source_platform  IS DISTINCT FROM NEW.source_platform
     OR OLD.intake_type      IS DISTINCT FROM NEW.intake_type
     OR OLD.exception_code   IS DISTINCT FROM NEW.exception_code
     OR OLD.zoho_purchaseorder_number IS DISTINCT FROM NEW.zoho_purchaseorder_number
     OR OLD.lpn              IS DISTINCT FROM NEW.lpn
     OR OLD.support_notes    IS DISTINCT FROM NEW.support_notes
     OR OLD.zoho_notes       IS DISTINCT FROM NEW.zoho_notes
     OR OLD.condition_grade  IS DISTINCT FROM NEW.condition_grade
     OR OLD.qa_status        IS DISTINCT FROM NEW.qa_status
     OR OLD.shipment_id      IS DISTINCT FROM NEW.shipment_id
     OR OLD.received_at      IS DISTINCT FROM NEW.received_at
     OR OLD.zendesk_ticket   IS DISTINCT FROM NEW.zendesk_ticket)
  EXECUTE FUNCTION fn_enqueue_entity_search_outbox('RECEIVING');

-- sku_catalog
DROP TRIGGER IF EXISTS trg_enqueue_search_outbox_on_sku_catalog ON sku_catalog;
DROP TRIGGER IF EXISTS trg_enqueue_search_outbox_on_sku_catalog_ins ON sku_catalog;
CREATE TRIGGER trg_enqueue_search_outbox_on_sku_catalog_ins
  AFTER INSERT ON sku_catalog
  FOR EACH ROW EXECUTE FUNCTION fn_enqueue_entity_search_outbox('SKU');
DROP TRIGGER IF EXISTS trg_enqueue_search_outbox_on_sku_catalog_upd ON sku_catalog;
CREATE TRIGGER trg_enqueue_search_outbox_on_sku_catalog_upd
  AFTER UPDATE OF sku, product_title, category, upc, ean, gtin, notes,
    lifecycle_status, is_active
  ON sku_catalog
  FOR EACH ROW
  WHEN (OLD.sku              IS DISTINCT FROM NEW.sku
     OR OLD.product_title    IS DISTINCT FROM NEW.product_title
     OR OLD.category         IS DISTINCT FROM NEW.category
     OR OLD.upc              IS DISTINCT FROM NEW.upc
     OR OLD.ean              IS DISTINCT FROM NEW.ean
     OR OLD.gtin             IS DISTINCT FROM NEW.gtin
     OR OLD.notes            IS DISTINCT FROM NEW.notes
     OR OLD.lifecycle_status IS DISTINCT FROM NEW.lifecycle_status
     OR OLD.is_active        IS DISTINCT FROM NEW.is_active)
  EXECUTE FUNCTION fn_enqueue_entity_search_outbox('SKU');

-- repair_service
DROP TRIGGER IF EXISTS trg_enqueue_search_outbox_on_repair_service ON repair_service;
DROP TRIGGER IF EXISTS trg_enqueue_search_outbox_on_repair_service_ins ON repair_service;
CREATE TRIGGER trg_enqueue_search_outbox_on_repair_service_ins
  AFTER INSERT ON repair_service
  FOR EACH ROW EXECUTE FUNCTION fn_enqueue_entity_search_outbox('REPAIR');
DROP TRIGGER IF EXISTS trg_enqueue_search_outbox_on_repair_service_upd ON repair_service;
CREATE TRIGGER trg_enqueue_search_outbox_on_repair_service_upd
  AFTER UPDATE OF ticket_number, product_title, serial_number, issue,
    notes, status, source_order_id, source_tracking_number, source_sku, received_at
  ON repair_service
  FOR EACH ROW
  WHEN (OLD.ticket_number   IS DISTINCT FROM NEW.ticket_number
     OR OLD.product_title   IS DISTINCT FROM NEW.product_title
     OR OLD.serial_number   IS DISTINCT FROM NEW.serial_number
     OR OLD.issue           IS DISTINCT FROM NEW.issue
     OR OLD.notes           IS DISTINCT FROM NEW.notes
     OR OLD.status          IS DISTINCT FROM NEW.status
     OR OLD.source_order_id IS DISTINCT FROM NEW.source_order_id
     OR OLD.source_tracking_number IS DISTINCT FROM NEW.source_tracking_number
     OR OLD.source_sku      IS DISTINCT FROM NEW.source_sku
     OR OLD.received_at     IS DISTINCT FROM NEW.received_at)
  EXECUTE FUNCTION fn_enqueue_entity_search_outbox('REPAIR');

-- fba_shipments
DROP TRIGGER IF EXISTS trg_enqueue_search_outbox_on_fba_shipments ON fba_shipments;
DROP TRIGGER IF EXISTS trg_enqueue_search_outbox_on_fba_shipments_ins ON fba_shipments;
CREATE TRIGGER trg_enqueue_search_outbox_on_fba_shipments_ins
  AFTER INSERT ON fba_shipments
  FOR EACH ROW EXECUTE FUNCTION fn_enqueue_entity_search_outbox('FBA_SHIPMENT');
DROP TRIGGER IF EXISTS trg_enqueue_search_outbox_on_fba_shipments_upd ON fba_shipments;
CREATE TRIGGER trg_enqueue_search_outbox_on_fba_shipments_upd
  AFTER UPDATE OF shipment_ref, amazon_shipment_id, destination_fc,
    status, notes, due_date, shipped_at
  ON fba_shipments
  FOR EACH ROW
  WHEN (OLD.shipment_ref       IS DISTINCT FROM NEW.shipment_ref
     OR OLD.amazon_shipment_id IS DISTINCT FROM NEW.amazon_shipment_id
     OR OLD.destination_fc     IS DISTINCT FROM NEW.destination_fc
     OR OLD.status             IS DISTINCT FROM NEW.status
     OR OLD.notes              IS DISTINCT FROM NEW.notes
     OR OLD.due_date           IS DISTINCT FROM NEW.due_date
     OR OLD.shipped_at         IS DISTINCT FROM NEW.shipped_at)
  EXECUTE FUNCTION fn_enqueue_entity_search_outbox('FBA_SHIPMENT');

-- ─── Parent-delete integrity: docs + pending outbox rows, every value ──────
-- Contract point 5: a trigger family sharing one generic dispatch function,
-- covering EVERY discriminator value in the same migration. Also clears
-- pending outbox rows so the worker never resurrects a doc for a deleted row
-- (the worker additionally treats parent-missing as delete — belt and braces).
CREATE OR REPLACE FUNCTION fn_delete_entity_search_docs_on_parent_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM entity_search_docs
  WHERE entity_type = TG_ARGV[0]
    AND entity_id = OLD.id;
  DELETE FROM entity_search_outbox
  WHERE entity_type = TG_ARGV[0]
    AND entity_id = OLD.id
    AND processed_at IS NULL;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_delete_search_docs_on_orders_delete ON orders;
CREATE TRIGGER trg_delete_search_docs_on_orders_delete
  AFTER DELETE ON orders
  FOR EACH ROW EXECUTE FUNCTION fn_delete_entity_search_docs_on_parent_delete('ORDER');

DROP TRIGGER IF EXISTS trg_delete_search_docs_on_serial_units_delete ON serial_units;
CREATE TRIGGER trg_delete_search_docs_on_serial_units_delete
  AFTER DELETE ON serial_units
  FOR EACH ROW EXECUTE FUNCTION fn_delete_entity_search_docs_on_parent_delete('SERIAL_UNIT');

DROP TRIGGER IF EXISTS trg_delete_search_docs_on_receiving_delete ON receiving;
CREATE TRIGGER trg_delete_search_docs_on_receiving_delete
  AFTER DELETE ON receiving
  FOR EACH ROW EXECUTE FUNCTION fn_delete_entity_search_docs_on_parent_delete('RECEIVING');

DROP TRIGGER IF EXISTS trg_delete_search_docs_on_sku_catalog_delete ON sku_catalog;
CREATE TRIGGER trg_delete_search_docs_on_sku_catalog_delete
  AFTER DELETE ON sku_catalog
  FOR EACH ROW EXECUTE FUNCTION fn_delete_entity_search_docs_on_parent_delete('SKU');

DROP TRIGGER IF EXISTS trg_delete_search_docs_on_repair_service_delete ON repair_service;
CREATE TRIGGER trg_delete_search_docs_on_repair_service_delete
  AFTER DELETE ON repair_service
  FOR EACH ROW EXECUTE FUNCTION fn_delete_entity_search_docs_on_parent_delete('REPAIR');

DROP TRIGGER IF EXISTS trg_delete_search_docs_on_fba_shipments_delete ON fba_shipments;
CREATE TRIGGER trg_delete_search_docs_on_fba_shipments_delete
  AFTER DELETE ON fba_shipments
  FOR EACH ROW EXECUTE FUNCTION fn_delete_entity_search_docs_on_parent_delete('FBA_SHIPMENT');

-- ─── Tenant-from-birth: loud-fail GUC default + FORCE RLS + policy ──────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'enforce_tenant_isolation') THEN
    PERFORM enforce_tenant_isolation('entity_search_docs');
    PERFORM enforce_tenant_isolation('entity_search_outbox');
  ELSE
    RAISE NOTICE 'enforce_tenant_isolation absent — entity_search_docs/entity_search_outbox left without FORCE RLS';
  END IF;
END $$;

COMMENT ON TABLE entity_search_docs IS
  'Hybrid AI-search index (keyword trgm + 768-dim pgvector) for the P0 CommandBar entities. Written ONLY by the search-outbox worker; freshness via parent-table triggers → entity_search_outbox. See docs/ai-search-modernization-plan.md.';
COMMENT ON TABLE entity_search_outbox IS
  'Freshness queue for entity_search_docs: parent-table triggers enqueue (org, entity_type, entity_id); the cron worker drains, builds search_text, embeds best-effort, upserts docs. Deduped on the pending partial unique.';

COMMIT;
