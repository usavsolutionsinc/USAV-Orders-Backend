# Operations Studio — Part 2 Sequenced Roadmap

> Produced by a multi-agent current-state assessment (9 dimensions) cross-checked against the
> live code, then synthesized against the build-order gates. **Companion to `operations-studio-plan.md`.**
> Generated 2026-06-22. Status markers reflect what is **in code**, not what the older docs claim.

## 1. Executive Summary

Part 2 is **~60% already built** — far more than the docs admit. The entire read-only observation
spine (ST1 shell + L0/L1/L2 semantic zoom, ST2 Live lens via Ably, ST3 Gaps/diagnostics, ST4
editable draft→publish canvas) and the full Studio API/data model (9 routes, 6 tables) are
**shipped and working**. What remains clusters into four buckets: (a) **finish-the-edge polish on
built layers** (L3 zoom, generic config sheets, discard UI, `/admin` board retirement); (b) **the
one big un-surfaced data pipeline** — `workflow_node_stats` has been writing daily since ~Jun 11
with **zero consumers**, so Flow² is pure read-side work over data that already exists; (c) **wiring
two orphaned-but-complete subsystems together** — the station builder (`StationSlot` and friends) is
fully built but has zero importers; (d) **net-new greenfield** — People lens, simulate, annotations,
templates, the decision layer, and entitlement tiers. **Critical-path insight: almost nothing left
is "build the substrate" — it is "surface, wire, and reconcile substrate that already exists."**

## 2. Current-State Matrix

| Dimension | Status | Effort | Key gap |
|---|---|---|---|
| **ST1** Shell + semantic zoom | mostly-built | S–M | L3 block-binding zoom absent; `/admin` board duplicated not retired; `?z=2` deep-link downgrades without `?focus` |
| **ST2** Lenses | partial | L | Flow² lens missing + **no read API over `workflow_node_stats`/`workflow_runs`** (dead pipeline); People lens missing |
| **ST3** Diagnostics | built | S | Only structural/binding lint; operational rules (sla-breach/coverage/starved) deferred to ST6 |
| **ST4** Editable graph | mostly-built | S–M | Generic `configSchema`-driven node config sheet missing; no discard UI; draft/publish untested |
| **ST5** Station editor @ L2 | partial | L | `StationSlot` builder fully built but **orphaned (zero importers)**; no UI sets `workflow_node_id`; no seeded rows |
| **ST6** People/simulate/annotations/templates | missing | XL | All four absent; template tier conflicts with tenant-from-birth invariant |
| **Decision layer** (§1.6) | missing | L | No `decision` node, no rule-table store, 22 hardcoded placement sites |
| **Entitlements** (Tracker/Ops/Studio) | partial | M | Stripe billing live but tiers don't exist; `requireFeature()` enforced in 1 route; Studio gated by RBAC only |
| **Studio API surface** | mostly-built | L | Flow² read API missing; station-write-by-node missing; simulate/annotations/templates endpoints missing |

## 3. Sequenced Plan

Ordering rule: **read-only observation value ships before editing unlocks**; nothing depends on an unbuilt prerequisite.

### Phase A — ST1 finish: consolidate the observation shell (S–M, no gates)
1. Retire the `/admin` architecture board (remove `OperationsSection`/`OperationsFlowsDisplay`/`OperationsSidebarPanel` from `admin/page.tsx:47` + `AdminSidebar.tsx:37`; redirect to `/studio`; keep `operations-catalog.ts` SoT).
2. Fix `?z=2` deep-link shareability (stop downgrading `z=2 && !focus`; render an L2 "pick a node" state).
3. Add L2 entry to the sidebar View dropdown.
**Done when:** `/admin` no longer renders an ops board; cold `?z=2&focus=X` lands on L2; dropdown lists L0/L1/L2.

### Phase B — ST2 Flow² lens + metrics read API (L, **the critical unlock**, no gates)
1. `GET /api/studio/flow` reading `workflow_runs` (median/p90 time-in-node, fail-rate per port) + `workflow_node_stats` (arrivals/exits, WIP trend) + ranked bottleneck list; **add a per-node index on `workflow_runs` first**; replicate parent-verification tenant pattern.
2. Add `'flow'` to `StudioLens`; paint throughput heat by median time-in-node + edge-volume thickness; **read via TanStack Query** (Live stays Ably).
3. Inspector bottleneck ranking panel.
4. Pre-flight: confirm `node-stats` snapshots populated since Jun 11 and did not cross tenants.
**Done when:** Flow² repaints (no reload) showing median-time heat + edge thickness + bottleneck list from previously-dead data.

