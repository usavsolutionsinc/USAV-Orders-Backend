-- ============================================================================
-- 2026-07-03l: entity_signals — structured "why" facts, the AI's primary read
-- substrate (Phase 0 of docs/todo/universal-feed-polymorphic-plan.md §2.3)
-- ============================================================================
-- One row = one structured reason/observation about an entity: return reasons,
-- receiving exceptions/triage outcomes, tech test-fail reasons, raw buyer
-- notes. Queryable ("top reasons by node"), full-text searchable (notes_tsv),
-- and append-only. Every signal is ALSO emitted to ops_events by the writing
-- helper (recordEntitySignal) so the event spine stays the SoT timeline.
--
-- Contract: .claude/rules/polymorphic-tables.md.
--   • entity_type  — named CHECK (7 confirmed parents). NOTE: ORDER anchors
--     the LEGACY `orders` marketplace mirror (INTEGER PK) — scouting verified
--     that the eBay order sync writes `orders`, not `sales_orders` as plan
--     §2.3's sketch assumed, and `sales_orders`' UUID PK could not anchor a
--     BIGINT entity_id anyway. Plan §2.3 carries a dated correction.
--   • signal_kind  — second discriminator axis, validated in the app-layer
--     registry (src/lib/surfaces/registry.ts), deliberately NOT a CHECK:
--     kinds are additive-by-design (new emitter = new registry entry, no
--     migration — plan §2 "Key properties" + §-1 Q12).
--   • reason_code  — soft reference into the governed reason_codes vocabulary
--     (org + flow_context scoped there); TEXT here because signals must
--     survive reason-code soft-deletes and cross flow_contexts.
--   • Parent-delete integrity: trigger family below (dispatch on TG_ARGV[0]).
--   • workflow_definition_id — real FK SET NULL (signals outlive discarded
--     drafts); node_id FK-free by design (node ids re-minted per draft, graph
--     saves replace workflow_nodes rows wholesale).
--
-- Idempotency for derived/external signals (§2.3 mirror-derivation standard):
--   source_ref = external natural key (platform message/note id, or a sha of
--   order-id+note-text when the platform gives no id); NULL for internal
--   chokepoint emitters. The partial unique index below makes the fresh path,
--   the nightly heal sweep, and backfills all free no-ops on rows already
--   emitted (INSERT ... ON CONFLICT DO NOTHING).
--
-- Safety gating: brand-new table, zero writers at author time. The only
-- writer (recordEntitySignal, Phase 1) stamps organization_id explicitly and
-- runs under withTenantTransaction → tenant-from-birth enforcement safe.
--
-- ROLLBACK (order matters — the 7 triggers live ON THE PARENT TABLES, so the
-- function must go first WITH CASCADE or every parent DELETE starts erroring):
--   select relax_tenant_isolation('entity_signals');
--   DROP FUNCTION IF EXISTS fn_delete_entity_signals_on_parent_delete() CASCADE;  -- drops the 7 parent triggers
--   DROP TABLE IF EXISTS entity_signals;
--
-- VERIFY (after apply): npm run tenancy:coverage
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS entity_signals (
  id                     BIGSERIAL PRIMARY KEY,
  organization_id        UUID NOT NULL,             -- no DEFAULT; enforce_tenant_isolation() installs it
  entity_type            TEXT NOT NULL,             -- named CHECK below
  entity_id              BIGINT NOT NULL,
  signal_kind            TEXT NOT NULL,             -- registry-validated ('return_reason','buyer_note','exception_why','test_fail_reason',...)
  reason_code            TEXT,                      -- soft ref → reason_codes.code (org+flow_context scoped there)
  notes                  TEXT,
  severity               SMALLINT,                  -- optional 0..n weighting; app-defined
  occurred_at            TIMESTAMPTZ NOT NULL,
  workflow_definition_id INTEGER REFERENCES workflow_definitions(id) ON DELETE SET NULL,
  node_id                TEXT,                      -- no FK by design (see header)
  source_ref             TEXT,                      -- external natural key for idempotent derivation; NULL for internal emitters
  meta                   JSONB,
  notes_tsv              tsvector GENERATED ALWAYS AS (
                           to_tsvector('simple', coalesce(notes, '') || ' ' || coalesce(reason_code, ''))
                         ) STORED,

  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE entity_signals ADD CONSTRAINT entity_signals_entity_type_chk
    CHECK (entity_type IN ('RECEIVING','RECEIVING_LINE','SERIAL_UNIT','ORDER','FBA_SHIPMENT','REPAIR','WARRANTY_CLAIM'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Idempotent external derivation: one signal per (org, kind, external ref).
CREATE UNIQUE INDEX IF NOT EXISTS ux_entity_signals_source_ref
  ON entity_signals (organization_id, signal_kind, source_ref)
  WHERE source_ref IS NOT NULL;

-- Per-entity timeline ("why did this unit fail / this carton stall").
CREATE INDEX IF NOT EXISTS idx_entity_signals_org_entity_time
  ON entity_signals (organization_id, entity_type, entity_id, occurred_at DESC, id DESC);

-- Per-node aggregates ("top reasons by node") — the AI's core rollup query.
CREATE INDEX IF NOT EXISTS idx_entity_signals_org_node_kind
  ON entity_signals (organization_id, node_id, signal_kind, reason_code);

-- Kind-over-time rollups ("return reasons, last 30d").
CREATE INDEX IF NOT EXISTS idx_entity_signals_org_kind_time
  ON entity_signals (organization_id, signal_kind, occurred_at DESC, id DESC);

-- Full-text over notes + reason_code (search_notes tool).
CREATE INDEX IF NOT EXISTS idx_entity_signals_notes_tsv
  ON entity_signals USING GIN (notes_tsv);

COMMENT ON TABLE entity_signals IS
  'Structured "why" facts (plan: universal-feed-polymorphic-plan.md §2.3). signal_kind validated by src/lib/surfaces/registry.ts; source_ref = idempotency key for mirror-derived signals; every insert also emits an ops_event. Tenant-scoped from birth.';

COMMENT ON COLUMN entity_signals.source_ref IS
  'External natural key for idempotent derivation (platform note/message id, or sha256 of orderid+note when the platform gives no id). NULL for internal chokepoint emitters — their idempotency rides the chokepoint''s clientEventId/event gating.';

-- ── Parent-delete integrity: cascade-delete signals with their parent ────────
--    Same 7 confirmed parents as feed_memberships; no skips.
CREATE OR REPLACE FUNCTION fn_delete_entity_signals_on_parent_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM entity_signals
  WHERE entity_type = TG_ARGV[0]
    AND entity_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_delete_entity_signals_on_receiving_delete ON receiving;
CREATE TRIGGER trg_delete_entity_signals_on_receiving_delete
AFTER DELETE ON receiving
FOR EACH ROW EXECUTE FUNCTION fn_delete_entity_signals_on_parent_delete('RECEIVING');

DROP TRIGGER IF EXISTS trg_delete_entity_signals_on_receiving_line_delete ON receiving_lines;
CREATE TRIGGER trg_delete_entity_signals_on_receiving_line_delete
AFTER DELETE ON receiving_lines
FOR EACH ROW EXECUTE FUNCTION fn_delete_entity_signals_on_parent_delete('RECEIVING_LINE');

DROP TRIGGER IF EXISTS trg_delete_entity_signals_on_serial_unit_delete ON serial_units;
CREATE TRIGGER trg_delete_entity_signals_on_serial_unit_delete
AFTER DELETE ON serial_units
FOR EACH ROW EXECUTE FUNCTION fn_delete_entity_signals_on_parent_delete('SERIAL_UNIT');

DROP TRIGGER IF EXISTS trg_delete_entity_signals_on_order_delete ON orders;
CREATE TRIGGER trg_delete_entity_signals_on_order_delete
AFTER DELETE ON orders
FOR EACH ROW EXECUTE FUNCTION fn_delete_entity_signals_on_parent_delete('ORDER');

DROP TRIGGER IF EXISTS trg_delete_entity_signals_on_fba_shipment_delete ON fba_shipments;
CREATE TRIGGER trg_delete_entity_signals_on_fba_shipment_delete
AFTER DELETE ON fba_shipments
FOR EACH ROW EXECUTE FUNCTION fn_delete_entity_signals_on_parent_delete('FBA_SHIPMENT');

DROP TRIGGER IF EXISTS trg_delete_entity_signals_on_repair_service_delete ON repair_service;
CREATE TRIGGER trg_delete_entity_signals_on_repair_service_delete
AFTER DELETE ON repair_service
FOR EACH ROW EXECUTE FUNCTION fn_delete_entity_signals_on_parent_delete('REPAIR');

DROP TRIGGER IF EXISTS trg_delete_entity_signals_on_warranty_claim_delete ON warranty_claims;
CREATE TRIGGER trg_delete_entity_signals_on_warranty_claim_delete
AFTER DELETE ON warranty_claims
FOR EACH ROW EXECUTE FUNCTION fn_delete_entity_signals_on_parent_delete('WARRANTY_CLAIM');

-- ── Tenant-from-birth enforcement ────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'enforce_tenant_isolation') THEN
    PERFORM enforce_tenant_isolation('entity_signals');
  ELSE
    RAISE NOTICE 'enforce_tenant_isolation absent — entity_signals left without FORCE RLS';
  END IF;
END $$;

COMMIT;
