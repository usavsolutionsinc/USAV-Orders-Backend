# Operations Studio — the owner's full-page environment for building, inspecting & tuning the whole operation

> **Status:** Design plan. Sits **above** `NODE_WORKFLOW_ARCHITECTURE.md` (engine),
> `NODE_UI_PLAN.md` (editable canvas mechanics), and `station-builder-ui-plan.md` (block
> composition). Those documents remain the layer specs; this one defines the **product** that
> unifies them.
> **Reframe vs. earlier docs:** the canvas is not a feature bolted onto pages, and the station
> builder is not a standalone tool. The Studio is a dedicated top-level page — the business
> owner's primary environment — where the *entire* operations tree is modeled, edited,
> observed, and diagnosed. Per-page customization (the pencil edit-mode in the station-builder
> plan) survives only as a shortcut that deep-links into the Studio focused on that node.

---

## 0. What the Studio is

One full-screen page (`/studio`; promote today's read-only Operations *section* on `/admin`
out into it) with a persistent three-pane layout:

```
┌─ Library ─┬────────────────── Canvas (React Flow) ──────────────────┬─ Inspector ─┐
│ search    │   ┌────────────────────────────────────────────────┐    │ context-    │
│ Nodes     │   │  ╔═ RECEIVING ═══════╗   ╔═ TESTING ═══╗        │    │ sensitive:  │
│ Stations  │   │  ║ ①Expected→②Scanned║──▶║ ④Await ⑤Test ║─pass─▶ │    │ · node cfg  │
│ Blocks    │   │  ║ →③Unboxed         ║   ║      fail──╮ ║        │    │ · station   │
│ Sources   │   │  ╚═══════════════════╝   ╚════════════│═╝        │    │   editor    │
│ Actions   │   │        ╔═ LISTING ═╗   ╔═ FULFILL ═╗  ▼          │    │ · metrics   │
│ Templates │   │        ╚═══════════╝   ╚═══════════╝ ╔═REPAIR═╗  │    │ · issues    │
│           │   │  [minimap]                            ╚════════╝  │    │ · staff     │
├───────────┤   └────────────────────────────────────────────────┘    ├─────────────┤
│ ⚠ Issues 7│    Lens bar: [Build] [Live] [Flow²] [People] [Gaps]     │ Draft ▸ Publish│
└───────────┴──────────────────────────────────────────────────────────┴─────────────┘
```

Four ideas make it "the main way to run the business" rather than a diagram viewer:

1. **Semantic zoom** — one canvas, four depths (business map → flow graph → station →
   block binding). You never leave the page to go deeper; detail is a zoom level.
2. **Lenses** — the same graph re-colored by what you're asking: build/edit, live WIP,
   throughput & bottlenecks, staffing & permissions, gaps. Same nodes, different paint.
3. **A diagnostics engine** — the "Issues" rail is a *linter for the operation*: unwired
   fail ports, states with no exit, nodes nobody is permitted to work, sources never synced.
   Gaps are surfaced automatically, not hunted visually.
4. **Draft → publish** — every edit happens on a draft version of the graph; publishing is
   atomic and in-flight items finish on their old version (semantics already specified in
   the engine docs; the Studio is just the first real client of them).

---

## 1. Semantic zoom — the four depths

React Flow supports parent/child (group) nodes and viewport-driven rendering; depth is a
function of zoom + selection, persisted in the URL (`/studio?v=12&focus=node_recv_unbox&z=2`)
so any view is shareable/bookmarkable.

