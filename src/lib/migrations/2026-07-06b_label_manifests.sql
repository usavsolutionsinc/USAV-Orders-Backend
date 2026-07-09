-- label_manifests + label_manifest_items — the "one label, many serials"
-- preboxed-kit layer (Phase 3 of the serial↔label pairing plan, §5.2).
--
-- A manifest is a LOGICAL grouping of N serial units under one master label
-- (manifest_uid). Combine = create OPEN manifest + add items + SEAL + print one
-- master QR. Split = DISSOLVE (remove items, optionally reprint child unit
-- labels). Membership only — a unit's identity (unit_uid) is NEVER re-minted
-- (plan hard rule). A unit may be in BOTH a manifest and an LPN box at once.
--
-- Typed-fact tables (.claude/rules/polymorphic-tables.md): named CHECK
-- discriminators, org-led indexes, real FK parent-delete integrity, tenant-
-- from-birth. manifest_uid reuses the unit-id family with a KIT- prefix
-- (ratified) but draws from its OWN org+year sequence (a kit can span SKUs, so
-- it can't share the per-(sku,year) unit sequence).
--
-- "One OPEN manifest per unit" (ratified): enforced by a unique index on
-- serial_unit_id across LIVE item rows. DISSOLVE deletes items (freeing the
-- unit for a new manifest); SEAL keeps them (a sealed unit is physically boxed
-- and can't join another kit). This is stronger + more correct than a
-- status-partial index, which would wrongly allow a sealed unit into a new box.

BEGIN;

-- ── Manifests ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS label_manifests (
  id              BIGSERIAL PRIMARY KEY,
  organization_id UUID NOT NULL,                 -- NO default; enforce_tenant_isolation() installs it
  manifest_uid    TEXT NOT NULL,                 -- KIT-{SKU_SHORT}-{YYWW}-{SEQ6}
  manifest_type   TEXT NOT NULL,                 -- discriminator; named CHECK below
  sku             TEXT,
  sku_catalog_id  INTEGER,
  condition_grade TEXT,
  status          TEXT NOT NULL DEFAULT 'OPEN',  -- lifecycle; named CHECK below
  notes           TEXT,
  created_by      INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  sealed_at       TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE label_manifests ADD CONSTRAINT label_manifests_type_chk
    CHECK (manifest_type IN ('PREBOX', 'KIT', 'MASTER_CARTON'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE label_manifests ADD CONSTRAINT label_manifests_status_chk
    CHECK (status IN ('OPEN', 'SEALED', 'DISSOLVED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_label_manifests_uid
  ON label_manifests (organization_id, manifest_uid);
CREATE INDEX IF NOT EXISTS idx_label_manifests_status
  ON label_manifests (organization_id, status, created_at DESC);

-- ── Manifest items ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS label_manifest_items (
  id              BIGSERIAL PRIMARY KEY,
  organization_id UUID NOT NULL,
  manifest_id     BIGINT NOT NULL REFERENCES label_manifests(id) ON DELETE CASCADE,
  serial_unit_id  INTEGER NOT NULL REFERENCES serial_units(id) ON DELETE CASCADE,
  ordinal         SMALLINT NOT NULL DEFAULT 0,
  added_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A unit appears at most once per manifest.
CREATE UNIQUE INDEX IF NOT EXISTS ux_label_manifest_items_natural
  ON label_manifest_items (organization_id, manifest_id, serial_unit_id);
-- One LIVE manifest per unit (dissolve deletes items → frees the unit).
CREATE UNIQUE INDEX IF NOT EXISTS ux_label_manifest_items_one_live
  ON label_manifest_items (organization_id, serial_unit_id);
CREATE INDEX IF NOT EXISTS idx_label_manifest_items_manifest
  ON label_manifest_items (organization_id, manifest_id, ordinal);

-- ── Per-org+year manifest sequence (KIT SEQ6) ────────────────────────────────
CREATE TABLE IF NOT EXISTS label_manifest_sequences (
  organization_id UUID NOT NULL,
  year            INTEGER NOT NULL,
  next_seq        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, year)
);

-- ── Wire the Phase 2 ledger's manifest_id to this table (deferred FK) ────────
DO $$ BEGIN
  ALTER TABLE label_print_jobs
    ADD CONSTRAINT label_print_jobs_manifest_id_fkey
    FOREIGN KEY (manifest_id) REFERENCES label_manifests(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Tenant-from-birth ────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'enforce_tenant_isolation') THEN
    PERFORM enforce_tenant_isolation('label_manifests');
    PERFORM enforce_tenant_isolation('label_manifest_items');
    PERFORM enforce_tenant_isolation('label_manifest_sequences');
  ELSE
    RAISE NOTICE 'enforce_tenant_isolation absent — label_manifest* left without FORCE RLS';
  END IF;
END $$;

COMMIT;
