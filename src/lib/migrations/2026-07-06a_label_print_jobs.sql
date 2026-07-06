-- label_print_jobs — immutable per-print ledger (Phase 2 of the serial↔label
-- pairing plan, docs/todo/serial-label-pairing-split-combine-plan.md §5.1).
--
-- One row per PHYSICAL label print (unit / manifest / handling-unit), so the
-- system can answer "which exact DataMatrix was on the sticker for serial X?"
-- and prove reprint-vs-first-issue in a dispute. Append-only: reprints add a
-- new row (is_reprint=true) pointing at the same unit_uid — identity is never
-- re-minted (plan hard rule).
--
-- Typed-fact/event table (.claude/rules/polymorphic-tables.md): discriminator
-- (job_type) via a named CHECK; parent-delete integrity via REAL FKs
-- (ON DELETE SET NULL — a dropped unit/box leaves the historical print record
-- intact, just unlinked); org-led indexes; tenant-from-birth.
--
-- manifest_id ships as a plain column here (nullable, no FK) because
-- label_manifests does not exist until Phase 3; that migration adds the FK.

BEGIN;

CREATE TABLE IF NOT EXISTS label_print_jobs (
  id                 BIGSERIAL PRIMARY KEY,
  organization_id    UUID NOT NULL,                 -- NO default; enforce_tenant_isolation() installs the GUC default
  job_type           TEXT NOT NULL,                 -- discriminator; named CHECK below
  serial_unit_id     INTEGER REFERENCES serial_units(id) ON DELETE SET NULL,
  manifest_id        BIGINT,                        -- FK to label_manifests(id) added in Phase 3
  handling_unit_id   BIGINT REFERENCES handling_units(id) ON DELETE SET NULL,
  unit_uid           TEXT,                          -- snapshot of the identity at print time
  qr_payload         TEXT NOT NULL,                 -- exactly what the DataMatrix/QR encoded
  symbology          TEXT NOT NULL DEFAULT 'datamatrix',
  template_id        TEXT,                          -- 'product' | 'prebox_master' | 'lpn' | …
  printer_profile_id INTEGER,
  copies             SMALLINT NOT NULL DEFAULT 1,
  is_reprint         BOOLEAN NOT NULL DEFAULT FALSE,
  reprint_of_id      BIGINT REFERENCES label_print_jobs(id) ON DELETE SET NULL,
  actor_staff_id     INTEGER,
  client_event_id    TEXT,                          -- idempotency key (a retry is a no-op)
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE label_print_jobs ADD CONSTRAINT label_print_jobs_job_type_chk
    CHECK (job_type IN ('UNIT', 'MANIFEST', 'HANDLING_UNIT', 'REPRINT'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Idempotency: a client retry carrying the same (org, client_event_id) collapses
-- to a no-op. Org-led per the polymorphic contract.
CREATE UNIQUE INDEX IF NOT EXISTS ux_label_print_jobs_idempotency
  ON label_print_jobs (organization_id, client_event_id)
  WHERE client_event_id IS NOT NULL;

-- Print-history reads: newest-first per unit, org-scoped.
CREATE INDEX IF NOT EXISTS idx_label_print_jobs_unit
  ON label_print_jobs (organization_id, serial_unit_id, created_at DESC);

-- Manifest / handling-unit rollups (Phase 3 + box label history).
CREATE INDEX IF NOT EXISTS idx_label_print_jobs_manifest
  ON label_print_jobs (organization_id, manifest_id, created_at DESC)
  WHERE manifest_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_label_print_jobs_handling_unit
  ON label_print_jobs (organization_id, handling_unit_id, created_at DESC)
  WHERE handling_unit_id IS NOT NULL;

-- Tenant-from-birth: installs the loud-fail GUC default, FORCE RLS, and the
-- canonical tenant_isolation policy (do not hand-write any of the three).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'enforce_tenant_isolation') THEN
    PERFORM enforce_tenant_isolation('label_print_jobs');
  ELSE
    RAISE NOTICE 'enforce_tenant_isolation absent — label_print_jobs left without FORCE RLS';
  END IF;
END $$;

COMMIT;
