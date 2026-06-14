# Phased Implementation Plan

> File-level, gated, incremental. Honors the `ops-studio` build-order gates
> (**ST1→ST6**) and extends them to the full modular vision. **Read-only observation
> value ships before any editing unlocks** — deliberate de-risking.

---

## Where we are

- **ST1 (shell + zoom): shipped.** `src/app/studio/page.tsx` + `StudioShell` (three
  panes, `?v=&focus=&z=&lens=`, Build/Live/Gaps lenses, draft→publish with step-up +
  blocking diagnostics, Ably live via `db:public:item_workflow_state`, no polling).
- **Engine (L4): built.** `src/lib/workflow/` (registry, contract, diagnostics,
  router, advance, runtime, store, events, node-stats).
- **Stations (L2): built (S1 + S3-lite).** `src/lib/stations/` + `station_definitions`
  + Receiving Incoming pilot.
- **Studio tab:** already in **More** (`sidebar-navigation.ts`, `kind:'bottom'`),
  excluded from the rail, mobile-restricted. Done.

---

## The phases

Each phase lists: **Goal · Files · Migrations · Guardrails · Acceptance · Ships (observable value).**

### Phase A — Static Flow Map + occupancy hardening (ST2)
- **Goal:** the canvas reads as "all the pieces + where data flows," with a real-time occupancy overlay. Pure observation; no editing changes.
- **Files:** `src/components/studio/StudioCanvas.tsx` (Static lens render + edge/node heat); new `src/lib/studio/static-flow-graph.ts` (pure projection of definitions + registries); `src/components/studio/StudioShell.tsx` (add Static toggle to lens bar); `src/lib/workflow/events.ts` (emit to Ably for per-edge animation).
- **Migrations:** none (projection of existing definitions; occupancy already served by `/api/studio/live`).
- **Guardrails:** lenses repaint only; **no `refetchInterval`** (neon-cost-reviewer); numbered states from `workflow-stages.ts`.
- **Acceptance:** with zero traffic the Static lens shows sources→transforms→sinks; Live updates within ~1–2 s of a scan with no polling; bottlenecks visibly heat.
- **Ships:** the owner can *see* the whole operation, live and static, today.

### Phase B — Flow² trends (post-ST2)
- **Goal:** throughput / dwell / SLA-breach overlay.
- **Files:** `src/components/studio/StudioCanvas.tsx` (Flow² lens), `src/lib/workflow/node-stats.ts`, `src/app/api/studio/` (a trends route reading `workflow_node_stats`); confirm `src/app/api/cron/workflow-node-stats/route.ts` snapshot.
- **Migrations:** none if `workflow_node_stats` exists; otherwise via `/db-migrate`.
- **Guardrails:** TanStack Query staleness in minutes; reads snapshots, not live rows.
- **Acceptance:** Flow² shows per-node throughput + SLA breach for a chosen window; enabling it flips the disabled lens on in `StudioShell` `LENSES`.
- **Ships:** trend diagnosis without leaving the canvas.

### Phase C — Diagnostics v1.5 (ST3, widen)
- **Goal:** richer gap rules incl. composition gaps (pre-pages).
- **Files:** `src/lib/workflow/diagnostics.ts` (+`.test.ts`).
- **Guardrails:** every gap is a `Diagnostic` (Issues rail + Gaps lens); `error` blocks publish, `warning`/`info` never do.
- **Acceptance:** a draft with an unreachable node / unmapped required role / missing terminal cannot publish; the rail explains each with a `fix`.
- **Ships:** the owner can't publish a broken operation.

### Phase D — Station editor embedded at L2 (ST5; finish the pilot)
- **Goal:** clicking a node opens its bound station builder in the Inspector; finish Receiving Incoming (dnd drag, attach-tracking action), then compose one more low-risk mode.
- **Files:** `src/components/studio/StudioInspector.tsx` (host the builder at L2), `src/lib/stations/blocks/*` (any missing blocks), `src/lib/stations/actions.ts` (attach-tracking), the Config Sheet component.
- **Migrations:** none (uses `station_definitions`).
- **Guardrails:** blocks=code, composition=data; renderers delegate to label SoTs; `'legacy'` fallback for unmigrated modes.
- **Acceptance:** an owner arranges the Incoming station's blocks as a draft and publishes; a second mode is composed-from-data; all others remain `'legacy'`.
- **Ships:** real editing of a real station, safely.

