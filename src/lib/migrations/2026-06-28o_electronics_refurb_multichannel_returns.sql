-- ============================================================================
-- 2026-06-28o: enrich the electronics-av-refurb template — multichannel + returns
-- ============================================================================
-- Upgrades the flagship system template (2026-06-28m, slug 'electronics-av-refurb')
-- from 9 → 12 nodes by adding the two final lifecycle pieces, using the new
-- engine node types `list` (generic multichannel listing) and `returns`:
--
--   • MULTICHANNEL — a `list-route` decision after QC routes by condition grade
--     to a channel: grade C → wholesale (the `list` node, channel=wholesale),
--     everything else → eBay (`list_ebay`). Both converge on pack. Demonstrates
--     grade→channel routing straight from the seeded template.
--   • RETURNS / WARRANTY TAIL — a `returns` node (the re-entry point for a unit
--     that comes back) triages restock / rtv / scrap; restock re-enters QC so a
--     returned-then-refurbished unit re-lists. Electronics have high return
--     rates, so the tail is part of the lifecycle, not an afterthought.
--
--   receive ─▶ diagnostic ─pass▶ data-wipe ─wiped▶ grade-route ─resale▶ qc ─verified▶ list-route ─ebay──▶ list-ebay ──┐
--                  │  ▲              │                  │              │ ▲                      └─wholesale▶ list ──┐  ├▶ pack ─▶ ship
--               fail  └─repaired─┐ failed            parts          needs_attention            (returns ─restock─┘)  │
--                  ▼            │   │              (terminal)          │                                            ▼
--                repair ◀───────┴───┘◀──────────────────────────────────┘                                       (pack)
--
-- TENANCY: workflow_templates is GLOBAL/system reference (no org_id, not
-- RLS-enforced; see 2026-06-22d). This UPDATEs one system blueprint row — new
-- orgs clone the enriched graph; orgs that already cloned keep their own copy
-- (edit in Studio). Additive node types (`list`, `returns`) are registered in
-- src/lib/workflow/nodes/. Idempotent: the UPDATE sets the same graph every run.
--
-- ROLLBACK: re-apply 2026-06-28m's INSERT body as an UPDATE (the 9-node graph),
--   or DELETE the row and let 2026-06-28m re-seed.
-- ============================================================================

UPDATE workflow_templates
SET graph = '{
  "nodes": [
    { "id": "receive",        "type": "receiving",  "x": 40,   "y": 300,
      "config": { "station": "RECEIVING", "states": ["EXPECTED", "ARRIVED", "MATCHED", "UNBOXED"] } },
    { "id": "diagnostic",     "type": "inspection", "x": 320,  "y": 300,
      "config": { "station": "TECH", "states": ["AWAITING_TEST", "IN_TEST", "PASSED", "FAILED"], "producesConditionGrade": true, "gradeDimensions": ["functional", "cosmetic"], "slaHours": 48 } },
    { "id": "repair",         "type": "repair",     "x": 320,  "y": 580,
      "config": { "station": "TECH", "slaHours": 96 } },
    { "id": "data-wipe",      "type": "data_wipe",  "x": 600,  "y": 300,
      "config": { "station": "TECH", "compliance": "data_erasure", "methods": ["factory_reset", "secure_erase", "crypto_erase"], "slaHours": 24 } },
    { "id": "grade-route",    "type": "decision",   "x": 880,  "y": 300,
      "config": { "station": "TECH",
        "outputs": [ { "id": "resale", "label": "Resale" }, { "id": "parts", "label": "Parts / Salvage" } ],
        "rules": [
          { "id": "r-scrap", "when": { "disposition": "scrap" }, "thenPort": "parts" },
          { "id": "r-rtv",   "when": { "disposition": "rtv" },   "thenPort": "parts" },
          { "id": "r-parts", "when": { "grade": "PARTS" },        "thenPort": "parts" }
        ],
        "defaultPort": "resale" } },
    { "id": "qc",             "type": "kit_verify", "x": 1160, "y": 220,
      "config": { "station": "PACK", "requirePhotos": true, "checkAccessories": true } },
    { "id": "list-route",     "type": "decision",   "x": 1440, "y": 220,
      "config": { "station": "ADMIN",
        "outputs": [ { "id": "ebay", "label": "eBay" }, { "id": "wholesale", "label": "Wholesale" } ],
        "rules": [
          { "id": "r-c-wholesale", "when": { "grade": "C" }, "thenPort": "wholesale" }
        ],
        "defaultPort": "ebay" } },
    { "id": "list-ebay",      "type": "list_ebay",  "x": 1720, "y": 120,
      "config": { "station": "ADMIN", "channel": "ebay" } },
    { "id": "list-wholesale", "type": "list",       "x": 1720, "y": 320,
      "config": { "station": "ADMIN", "channel": "wholesale" } },
    { "id": "pack",           "type": "pack",       "x": 2000, "y": 220,
      "config": { "station": "PACK", "states": ["ALLOCATED", "PICKED", "PACKED"] } },
    { "id": "ship",           "type": "ship",       "x": 2280, "y": 220,
      "config": { "station": "PACK", "states": ["LABELED", "SHIPPED"] } },
    { "id": "returns",        "type": "returns",    "x": 1160, "y": 500,
      "config": { "station": "RECEIVING" } }
  ],
  "edges": [
    { "id": "e-received",   "source": "receive",        "sourcePort": "received",        "target": "diagnostic" },
    { "id": "e-fail",       "source": "diagnostic",     "sourcePort": "fail",            "target": "repair" },
    { "id": "e-repaired",   "source": "repair",         "sourcePort": "repaired",        "target": "diagnostic" },
    { "id": "e-pass",       "source": "diagnostic",     "sourcePort": "pass",            "target": "data-wipe" },
    { "id": "e-wipe-fail",  "source": "data-wipe",      "sourcePort": "failed",          "target": "repair" },
    { "id": "e-wiped",      "source": "data-wipe",      "sourcePort": "wiped",           "target": "grade-route" },
    { "id": "e-resale",     "source": "grade-route",    "sourcePort": "resale",          "target": "qc" },
    { "id": "e-qc-redo",    "source": "qc",             "sourcePort": "needs_attention", "target": "repair" },
    { "id": "e-verified",   "source": "qc",             "sourcePort": "verified",        "target": "list-route" },
    { "id": "e-list-ebay",  "source": "list-route",     "sourcePort": "ebay",            "target": "list-ebay" },
    { "id": "e-list-whlsl", "source": "list-route",     "sourcePort": "wholesale",       "target": "list-wholesale" },
    { "id": "e-ebay-pack",  "source": "list-ebay",      "sourcePort": "listed",          "target": "pack" },
    { "id": "e-whlsl-pack", "source": "list-wholesale", "sourcePort": "listed",          "target": "pack" },
    { "id": "e-packed",     "source": "pack",           "sourcePort": "packed",          "target": "ship" },
    { "id": "e-restock",    "source": "returns",        "sourcePort": "restock",         "target": "qc" }
  ]
}'::jsonb
WHERE slug = 'electronics-av-refurb';
