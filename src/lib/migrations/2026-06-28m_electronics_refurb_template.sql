-- ============================================================================
-- 2026-06-28m: "Electronics / AV refurb" system workflow template + default flag
-- ============================================================================
-- Adds the FLAGSHIP system template for the lead vertical (electronics/AV refurb)
-- and makes it the seeded default for new orgs. Extends the generic
-- "standard-refurb-and-list" blueprint (2026-06-22d) with the steps that define
-- ELECTRONICS refurb specifically:
--
--   • data_wipe  — secure erase / factory reset BEFORE grading (compliance gate;
--                  the worst failure in electronics resale is shipping a device
--                  with the prior owner's data). New `data_wipe` engine node.
--   • grade-route (decision) — condition grade → disposition (resale vs salvage),
--                  showcasing the operator-editable decision node.
--   • qc (kit_verify) — final QC + ACCESSORY completeness (power adapter, cables,
--                  remote, stand) + photos before listing — electronics ship with
--                  kits, and a missing adapter is a return.
--   • repair retest loop on BOTH a failed functional test AND a failed wipe (a
--                  non-wipeable device is usually itself faulty → diagnose).
--
--   receive ─received▶ diagnostic ─pass▶ data-wipe ─wiped▶ grade-route ─resale▶ qc ─verified▶ list ─listed▶ pack ─packed▶ ship
--                          │  ▲               │                  │                   │
--                       fail  └──repaired─┐ failed            parts(salvage,         needs_attention
--                          ▼              │   │               terminal/park)            │
--                        repair ◀─────────┴───┘◀──────────────────────────────────────┘
--
-- node `type` keys are engine registry keys (data_wipe registered in
-- src/lib/workflow/nodes/data-wipe.node.ts); config.station/states/outputs mirror
-- the live shapes so a freshly-imported draft lints + previews identically.
--
-- TENANCY: workflow_templates is GLOBAL/system reference (no organization_id, not
-- RLS-enforced) — see 2026-06-22d. This only INSERTs a blueprint + adds a boolean
-- column; no tenant surface, no RLS/FORCE to wire. Additive + idempotent.
--
-- ROLLBACK:
--   DELETE FROM workflow_templates WHERE slug = 'electronics-av-refurb';
--   UPDATE workflow_templates SET is_default = TRUE WHERE slug = 'standard-refurb-and-list';
--   ALTER TABLE workflow_templates DROP COLUMN IF EXISTS is_default;  -- optional
-- ============================================================================

-- 1. A single-default flag so seed-org-workflow can pick the blessed blueprint
--    deterministically instead of "first by id".
ALTER TABLE workflow_templates
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Seed the flagship electronics/AV refurb template.
INSERT INTO workflow_templates (slug, name, description, category, is_default, graph)
VALUES (
  'electronics-av-refurb',
  'Electronics / AV refurb',
  'Receive → full functional + cosmetic diagnostic → (repair loop) → secure data wipe → grade-based disposition → final QC + accessory check → list → pack → ship. The complete electronics/AV refurb lifecycle, with the data-erasure compliance gate and grade→disposition routing built in.',
  'reseller',
  TRUE,
  '{
    "nodes": [
      { "id": "receive",     "type": "receiving",  "x": 40,   "y": 280,
        "config": { "station": "RECEIVING", "states": ["EXPECTED", "ARRIVED", "MATCHED", "UNBOXED"] } },
      { "id": "diagnostic",  "type": "inspection", "x": 320,  "y": 280,
        "config": { "station": "TECH", "states": ["AWAITING_TEST", "IN_TEST", "PASSED", "FAILED"], "producesConditionGrade": true, "gradeDimensions": ["functional", "cosmetic"], "slaHours": 48 } },
      { "id": "repair",      "type": "repair",     "x": 320,  "y": 560,
        "config": { "station": "TECH", "slaHours": 96 } },
      { "id": "data-wipe",   "type": "data_wipe",  "x": 600,  "y": 280,
        "config": { "station": "TECH", "compliance": "data_erasure", "methods": ["factory_reset", "secure_erase", "crypto_erase"], "slaHours": 24 } },
      { "id": "grade-route", "type": "decision",   "x": 880,  "y": 280,
        "config": { "station": "TECH",
          "outputs": [ { "id": "resale", "label": "Resale" }, { "id": "parts", "label": "Parts / Salvage" } ],
          "rules": [
            { "id": "r-scrap", "when": { "disposition": "scrap" }, "thenPort": "parts" },
            { "id": "r-rtv",   "when": { "disposition": "rtv" },   "thenPort": "parts" },
            { "id": "r-parts", "when": { "grade": "PARTS" },        "thenPort": "parts" }
          ],
          "defaultPort": "resale" } },
      { "id": "qc",          "type": "kit_verify", "x": 1160, "y": 200,
        "config": { "station": "PACK", "requirePhotos": true, "checkAccessories": true } },
      { "id": "list",        "type": "list_ebay",  "x": 1440, "y": 200,
        "config": { "station": "ADMIN", "channel": "ebay" } },
      { "id": "pack",        "type": "pack",       "x": 1720, "y": 200,
        "config": { "station": "PACK", "states": ["ALLOCATED", "PICKED", "PACKED"] } },
      { "id": "ship",        "type": "ship",       "x": 2000, "y": 200,
        "config": { "station": "PACK", "states": ["LABELED", "SHIPPED"] } }
    ],
    "edges": [
      { "id": "e-received",  "source": "receive",     "sourcePort": "received",         "target": "diagnostic" },
      { "id": "e-fail",      "source": "diagnostic",  "sourcePort": "fail",             "target": "repair" },
      { "id": "e-repaired",  "source": "repair",      "sourcePort": "repaired",         "target": "diagnostic" },
      { "id": "e-pass",      "source": "diagnostic",  "sourcePort": "pass",             "target": "data-wipe" },
      { "id": "e-wipe-fail", "source": "data-wipe",   "sourcePort": "failed",           "target": "repair" },
      { "id": "e-wiped",     "source": "data-wipe",   "sourcePort": "wiped",            "target": "grade-route" },
      { "id": "e-resale",    "source": "grade-route", "sourcePort": "resale",           "target": "qc" },
      { "id": "e-qc-redo",   "source": "qc",          "sourcePort": "needs_attention",  "target": "repair" },
      { "id": "e-verified",  "source": "qc",          "sourcePort": "verified",         "target": "list" },
      { "id": "e-listed",    "source": "list",        "sourcePort": "listed",           "target": "pack" },
      { "id": "e-packed",    "source": "pack",        "sourcePort": "packed",           "target": "ship" }
    ]
  }'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

-- 3. Exactly one default: the electronics flagship. Demote any other default.
UPDATE workflow_templates SET is_default = (slug = 'electronics-av-refurb')
 WHERE is_system = TRUE;
