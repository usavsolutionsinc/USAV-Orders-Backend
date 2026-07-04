-- ============================================================================
-- 2026-07-01n: serial_unit_provenance — typed origin spine for serial_units
-- ============================================================================
-- Phase 1 of docs/todo/schema-wide-polymorphic-refactor-plan.md ("Serial Units"
-- target shape). serial_units today carries a denormalized provenance family:
--   origin_source            TEXT      -- 'receiving'|'tsn'|'sku'|'manual'|'legacy'
--   origin_receiving_line_id INT  FK   -- → receiving_lines(id)
--   origin_tsn_id            INT  soft -- → tech_serial_numbers(id), no FK
--   origin_sku_id            INT  soft -- → the retired sku table, no FK
-- i.e. the exact "string discriminator + untyped int id" anti-pattern flagged in
-- Appendix A. This table collapses that family onto the ratified polymorphic
-- reference contract (.claude/rules/polymorphic-tables.md): a NAMED-CHECK
-- discriminator (`origin_type`) + a BIGINT `origin_id`, org-led indexes, a real
-- FK ON DELETE CASCADE on the non-polymorphic side (serial_unit_id), and
-- tenant-from-birth via enforce_tenant_isolation() in this same migration.
--
-- ADDITIVE + REVERSIBLE. The serial_units.origin_* columns stay as-is (Phase 1
-- writes nothing new; the backfill below is a one-shot projection). Dual-write
-- and reader migration are later phases — nothing reads this table yet.
--
-- WHY BIGINT origin_id: it must hold receiving_lines.id, which is BIGSERIAL
-- (bigint). serial_unit_id is INTEGER to match serial_units.id (SERIAL/int4)
-- exactly, per the contract's "match the parent PK type for a real FK" rule.
--
-- Backfill mapping (one row per unit; a concrete id wins over the text source):
--   origin_receiving_line_id → ('RECEIVING_LINE', id)
--   origin_tsn_id            → ('TECH_SERIAL',    id)
--   origin_sku_id            → ('SKU_IMPORT',     id)
--   else origin_source text  → RECEIVING_LINE|TECH_SERIAL|SKU_IMPORT|MANUAL|LEGACY, origin_id NULL
-- occurred_at = COALESCE(received_at, created_at).
--
-- ROLLBACK:
--   select relax_tenant_isolation('serial_unit_provenance');
--   DROP TABLE IF EXISTS serial_unit_provenance;
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS serial_unit_provenance (
  id              BIGSERIAL PRIMARY KEY,
  organization_id UUID NOT NULL,                 -- no DEFAULT; helper installs the loud-fail GUC default
  serial_unit_id  INTEGER NOT NULL REFERENCES serial_units(id) ON DELETE CASCADE,
  origin_type     TEXT NOT NULL,                 -- discriminator; named CHECK below
  origin_id       BIGINT,                        -- row in the origin_type's table (nullable for MANUAL/LEGACY/text-only)
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Discriminator domain. RETURN/FBA are reserved for the FBA-fold + returns work
-- (Tier-1 #7); RECEIVING_LINE/TECH_SERIAL/SKU_IMPORT/MANUAL/LEGACY are live today.
DO $$ BEGIN
  ALTER TABLE serial_unit_provenance
    ADD CONSTRAINT serial_unit_provenance_origin_type_chk
    CHECK (origin_type IN ('RECEIVING_LINE','TECH_SERIAL','SKU_IMPORT','RETURN','FBA','MANUAL','LEGACY'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- One provenance edge per (unit, origin_type, origin_id) within an org. NULLs are
-- distinct in a UNIQUE index, so a text-only origin (origin_id NULL) is pinned to
-- one row per (unit, origin_type) by the partial index below.
CREATE UNIQUE INDEX IF NOT EXISTS ux_serial_unit_provenance_natural
  ON serial_unit_provenance (organization_id, serial_unit_id, origin_type, origin_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_serial_unit_provenance_text_only
  ON serial_unit_provenance (organization_id, serial_unit_id, origin_type)
  WHERE origin_id IS NULL;

-- Forward read: "where did this unit come from" (per unit, newest first).
CREATE INDEX IF NOT EXISTS idx_serial_unit_provenance_unit
  ON serial_unit_provenance (organization_id, serial_unit_id, occurred_at DESC);

-- Reverse read: "which units came from this origin row" (where-used).
CREATE INDEX IF NOT EXISTS idx_serial_unit_provenance_origin
  ON serial_unit_provenance (organization_id, origin_type, origin_id);

COMMENT ON TABLE serial_unit_provenance IS
  'Typed origin spine for serial_units — collapses the denormalized origin_source/origin_receiving_line_id/origin_tsn_id/origin_sku_id family onto the polymorphic reference contract (origin_type named-CHECK + origin_id BIGINT). Phase 1, additive; no readers yet. Tenant-scoped.';

-- ── Backfill (runs BEFORE FORCE RLS so the owner INSERT is unobstructed; org is
--     supplied explicitly from each source row, so the loud-fail default never
--     fires). Idempotent via ON CONFLICT DO NOTHING against the natural uniques. ─
INSERT INTO serial_unit_provenance (organization_id, serial_unit_id, origin_type, origin_id, occurred_at)
SELECT su.organization_id, su.id, 'RECEIVING_LINE', su.origin_receiving_line_id::bigint,
       COALESCE(su.received_at, su.created_at)
  FROM serial_units su
 WHERE su.origin_receiving_line_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO serial_unit_provenance (organization_id, serial_unit_id, origin_type, origin_id, occurred_at)
SELECT su.organization_id, su.id, 'TECH_SERIAL', su.origin_tsn_id::bigint,
       COALESCE(su.received_at, su.created_at)
  FROM serial_units su
 WHERE su.origin_tsn_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO serial_unit_provenance (organization_id, serial_unit_id, origin_type, origin_id, occurred_at)
SELECT su.organization_id, su.id, 'SKU_IMPORT', su.origin_sku_id::bigint,
       COALESCE(su.received_at, su.created_at)
  FROM serial_units su
 WHERE su.origin_sku_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Text-only fallback: only when no concrete origin id exists on the unit.
INSERT INTO serial_unit_provenance (organization_id, serial_unit_id, origin_type, origin_id, occurred_at)
SELECT su.organization_id, su.id,
       CASE su.origin_source
         WHEN 'receiving' THEN 'RECEIVING_LINE'
         WHEN 'tsn'       THEN 'TECH_SERIAL'
         WHEN 'sku'       THEN 'SKU_IMPORT'
         WHEN 'manual'    THEN 'MANUAL'
         WHEN 'legacy'    THEN 'LEGACY'
       END,
       NULL::bigint,
       COALESCE(su.received_at, su.created_at)
  FROM serial_units su
 WHERE su.origin_receiving_line_id IS NULL
   AND su.origin_tsn_id IS NULL
   AND su.origin_sku_id IS NULL
   AND su.origin_source IN ('receiving','tsn','sku','manual','legacy')
ON CONFLICT DO NOTHING;

-- ── Flip on FORCE RLS + loud-fail org default + canonical policy ────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'enforce_tenant_isolation') THEN
    PERFORM enforce_tenant_isolation('serial_unit_provenance');
  ELSE
    RAISE NOTICE 'enforce_tenant_isolation absent — serial_unit_provenance left without FORCE RLS';
  END IF;
END $$;

COMMIT;