### L0 — Business map (zoomed out)
Departments as **group nodes**: Receiving, Testing/QC, Repair, Listing, Fulfillment (orders /
FBA / pickup), Returns & Warranty. Inside each group only a count strip renders ("4 stations
· 38 items in flight · ⚠2"). Edges between groups are aggregate flows with **volume-weighted
thickness** (7-day item counts from `workflow_runs`). This is the view an owner shows an
investor or a new hire: the whole company on one screen.

### L1 — Flow graph (the working altitude)
Zooming into a group (or double-clicking it) expands its members: **process nodes** with
their output ports (`pass`/`fail`/`done`) and **numbered states on the nodes themselves** —
the existing stage registries rendered as `① EXPECTED ② ARRIVED ③ MATCHED…` (the
`order` field in `workflow-stages.ts` is already this; the Studio finally displays it the
"1-2-3-4-5 + name" way). Edges carry the transition label (which output port fires it).
Cross-department edges (Testing `fail` → Repair, Repair `done` → Testing) render as the
rework loops they are — visible cycles instead of buried branching code.

### L2 — Station detail (a node, opened)
Selecting a node slides the **Inspector** into station mode: the four-slot anatomy
(trigger / queue / workspace / advance) from `station-builder-ui-plan.md`, with that doc's
palette-drag and block list embedded *as the node's detail editor*. The canvas dims around
the focused node and draws its **in/out contract**: which states enter, which states leave
on which port. This is where "selecting a page or process to edit" used to be a separate
flow — now it's just L2 of the same canvas.

### L3 — Block binding
Clicking a block inside L2 opens the Source / Display / Actions config sheet (unchanged from
the station-builder plan). Deepest level; still never left the page.

**Library pane follows depth:** at L0–L1 it offers process/logic/integration *nodes* and
flow *templates*; at L2 it switches to *blocks*; at L3 it shows compatible *sources* and
*actions*. One pane, depth-appropriate contents — this replaces three separate palettes.

---

## 2. Lenses — one graph, five questions

A horizontal lens bar above the canvas (the existing Operations section's `Lens` chip state
in `OperationsSidebarPanel.tsx` is the embryo of this). Lenses are **render layers, not
pages** — switching never reloads or re-lays-out the graph, so spatial memory holds.

| Lens | Paints | Data | Answers |
|---|---|---|---|
| **Build** | Default editor chrome: ports, handles, drag affordances, draft-diff badges (added/changed/removed vs. published) | `workflow_definitions/nodes/edges` + `station_definitions` | "What is the flow?" |
| **Live** | A pulsing dot per in-flight item at its current node (Ably-driven `ItemTracker` from NODE_UI_PLAN §6), WIP count badge per node, items aging > threshold tinted amber | `item_workflow_state` + Ably | "Where is everything *right now*?" |
| **Flow²** (throughput) | Heat: node fill by median **time-in-node**; edge thickness by 7/30-day volume; a ranked bottleneck list in the Inspector ("Testing: median 2.1d, p90 6d, queue 14 — worst stage") | `workflow_runs` (`durationMs`, timestamps) + queue-depth snapshots (§4) | "Where does work pile up?" |
| **People** | Node halo = staff/stations assigned (avatars); selecting a staff member dims every node they can't act on (their permission set intersected with node block permissions) — the owner literally *sees* each person's slice of the operation | `staff_stations`, `work_assignments`, permission registry | "Who covers what? What does Maria's job look like?" |
| **Gaps** | Diagnostic markers (⚠/✖) on offending nodes/edges/ports; Issues rail expands with the full list | Diagnostics engine (§3) | "What's broken, unwired, or uncovered?" |

Lenses compose with zoom: Flow² at L0 shows which *department* is the bottleneck; at L1,
which *station*; at L2 (future) which *step* inside the station.

---

## 3. The diagnostics engine — gaps as a linter, not an easter-egg hunt

`src/lib/workflow/diagnostics.ts` (new): pure functions over the draft graph + registries +
live metrics, returning `Diagnostic[] { id, severity, nodeId?, edgeId?, message, fix? }`.
Runs client-side on every draft edit (it's cheap graph analysis) and server-side on publish
(blocking errors prevent publish; warnings don't).

**Structural rules** (graph shape):
- `unwired-port` — a declared output (e.g. `fail`) with no edge: items reaching it strand. **Error.**
- `dead-end-state` — non-terminal node with no outgoing edges. **Error.**
- `unreachable-node` — no path from any intake node. **Warning.**
- `orphan-rework-loop` — cycle with no exit to a terminal state. **Error.**
- `version-strand` — published-version nodes deleted in draft while items sit on them
  (publish requires a migration choice: finish-on-old vs. bulk-move). **Error at publish.**

**Binding rules** (station/block config):
- `unbound-block` — block with no data source, or source whose integration is disconnected. **Error.**
- `stale-source` — bound source hasn't synced within its declared cadence (e.g. Gmail pile
  cron failing → the checklist silently empties). **Warning, shows last-sync age.**
- `action-permission-vacuum` — block exposes an action no *currently active* staff member
  has permission to perform. **Warning.** (This is the "one person combines shipments and
  they quit" gap.)
- `label-sot-violation` — a config references a status/condition value absent from the
  registries (`workflow-stages.ts`, `conditions.ts`). **Error.**

**Operational rules** (need metrics, evaluated server-side on a cadence):
- `sla-breach` — median time-in-node exceeds the node's configured SLA (`config.slaHours`). **Warning → Issues rail + optional header-inbox alert.**
- `starved-node` — node had assigned staff activity but zero arrivals for N days while
  upstream volume exists (suggests a routing gap upstream). **Info.**
- `coverage-gap` — node's working hours (from assignments) leave a window with no
  permitted staff. **Info.**

The Issues rail groups by severity, supports click-to-focus (pans/zooms the canvas to the
offender), and each diagnostic with a `fix` renders a one-click affordance ("wire `fail` →
Repair?", "open staff access for `fba.combine`"). This is the feature that makes the Studio
*introspective* rather than just editable.

---

## 4. Bottleneck analytics — what the data layer needs

Mostly already there; two small additions:

1. **Have:** `workflow_runs` (per-node execution log w/ `durationMs`, org+created index) and
   `item_workflow_state` (`enteredNodeAt`) → time-in-node = `now/exit − enteredNodeAt`;
   medians/p90s by node over any window are simple aggregates.
2. **Add: queue-depth snapshots.** A small cron (existing QStash pattern) writes
   `workflow_node_stats { nodeId, date, arrivals, exits, wip, medianMs, p90Ms }` daily.
   Point-in-time WIP is computable live, but *trend* lines ("Testing queue grew 40% this
   month") need the snapshot history. One table, one cron, no per-event writes.
3. **Add: per-node SLA config** — just a `slaHours` key in `workflow_nodes.config`; no schema
   change.

Inspector metrics tab per node: WIP now, arrivals/exits sparkline, time-in-node distribution,
fail-rate per output port (e.g. "18% of Testing exits take `fail`"), top stuck items (click →
the unit's existing timeline). Department-level rollups power the L0 heat.

---

## 5. Editing model & safety

- **Draft-first, always.** Opening the Studio in Build lens forks (or resumes) a draft of the
  active `workflow_definitions` version + linked `station_definitions`. The canvas shows
  draft-diff badges. Publish = single transaction flipping `isActive`, running blocking
  diagnostics, and recording who/when. Discard is free.
- **Simulate** (pre-publish confidence): a "ghost run" panel — pick an intake node and an
  outcome script ("fails inspection once, then passes") and watch a ghost dot walk the draft
  graph, listing each state transition `②→③→④…` it would record. Pure `router.ts`
  evaluation against the draft edges; no engine writes. Cheap to build, huge trust win.
- **Annotations** — sticky-note nodes (no engine meaning) so owners can mark known gaps and
  intentions on the map itself ("hiring for this station Q3"). Persisted in the definition;
  diagnostics can reference them ("⚠ near your note").
- **Permissions:** Studio viewing = new `studio.view`; editing/publishing = `studio.manage`
  (+ existing `stepUp` on publish, since publish changes how the whole floor works). The
  People lens reads but never writes staff access — it deep-links to the existing staff
  editor.
- **Templates:** the Library's Templates group ships the seeds from the node plan ("Standard
  refurb-and-list", "Test-only consignment", "Returns triage") as importable subgraphs —
  drop one into an empty org and rename, which is the small-business onboarding story.

---

## 6. What exists vs. what's new

| Piece | Status |
|---|---|
| Engine: registry / runtime / router / advance / store | ✅ built (`src/lib/workflow/`) |
| Tables: `workflow_definitions/nodes/edges`, `item_workflow_state`, `workflow_runs` (+durationMs) | ✅ in schema |
| Read-only board + lens chips + ops catalog | ✅ embedded in `/admin` (`OperationsFlowsDisplay`, `OperationsSidebarPanel`, 570-line catalog) — becomes the Studio's seed |
| `/api/workflow/flow-audit` | ✅ exists (audit data source) |
| React Flow, dnd-kit, Ably, RightPaneOverlay, design system | ✅ deps satisfied |
| Dedicated `/studio` route + three-pane shell | 🆕 |
| Group nodes (departments) + semantic zoom + URL state | 🆕 |
| Lens bar as render layers (Build/Live/Flow²/People/Gaps) | 🆕 (Live = NODE_UI_PLAN ItemTracker; Flow²/People/Gaps new) |
| Diagnostics engine + Issues rail | 🆕 |
| `workflow_node_stats` snapshot cron + `slaHours` | 🆕 |
| Draft/publish UI + simulate + annotations | 🆕 (semantics specced in engine docs) |
| Station editor embedded at L2 | = `station-builder-ui-plan.md` S1–S3, re-homed into the Inspector |

---

## 7. Phasing (each phase independently shippable)

| Phase | Ships | Size |
|---|---|---|
| **ST1. Studio shell** | `/studio` route, three-pane layout, migrate the read-only board out of `/admin`, L0/L1 zoom with department groups, URL focus state | ~4–5d |
| **ST2. Live + Flow² lenses** | ItemTracker dots (Ably), WIP badges, `workflow_node_stats` cron, time-in-node heat, Inspector metrics tab, bottleneck ranking | ~5–6d |
| **ST3. Diagnostics v1** | `diagnostics.ts` structural + binding rules, Issues rail, click-to-focus, Gaps lens | ~4–5d |
| **ST4. Build lens (editable graph)** | = NODE_UI_PLAN items 1–5 hosted in the Studio: palette, connect/move/save, node config, draft/publish with blocking diagnostics | ~6–8d |
| **ST5. L2 station editing** | Station-builder S1–S3 embedded in the Inspector; per-page pencil becomes a deep-link to `/studio?focus=…` | rides station-builder estimates |
| **ST6. People lens + simulate + annotations + templates** | staffing overlay, ghost-run, sticky notes, template import; operational diagnostics (SLA/coverage) | ~5–7d |

Recommended order rationale: **observe before edit** (ST1–ST3 are read-only and immediately
expose real bottlenecks/gaps on live data — daily-driver value with zero operational risk),
then unlock editing (ST4) once the owner already trusts the picture, then deepen (ST5–ST6).

---

*Layer map: Studio (this doc) → station composition (`station-builder-ui-plan.md`) → canvas
mechanics (`NODE_UI_PLAN.md`) → engine & schema (`NODE_WORKFLOW_ARCHITECTURE.md`,
`NODE_WORKFLOW_IMPLEMENTATION_PLAN.md`).*
