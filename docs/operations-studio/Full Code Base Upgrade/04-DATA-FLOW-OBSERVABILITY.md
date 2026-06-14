# Data-Flow Observability — Static Map + Live Overlay

> The owner's core ask: *"see all the different pieces of everything and all the
> different flows of data — in real time AND in a static 'this is where the data will
> flow' state."* This is two render layers over **one** canvas, not two pages.

---

## The two modes

| Mode | Question it answers | Always true? | Source |
|---|---|---|---|
| **Static map** | "Where *can* data flow? What's wired to what?" | Yes — even when idle | the **definitions** (graph + station configs + source/action registries) |
| **Live overlay** | "What's flowing *right now*? Where is it piling up?" | No — reflects this instant | the **event stream** + occupancy |

Switching between them is a **lens toggle** (Studio law: lenses repaint, never
navigate). Both paint the *same* laid-out graph fetched once per definition.

---

## 1. The static map — "this is where data will flow"

A topology you can read with nothing moving. It is derived entirely from
**definitions and registries** (no runtime data):

### What it renders

- **Sources → transforms → sinks** for the active workflow definition: each
  `NodeDefinition` is a transform; its declared `outputs[]` are the edges out; its
  bound station/data-source is where data enters.
- **The wiring catalog**, surfaced per node at L2/L3:
  - **Data sources** feeding a station block — `DataSourceDefinition.endpoint`
    (the existing GET route it wraps) + its `realtime.ablyChannel` if any.
  - **Actions** a block can fire — `ActionDefinition.endpoint` (the existing
    mutation route) + `permission`.
  - **Realtime channels** in play — from `src/lib/realtime/channels.ts`
    (`station:changes`, `inbox:{staffId}`, `db:public:item_workflow_state`, …).
  - **Tables** touched — from the route → query → table mapping.

### Where the data comes from (all already exist)

| Layer | Provides | Path |
|---|---|---|
| Workflow graph | nodes, edges, ports | `GET /api/studio/graph` → `workflow_definitions`/`workflow_nodes` |
| Node palette | type → label/icon/category/outputs | `listNodeMeta()` (`workflow/registry.ts`) |
| Station bindings | block → source → action wiring | `station_definitions.config` (`stations/contract.ts`) |
| Source/action descriptors | endpoint + channel + permission | `stations/data-sources.ts`, `stations/actions.ts` |
| Channel catalog | named Ably channels | `realtime/channels.ts` |

> **Implementation note:** the static map needs *no new backend* for v1 — it's a
> projection of definitions you already serve. Build a pure
> `buildStaticFlowGraph(definitions, registries)` selector and render it as a lens.

---

## 2. The live overlay — real-time flow

Paints motion + occupancy on top of the static topology.

### What it renders

- **Per-node occupancy:** `active` / `blocked` / `error` / `total` and
  `oldestEnteredAt` — exactly the `StudioLiveNode` shape already defined in
  `studio-types.ts`, served by `GET /api/studio/live`.
- **Edge flow:** animate the edge when a unit traverses it; particle/pulse along the
  edge direction. Intensity ∝ recent throughput.
- **Heat:** node tint by load/age (slate → blue → amber → rose as items pile up or
  age past `slaHours` from `workflow_nodes.config`).
- **Header tally:** `"{totalInFlight} in flight"` (already in the shell).

### How it stays live — Ably, never polling

The pattern is **already implemented** in `StudioShell`:

1. One fetch of `/api/studio/live` when the Live lens activates.
2. Subscribe to the CDC channel **`db:public:item_workflow_state`** event
   `db.row.changed` via `useAblyChannel`.
3. On a burst of events, **debounce 1200 ms** then re-fetch occupancy once.
4. No `refetchInterval` anywhere (Neon CU cost — the neon-cost-reviewer agent flags
   it; this is Studio law #4).

For richer per-edge animation, also tap the engine's own
`WorkflowEvent` stream (`src/lib/workflow/events.ts`: `{ serialUnitId, nodeType,
output, at }`) — emit those onto an Ably channel and animate the specific edge that
`output` corresponds to, instead of only re-deriving occupancy.

---

## 3. Trends — the Flow² lens (later)

Aggregates, not live: throughput, dwell time, SLA breach rate per node, read from
**`workflow_runs` / `workflow_node_stats`** via TanStack Query with sane staleness
(minutes, not seconds). The daily snapshot already accrues via
`src/app/api/cron/workflow-node-stats/route.ts`. Flow² is a heatmap/number overlay on
the same graph — a third lens, not a dashboard page.

---

## 4. Visual language (ties to `03-DESIGN-LANGUAGE-2026.md`)

| Element | Static | Live |
|---|---|---|
| Node | slate card, icon + numbered state | tinted by load/age; count badge |
| Edge | thin slate line | animated flow + thickness ∝ throughput |
| Source/sink | small chip on the node (channel/route icon) | pulse on new data |
| Empty step | calm slate | stays calm (0 in flight) |
| Bottleneck | — | amber/rose node + "oldest: 4h" |

Animate `transform`/`opacity` only; honor `prefers-reduced-motion` (drop particles to
a static count). Use React Flow (`@xyflow/react`) — already in the stack (the
warehouse map uses it), so live-edge custom edge types are a known quantity.

---

## 5. Build order

1. **Static map lens first** — pure projection of definitions; ships value with zero
   new backend and is correct even before any unit moves. (Fits ST1/ST2.)
2. **Live occupancy overlay** — already 80% present in `StudioShell`; formalize the
   per-node heat + edge animation. (ST2.)
3. **Per-edge animation from `WorkflowEvent`** — emit engine events to Ably, animate
   the exact traversed edge. (ST2+.)
4. **Flow² trends** — once `workflow_node_stats` has history. (post-ST2.)

### Acceptance

- [ ] With no traffic, the Static lens shows the full sources→transforms→sinks map for the active definition.
- [ ] The Live lens shows real per-node counts and updates within ~1–2 s of a scan, with **no polling**.
- [ ] A bottleneck (aged/blocked node) is visually obvious (heat + oldest-age).
- [ ] Toggling Static↔Live↔Gaps never refetches the graph or re-lays-out nodes.

_Part of the Full Code Base Upgrade spec — see README.md for the index._
