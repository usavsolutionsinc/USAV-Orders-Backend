-- Failure-mode taxonomy + per-unit failure tags.
--
-- Part of the Condition Grading + Repair History QC System
-- (docs/condition-grading-repair-qc-plan.md §4.3/§4.4). Turns free-text defect
-- notes into a structured taxonomy so failures can be tagged, counted, and
-- (later) linked to repairs + grade caps.
--
-- Three structural changes:
--
--   1. failure_modes — the taxonomy (lookup). `code` is the stable key;
--      `caps_grade_at` lets a mode cap the best assignable grade later
--      (advisory in this slice — no gate). Seeded with a Bose-oriented set.
--
--   2. unit_failure_tags — per-serial defect tags. Append-only-ish: a tag is
--      opened (resolution_status='open') and later resolved/scrapped. Sourced
--      from QC fails (auto), returns, manual, or repair. `resolved_repair_id`
--      is intentionally omitted — unit_repairs is Phase 3; add the FK then.
--
--   3. qc_check_templates.failure_mode_id + tech_verifications.failed_mode_id —
--      a step can name the failure mode to auto-tag when it fails; the recorded
--      result remembers which mode it mapped to.
--
-- severity / category / source / resolution_status are plain TEXT with CHECKs
-- (not enums) to avoid enum-ALTER churn; app-level validation gates writes.

BEGIN;

CREATE TABLE IF NOT EXISTS failure_modes (
  id                 SERIAL PRIMARY KEY,
  code               TEXT NOT NULL UNIQUE,
  label              TEXT NOT NULL,
  category           TEXT NOT NULL DEFAULT 'hardware',
  severity           TEXT NOT NULL DEFAULT 'major',
  is_repairable      BOOLEAN NOT NULL DEFAULT true,
  typical_cost_cents INTEGER,
  caps_grade_at      condition_grade_enum,
  sort_order         INTEGER NOT NULL DEFAULT 0,
  active             BOOLEAN NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE failure_modes
  DROP CONSTRAINT IF EXISTS failure_modes_category_chk;
ALTER TABLE failure_modes
  ADD CONSTRAINT failure_modes_category_chk
  CHECK (category IN ('hardware', 'software', 'cosmetic', 'electrical', 'accessory', 'other'));
ALTER TABLE failure_modes
  DROP CONSTRAINT IF EXISTS failure_modes_severity_chk;
ALTER TABLE failure_modes
  ADD CONSTRAINT failure_modes_severity_chk
  CHECK (severity IN ('critical', 'major', 'minor'));

CREATE TABLE IF NOT EXISTS unit_failure_tags (
  id                   BIGSERIAL PRIMARY KEY,
  serial_unit_id       INTEGER NOT NULL REFERENCES serial_units(id) ON DELETE CASCADE,
  failure_mode_id      INTEGER NOT NULL REFERENCES failure_modes(id),
  detected_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  detected_by_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  source               TEXT NOT NULL DEFAULT 'manual',
  resolution_status    TEXT NOT NULL DEFAULT 'open',
  inventory_event_id   BIGINT REFERENCES inventory_events(id) ON DELETE SET NULL,
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE unit_failure_tags
  DROP CONSTRAINT IF EXISTS unit_failure_tags_source_chk;
ALTER TABLE unit_failure_tags
  ADD CONSTRAINT unit_failure_tags_source_chk
  CHECK (source IN ('qc', 'return', 'manual', 'repair'));
ALTER TABLE unit_failure_tags
  DROP CONSTRAINT IF EXISTS unit_failure_tags_resolution_chk;
ALTER TABLE unit_failure_tags
  ADD CONSTRAINT unit_failure_tags_resolution_chk
  CHECK (resolution_status IN ('open', 'resolved', 'scrapped', 'wontfix'));

CREATE INDEX IF NOT EXISTS idx_unit_failure_tags_unit
  ON unit_failure_tags (serial_unit_id);
-- At most one OPEN tag per (unit, mode) — keeps auto-tag-on-fail idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS ux_unit_failure_tags_open
  ON unit_failure_tags (serial_unit_id, failure_mode_id)
  WHERE resolution_status = 'open';

-- A step can name the failure mode to auto-tag on fail; the result remembers it.
ALTER TABLE qc_check_templates
  ADD COLUMN IF NOT EXISTS failure_mode_id INTEGER REFERENCES failure_modes(id) ON DELETE SET NULL;
ALTER TABLE tech_verifications
  ADD COLUMN IF NOT EXISTS failed_mode_id INTEGER REFERENCES failure_modes(id) ON DELETE SET NULL;

-- ── Seed: Bose-oriented starter taxonomy (idempotent on code) ───────────────
INSERT INTO failure_modes (code, label, category, severity, is_repairable, caps_grade_at, sort_order)
VALUES
  ('NO_POWER',          'No power / won''t turn on',     'electrical', 'critical', true,  'USED_C', 10),
  ('BATTERY_DEAD',      'Battery dead / won''t charge',  'electrical', 'critical', true,  'USED_C', 20),
  ('BATTERY_DEGRADED',  'Battery health degraded',       'electrical', 'major',    true,  'USED_B', 30),
  ('CHARGE_PORT_FAULT', 'Charge port fault',             'hardware',   'major',    true,  NULL,     40),
  ('BT_NO_PAIR',        'Bluetooth won''t pair',         'hardware',   'major',    true,  NULL,     50),
  ('BT_DROPS',          'Bluetooth drops / weak',        'hardware',   'minor',    true,  NULL,     60),
  ('SPEAKER_DEAD',      'Speaker dead / no audio',       'hardware',   'critical', true,  'USED_C', 70),
  ('SPEAKER_RATTLE',    'Speaker rattle / distortion',   'hardware',   'major',    true,  'USED_B', 80),
  ('MIC_DEAD',          'Microphone not working',        'hardware',   'major',    true,  NULL,     90),
  ('BUTTON_FAULT',      'Button / control fault',        'hardware',   'minor',    true,  NULL,    100),
  ('FIRMWARE_FAULT',    'Firmware / software fault',     'software',   'major',    true,  NULL,    110),
  ('CASE_CRACK',        'Cracked housing',               'cosmetic',   'major',    false, 'USED_B',120),
  ('HEAVY_SCRATCH',     'Heavy cosmetic wear',           'cosmetic',   'minor',    false, 'USED_B',130),
  ('MISSING_ACCESSORY', 'Missing accessory / part',      'accessory',  'minor',    true,  NULL,    140),
  ('WATER_DAMAGE',      'Liquid / water damage',         'electrical', 'critical', false, 'PARTS', 150)
ON CONFLICT (code) DO NOTHING;

COMMIT;