### Phase E — Pages-as-data (`page_definitions` + `PageRenderer`)
- **Goal:** one flagship page mode renders from data.
- **Files:** new migration for `page_definitions`; new `src/lib/pages/contract.ts` + `PageRenderer`; wire one mode (e.g. a History/Pulse view) to read its definition; `'legacy'` for the rest.
- **Migrations:** `page_definitions` (copy `workflow_definitions` shape) — via `/db-migrate`.
- **Guardrails:** identical versioned/draft/publish semantics; permission-by-construction (blocks only render for permitted viewers); no route renamed.
- **Acceptance:** the chosen mode renders from a `page_definitions` row; flipping to `'legacy'` restores the old tree; deep-link `?v=` pins a version.
- **Ships:** proof that arbitrary pages can be composed, not coded.

### Phase F — Nav-as-data + People/Simulate/Templates (ST6)
- **Goal:** the nav becomes an editable override; People lens; dry-run simulate; seed templates.
- **Files:** `src/lib/sidebar-navigation.ts` (+ optional `nav_definitions` override loader), `StudioCanvas.tsx` (People lens, simulate), a templates catalog.
- **Migrations:** optional `nav_definitions` — via `/db-migrate`.
- **Guardrails:** People lens reads staff access, never writes grants; simulate runs against the draft, never live data.
- **Acceptance:** owner re-groups nav as a draft + publishes; People lens shows who works each station; simulate previews a unit's path on a draft.
- **Ships:** the operation's *structure* (nav, staffing, layout) is owner-editable.

---

## Risk register

| Risk | Mitigation |
|---|---|
| Neon CU blowup from canvas polling | No `refetchInterval`; Ably + debounced refetch; neon-cost-reviewer agent gates DB-touching diffs. |
| Big-bang page rewrite | `'legacy'` escape hatch; migrate one mode at a time behind parity checks. |
| Permission holes in composed pages | Blocks render only for permission holders (contract-enforced); diagnostics flag mismatches. |
| Publishing a broken op | Blocking `error` diagnostics inside the activation transaction; step-up. |
| Version sprawl / confusion | One canonical URL + `?v=` pin; active is the default; switcher labels `(active)`/`(draft)`. |
| Label drift | All numbered/grade/platform labels read their SoTs; never inline a map. |
| Permission-registry test drift | Any `permission-registry.ts` edit pairs with `route-permission-manifest.test.ts`; permission-registry-guard agent enforces. |

---

## The next 5 PRs (small, ordered, concrete)

1. **`feat(studio): static flow-map lens`** — add `src/lib/studio/static-flow-graph.ts` (pure projection) + a `Static` toggle in `StudioShell` `LENSES` + render in `StudioCanvas`. *Accept:* idle canvas shows full sources→transforms→sinks for the active definition.
2. **`feat(studio): live node heat + oldest-age`** — formalize per-node tint/heat from the existing `StudioLiveNode` occupancy + `slaHours`. *Accept:* an aged/blocked node is visually obvious; still no polling.
3. **`feat(studio): per-edge flow animation from WorkflowEvent`** — emit `workflow/events.ts` events to an Ably channel; animate the traversed edge. *Accept:* a scan visibly pulses the exact edge within ~1–2 s.
4. **`feat(studio): embed station builder in Inspector at L2`** — `StudioInspector` hosts the station Config Sheet for the focused node's bound station. *Accept:* selecting the Receiving node opens its block layout; draft edits re-lint live.
5. **`feat(diagnostics): composition gap rules`** — add unmapped-required-role / unreachable-node / dangling-action rules to `diagnostics.ts` (+ tests). *Accept:* a draft with any of these can't publish and the rail explains the fix.

---

## Build-order gate (do not skip ahead)

`ST1 shell+zoom ✅ → ST2 Live/Flow² (Phases A,B) → ST3 diagnostics (Phase C) → ST4
editable graph → ST5 station editor at L2 (Phase D) → pages-as-data (Phase E) → ST6
People/simulate/nav (Phase F).` Observation value (A) ships before any new editing.

_Part of the Full Code Base Upgrade spec — see README.md for the index._
