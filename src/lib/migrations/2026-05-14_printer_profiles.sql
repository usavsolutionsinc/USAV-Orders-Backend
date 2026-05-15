-- ============================================================================
-- 2026-05-14: Printer profiles
-- ============================================================================
-- One row per physical printer that the dispatch endpoint can target. The
-- profile carries the PrintNode (or future Loftware) external id + the label
-- class it's the default for so receivers don't have to pick every time.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS printer_profiles (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  -- External PrintNode id, or any other dispatcher key.
  external_id   TEXT NOT NULL,
  vendor        TEXT NOT NULL DEFAULT 'printnode',
  /**
   * Default for which label class. NULL = generic. Allowed:
   *   carton  — 2x1" carton/PO QR
   *   product — 2x1" SKU + barcode + QR
   *   bin     — bin/location label
   */
  default_for   TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE printer_profiles
  DROP CONSTRAINT IF EXISTS printer_profiles_default_for_chk;
ALTER TABLE printer_profiles
  ADD CONSTRAINT printer_profiles_default_for_chk
  CHECK (default_for IS NULL OR default_for IN ('carton','product','bin'));

ALTER TABLE printer_profiles
  DROP CONSTRAINT IF EXISTS printer_profiles_vendor_chk;
ALTER TABLE printer_profiles
  ADD CONSTRAINT printer_profiles_vendor_chk
  CHECK (vendor IN ('printnode','loftware'));

CREATE INDEX IF NOT EXISTS idx_printer_profiles_active
  ON printer_profiles(default_for) WHERE is_active = true;

COMMENT ON TABLE printer_profiles IS 'Targets for /api/print/dispatch — maps logical names to PrintNode/Loftware ids.';

COMMIT;
