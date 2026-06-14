---
name: ops-studio
description: Master skill for the Operations Studio upgrade — the dedicated /studio page where reseller owners build/observe/diagnose their whole operations graph. Use BEFORE any work touching /studio, the workflow canvas, lenses, diagnostics, draft/publish, or when deciding which layer (studio / station blocks / canvas / engine) a new feature belongs to.
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
---

# Operations Studio — master map & build rules

This repo is being upgraded from fixed pages into a **modular, visually-composable
operations system for used-goods resellers** (receiving → test/grade → list on eBay &
other platforms → fulfill → returns/warranty). The Studio is the owner's primary
environment: one full-page canvas where the entire operation is modeled, edited,
observed, and linted for gaps.

**Canonical docs (read the one for your layer before building):**
`docs/operations-studio/README.md` (index) → `operations-studio-plan.md` (layer 1, the
Studio) → `station-builder-ui-plan.md` (layer 2, blocks) → `NODE_UI_PLAN.md` (layer 3,
canvas mechanics) → `NODE_WORKFLOW_ARCHITECTURE.md` + `NODE_WORKFLOW_IMPLEMENTATION_PLAN.md`
(layer 4, engine — **already built** in `src/lib/workflow/`).

## Routing — which skill/layer does this work belong to?

| The task is… | Go to |
|---|---|
| New engine node type (a process step the graph can route through) | `/workflow-node` skill |
| New block, data source, or action for station UIs | `/station-block` skill |
| Designing/seeding a reseller flow graph or template | `/reseller-flow` skill |
| Studio page itself: shell, zoom, lenses, Issues rail, draft/publish, simulate | this skill, rules below |
| A new feature display on an ordinary page | `/sidebar-mode` skill (unchanged) |

## The laws

1. **The Studio is a page, not a widget.** It lives at `src/app/studio/` (promote the
   read-only board out of `/admin` — `src/components/admin/workflow/OperationsFlowsDisplay.tsx`
   + `OperationsSidebarPanel.tsx` + `operations-catalog.ts` are the seed). Never add new
   workflow/canvas UI as another `/admin` section or a per-page one-off panel.
2. **One canvas, semantic zoom.** L0 business map (department group nodes) → L1 flow graph
   (numbered states `①②③` from `src/lib/receiving/workflow-stages.ts` `order` + name) →
   L2 station detail (Inspector hosts the station builder) → L3 block binding (config
   sheet). Depth + focus + version persist in the URL (`/studio?v=&focus=&z=`). Never build
   a separate page for a deeper detail level.
3. **Lenses are render layers, not routes.** Build / Live / Flow² / People / Gaps repaint
   the SAME laid-out graph — switching a lens must never reload data wholesale, re-layout
   nodes, or navigate. New "show me X on the graph" features are new lenses (or additions
   to one), not new boards.
4. **Live data arrives via Ably, not polling.** The Live lens subscribes to the workflow
   events the engine already emits (`src/lib/workflow/events.ts`); Flow² aggregates read
   `workflow_runs` / `workflow_node_stats` via TanStack Query with sane staleness. No
   `refetchInterval` loops on the canvas (Neon CU cost — the neon-cost-reviewer agent will
   flag it).
5. **Gap detection = diagnostics rules, never one-off banners.** Anything shaped like
   "warn the owner when X is misconfigured/slow/uncovered" is a rule in
   `src/lib/workflow/diagnostics.ts` returning `Diagnostic { id, severity, nodeId?, edgeId?,
   message, fix? }`, surfaced through the Issues rail and the Gaps lens. Severity contract:
   `error` blocks publish; `warning`/`info` never do.
6. **Draft-first, publish atomically.** All edits target a draft `workflow_definitions`
   version (+ linked `station_definitions`). Publish = one transaction: run blocking
   diagnostics → flip `isActive` → record actor. In-flight items finish on their old
   version. Never mutate the active version in place.
7. **Permissions:** viewing = `studio.view`, editing/publishing = `studio.manage` with
   `stepUp` on publish. Any change to `src/lib/auth/permission-registry.ts` MUST update
   `route-permission-manifest.test.ts` and pass the audit-route-auth script (the
   permission-registry-guard agent enforces this). The People lens reads staff
   access; it links to the staff editor, it never writes grants.
8. **Registries drive the UI.** Palettes, inspectors, and node rendering consume registry
   metadata (`listNodeMeta()` from `src/lib/workflow/registry.ts`, block/source/action
   registries from `src/lib/stations/`). Hard-coding a node or block type in a component is
   a bug.

## Build-order gates (do not skip ahead)

ST1 shell+zoom → ST2 Live/Flow² lenses (+`workflow_node_stats` daily snapshot cron via the
existing QStash pattern; `slaHours` lives in `workflow_nodes.config`, no schema change) →
ST3 diagnostics v1 → ST4 editable graph (hosts NODE_UI_PLAN items 1–5) → ST5 embed station
editor at L2 → ST6 People/simulate/annotations/templates. Read-only observation value ships
before any editing unlocks — this is deliberate de-risking, not an accident of scheduling.

## Checklist before merging Studio work

- [ ] Feature lives under `src/app/studio/` or `src/lib/workflow/` (not `/admin`, not a page one-off)
- [ ] New visual question = lens layer; new misconfiguration warning = diagnostics rule
- [ ] Canvas state changes are draft-scoped; publish path runs blocking diagnostics
- [ ] No polling on the canvas; Ably for live, snapshots for trends
- [ ] Numbered-state display reads `workflow-stages.ts` (and other label SoTs) — no inlined maps
- [ ] Permission registry changes paired with manifest test update
- [ ] URL state round-trips (deep link to `?focus=` works cold)
- [ ] `migrations`: any new table went through the `/db-migrate` skill flow
