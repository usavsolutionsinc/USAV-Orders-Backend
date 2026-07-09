-- ============================================================================
-- 2026-07-01i: close the returns node's rtv/scrap dead-end ports
-- ============================================================================
-- The `returns` node (added 2026-06-28o) declares three ports — restock, rtv,
-- scrap — but only `restock` has an outbound edge (→ qc). A node with SOME
-- ports wired and others not is an ERROR-severity `dead-end-port` diagnostics
-- finding (src/lib/workflow/diagnostics.ts), not the benign "zero-wired-ports
-- terminal" case — so the moment any org edits and republishes their cloned
-- draft of this template, that publish is blocked by two findings unrelated
-- to whatever they actually changed. Invisible today only because
-- seedDefaultWorkflowForOrg activates the initial clone via a direct
-- UPDATE...is_active=TRUE, bypassing the publish/diagnostics gate entirely.
--
-- Fix: add two new thin terminal node types (this migration's prerequisite;
-- see src/lib/workflow/nodes/rtv.node.ts and parts-harvest.node.ts, registered
-- in src/lib/workflow/index.ts) and wire the two dead-end ports to them —
-- returns.rtv → rtv-vendor, returns.scrap → parts-harvest. Both are zero-
-- further-routing terminal nodes (a unit lands, the run resolves `done`); the
-- domain write already happened in recordDisposition before the tap that
-- routes here, so there is nothing more for the graph to do at this position
-- beyond making it observable in Studio's Live lens / workflow_runs log.
--
-- Verifying this fix by actually running runDiagnostics() (src/lib/workflow/
-- diagnostics.ts) against the graph — not just reasoning about it — surfaced
-- a SECOND, pre-existing dead-end-port error already live in this template,
-- unrelated to the returns node: grade-route's "parts" lane (its rules already
-- route disposition=scrap/rtv AND grade=PARTS here) has never had an outbound
-- edge. Same destination concept as returns.scrap — a unit that isn't
-- resellable as a whole unit — so wired to the same new parts-harvest node
-- (grade-route.parts → parts-harvest) rather than a second dead end.
--
-- This is Phase 2 (Studio-node-first) of the returns↔receiving↔sales-order
-- unification initiative — see docs/returns-receiving-order-unification-
-- plan.md §7.3 / §9 Stage 2.1. Must land before `return_received` gets a real
-- trigger (this same Stage), so no org's draft is ever in the "some ports
-- wired, some dead-end" state under an active trigger.
--
-- TENANCY: workflow_templates is GLOBAL/system reference (no org_id, not
-- RLS-enforced; see 2026-06-22d). This UPDATEs one system blueprint row — new
-- orgs clone the fixed graph; orgs that already cloned electronics-av-refurb
-- keep their own copy (their existing draft/published definition still has
-- the two dead-end ports and should be fixed the same way via Studio, or a
-- follow-up per-org backfill if that's ever needed — out of scope here, this
-- migration only touches the system template row).
--
-- Verified by actually running runDiagnostics() against this exact graph
-- (not just reasoning about it): zero error-severity findings. The two new
-- nodes each surface a warning-severity no-station finding (nobody on the
-- floor "owns" a pure landing/observability step) — non-blocking by the
-- documented severity contract, left as-is; an org can bind a station later
-- via the Studio Inspector if they want that tracking.
--
-- Idempotent: the UPDATE sets the same graph every run.
--
-- ROLLBACK: re-apply 2026-06-28o's UPDATE body (the 12-node graph without
--   these two nodes/edges).
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
      "config": { "station": "RECEIVING" } },
    { "id": "rtv-vendor",     "type": "rtv",           "x": 900,  "y": 680,
      "config": {} },
    { "id": "parts-harvest",  "type": "parts_harvest", "x": 1420, "y": 680,
      "config": {} }
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
    { "id": "e-restock",    "source": "returns",        "sourcePort": "restock",         "target": "qc" },
    { "id": "e-rtv",        "source": "returns",        "sourcePort": "rtv",             "target": "rtv-vendor" },
    { "id": "e-scrap",      "source": "returns",        "sourcePort": "scrap",           "target": "parts-harvest" },
    { "id": "e-grade-parts","source": "grade-route",    "sourcePort": "parts",           "target": "parts-harvest" }
  ]
}'::jsonb
WHERE slug = 'electronics-av-refurb';
