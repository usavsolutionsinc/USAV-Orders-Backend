-- ============================================================================
-- 2026-07-03k: staff_rail_exclusions — per-staff per-station personal dismiss
-- layer (Phase 0 of docs/todo/universal-feed-polymorphic-plan.md §2.2)
-- ============================================================================
-- Non-destructive personal "dismiss as done" over the shared feed_memberships
-- defaults: a row here hides one feed item for ONE staff member at ONE station.
-- Never touches source records or shared memberships (plan §1 "Dismiss
-- semantics"). Restore = DELETE the row. The rail read is
-- "memberships minus my exclusions" (anti-join on the unique key below).
--
-- Contract: .claude/rules/polymorphic-tables.md.
--   • entity_type — named CHECK (same 7 confirmed parents as feed_memberships).
--   • feed_key    — registry-validated second axis (src/lib/surfaces/registry.ts),
--     no CHECK by design.
--   • station     — VARCHAR(20) free identifier matching the house station
--     vocabulary (inventory_events.station / staff_stations); app-validated.
--   • staff_id    — real FK CASCADE (exclusions are meaningless without the staff row).
--   • Parent-delete integrity on (entity_type, entity_id): trigger family below.
--
-- Safety gating: brand-new table, zero writers at author time. Phase 3/4
-- writers (dismiss/restore routes, applyAgentMutation) stamp organization_id
-- explicitly under withTenantTransaction → tenant-from-birth enforcement safe.
--
-- ROLLBACK (order matters — the 7 triggers live ON THE PARENT TABLES, so the
-- function must go first WITH CASCADE or every parent DELETE starts erroring):
--   select relax_tenant_isolation('staff_rail_exclusions');
--   DROP FUNCTION IF EXISTS fn_delete_staff_rail_exclusions_on_parent_delete() CASCADE;  -- drops the 7 parent triggers
--   DROP TABLE IF EXISTS staff_rail_exclusions;
--
-- VERIFY (after apply): npm run tenancy:coverage
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS staff_rail_exclusions (
  id              BIGSERIAL PRIMARY KEY,
  organization_id UUID NOT NULL,               -- no DEFAULT; enforce_tenant_isolation() installs it
  staff_id        INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  station         VARCHAR(20) NOT NULL,
  feed_key        TEXT NOT NULL,               -- registry-validated
  entity_type     TEXT NOT NULL,               -- named CHECK below
  entity_id       BIGINT NOT NULL,
  excluded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE staff_rail_exclusions ADD CONSTRAINT staff_rail_exclusions_entity_type_chk
    CHECK (entity_type IN ('RECEIVING','RECEIVING_LINE','SERIAL_UNIT','ORDER','FBA_SHIPMENT','REPAIR','WARRANTY_CLAIM'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- One dismissal per (staff, station, feed item); doubles as the anti-join
-- index for the "base minus my exclusions" rail read.
CREATE UNIQUE INDEX IF NOT EXISTS ux_staff_rail_exclusions_natural
  ON staff_rail_exclusions (organization_id, staff_id, station, feed_key, entity_type, entity_id);

-- Trigger-side + "who dismissed this entity" lookups.
CREATE INDEX IF NOT EXISTS idx_staff_rail_exclusions_org_entity
  ON staff_rail_exclusions (organization_id, entity_type, entity_id);

COMMENT ON TABLE staff_rail_exclusions IS
  'Per-staff per-station non-destructive dismiss layer over feed_memberships (plan §2.2). Restore = delete row. feed_key/station validated app-side. Tenant-scoped from birth.';

-- ── Parent-delete integrity: same 7 confirmed parents as feed_memberships ───
CREATE OR REPLACE FUNCTION fn_delete_staff_rail_exclusions_on_parent_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM staff_rail_exclusions
  WHERE entity_type = TG_ARGV[0]
    AND entity_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_delete_staff_rail_exclusions_on_receiving_delete ON receiving;
CREATE TRIGGER trg_delete_staff_rail_exclusions_on_receiving_delete
AFTER DELETE ON receiving
FOR EACH ROW EXECUTE FUNCTION fn_delete_staff_rail_exclusions_on_parent_delete('RECEIVING');

DROP TRIGGER IF EXISTS trg_delete_staff_rail_exclusions_on_receiving_line_delete ON receiving_lines;
CREATE TRIGGER trg_delete_staff_rail_exclusions_on_receiving_line_delete
AFTER DELETE ON receiving_lines
FOR EACH ROW EXECUTE FUNCTION fn_delete_staff_rail_exclusions_on_parent_delete('RECEIVING_LINE');

DROP TRIGGER IF EXISTS trg_delete_staff_rail_exclusions_on_serial_unit_delete ON serial_units;
CREATE TRIGGER trg_delete_staff_rail_exclusions_on_serial_unit_delete
AFTER DELETE ON serial_units
FOR EACH ROW EXECUTE FUNCTION fn_delete_staff_rail_exclusions_on_parent_delete('SERIAL_UNIT');

DROP TRIGGER IF EXISTS trg_delete_staff_rail_exclusions_on_order_delete ON orders;
CREATE TRIGGER trg_delete_staff_rail_exclusions_on_order_delete
AFTER DELETE ON orders
FOR EACH ROW EXECUTE FUNCTION fn_delete_staff_rail_exclusions_on_parent_delete('ORDER');

DROP TRIGGER IF EXISTS trg_delete_staff_rail_exclusions_on_fba_shipment_delete ON fba_shipments;
CREATE TRIGGER trg_delete_staff_rail_exclusions_on_fba_shipment_delete
AFTER DELETE ON fba_shipments
FOR EACH ROW EXECUTE FUNCTION fn_delete_staff_rail_exclusions_on_parent_delete('FBA_SHIPMENT');

DROP TRIGGER IF EXISTS trg_delete_staff_rail_exclusions_on_repair_service_delete ON repair_service;
CREATE TRIGGER trg_delete_staff_rail_exclusions_on_repair_service_delete
AFTER DELETE ON repair_service
FOR EACH ROW EXECUTE FUNCTION fn_delete_staff_rail_exclusions_on_parent_delete('REPAIR');

DROP TRIGGER IF EXISTS trg_delete_staff_rail_exclusions_on_warranty_claim_delete ON warranty_claims;
CREATE TRIGGER trg_delete_staff_rail_exclusions_on_warranty_claim_delete
AFTER DELETE ON warranty_claims
FOR EACH ROW EXECUTE FUNCTION fn_delete_staff_rail_exclusions_on_parent_delete('WARRANTY_CLAIM');

-- ── Tenant-from-birth enforcement ────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'enforce_tenant_isolation') THEN
    PERFORM enforce_tenant_isolation('staff_rail_exclusions');
  ELSE
    RAISE NOTICE 'enforce_tenant_isolation absent — staff_rail_exclusions left without FORCE RLS';
  END IF;
END $$;

COMMIT;