### Phase C — ST4 finish: generic node config + draft hygiene (S–M, gates: ST3 built)
1. Generic `configSchema`-driven config sheet (render `StudioInspector` from `NodeMeta.configSchema`). *(Shared seam — reused by decision-node + station editor.)*
2. `discardDraft` in context + Shell button + discard in manifest test.
3. Extract draft-copy + publish-flip into a `src/lib/studio` helper with injectable `Deps` + unit tests.
4. Update stale `NODE_UI_PLAN.md`.
**Done when:** every node type renders its config from `configSchema`; drafts discardable from UI + manifest-tested; publish-flip unit-covered.

### Phase D — ST5: embed station editor at L2 + node binding (L, gates: Phase C)
1. Reconcile `node.config.station` vs `station_definitions.workflow_node_id` *(decision §5.3)*.
2. Node-scoped station-write API (`PUT /api/studio/nodes/[id]/station`).
3. Refactor `StationSlot` into headless core + chrome to embed without duplicating draft/publish chrome.
4. Wire embedded editor into `StudioInspector` at z===2.
5. Seed ≥1 active `station_definition` with `workflow_node_id` (the demoable vertical slice).
6. Tests for the station-builder layer.
*(Deferred: ~11-block extraction + Cleanup Wave 3 `StationPanel` consolidation.)*
**Done when:** an owner can bind/edit/publish a station to a node at L2 and staff see it.

### Phase E — ST6: People → simulate → annotations → templates (XL, 4 PRs)
1. **People lens** — `'people'` lens, thin read aggregation of `staff_stations`/`work_assignments`, node halos + permission dimming. **Read-only** (law 7).
2. **Simulate** — pure `router.ts` against **draft** edges, **zero engine writes**; intake + outcome-script picker; ghost dot.
3. **Annotations** — sticky-note node type or `workflow_definitions.annotations` JSONB (org-scoped migration via `/db-migration-author`).
4. **Template library** — generalize the USAV-only seed into a system-owned tier *(decision §5.4)*; clone-into-tenant helper; `GET /templates` + `POST /import`; Templates group in `StudioLibrary`.
**Gates:** People→Phase D; simulate/annotations→ST4.

### Track 1 (parallel) — Decision/placement layer (L, gates: Phase C config form)
1. Register a `decision` node (`/workflow-node` skill) with an in-house evaluator `{when:{grade,channel,disposition}, then:{placement,target_table,port}}`.
2. Per-org versioned decision-table storage migration.
3. Decision-node config sheet (reuses Phase C form).
4. Thread `placement` through `applyTransition()`.
5. Strangle the 22 hardcoded placement sites one at a time with parity checks.
6. Router ambiguity guard.
**Stage 2** (`@gorules/zen-engine-wasm` + `jdm-editor`) **blocked on a Vercel runtime spike** *(decision §5.1)*.

### Track 2 (parallel) — Entitlement tiers (M, gates: Part 3 RLS + templates)
1. Decide model: extend `PLATFORM_PLANS` vs add a capability key *(decision §5.2)*.
2. Plan/feature gate hook on `withAuth`.
3. Gate Studio routes/page by plan + `FeatureGatedError`→403→upgrade UX.
4. Reconcile billing entitlements with `organization_feature_flags`.
5. Exempt the dogfood/internal org.

## 4. Parallelizable vs Blocking

**Concurrent now (no unbuilt prereqs):** Phase A, **Phase B (highest value)**, Phase C; Track 1 steps 1–2 once Phase C's config form lands.
**Sequential:** Phase D → Phase C; Phase E People → Phase D; Phase E simulate/annotations → built ST4; Track 1 Stage 2 → runtime spike; Track 2 → Part 3 RLS + Phase E.4 templates.
**Shared seam:** the generic `configSchema` form (Phase C.1) is reused by both the decision-node config sheet and the station editor — build it once, first.

## 5. Open Decisions (owner)

1. **Decision layer:** in-house Stage-1 evaluator vs `@gorules/zen-engine-wasm` (Stage 2, needs a Vercel runtime spike; native napi forbidden).
2. **Entitlement model:** extend `PLATFORM_PLANS` (Tracker/Ops/Studio) vs a capability key in the `features` map; reuse dead `automations` vs a new `studio` key.
3. **Station binding:** `node.config.station` (operations-catalog key) vs `station_definitions.workflow_node_id` — unify before Phase D.
4. **Template tier home:** sentinel/global org vs a separate template table (conflicts with `organization_id NOT NULL`).

## 6. First PR

**Build `GET /api/studio/flow` + the per-node `workflow_runs` index (Phase B.1).** Surfaces a live-but-dead
asset (daily `workflow_node_stats` snapshots nothing reads), honors the gate order (read-only observation
before editing), has zero unbuilt prerequisites, unblocks the only specced lens with no code (Flow²), and
forces an early cheap tenant-safety audit of the stats pipeline. Pair with the TanStack Query read layer and
the index in the same PR.
