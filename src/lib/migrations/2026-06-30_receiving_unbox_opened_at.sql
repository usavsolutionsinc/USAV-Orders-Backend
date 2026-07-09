-- Carton first opened on the Unbox scan surface (distinct from door-scan
-- received_at and physical unboxed_at). Powers the Unbox sidebar UNBOXED feed.

BEGIN;

ALTER TABLE receiving
  ADD COLUMN IF NOT EXISTS unbox_opened_at timestamptz,
  ADD COLUMN IF NOT EXISTS unbox_opened_by integer REFERENCES staff(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_receiving_unbox_opened_at
  ON receiving (organization_id, unbox_opened_at DESC NULLS LAST)
  WHERE unbox_opened_at IS NOT NULL;

COMMENT ON COLUMN receiving.unbox_opened_at IS
  'First time this carton was scanned/opened on the Unbox workspace (not triage door scan).';

COMMENT ON COLUMN receiving.unbox_opened_by IS
  'Staff who first opened this carton on the Unbox workspace.';

COMMIT;
