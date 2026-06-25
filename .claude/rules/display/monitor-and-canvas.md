# Monitor (observe) & Canvas (node-graph) — the two read/spatial archetypes

> Inherits: [../ui-design-system.md](../ui-design-system.md). This doc adds only the parts specific to Monitor and
> Canvas — the shared scaffold, one-row anatomy, chips, color-from-semantic-tokens, and `HoverTooltip` rules live there.

Two newer archetypes that are **neither** scan benches (Station) **nor** record editors (Workbench). They are bundled
because each is real but compact, and they share two traits that set them apart from Workbench: **read-mostly** and
**URL-driven view state**. A Workbench edits *records*; a Monitor edits *nothing*; a Canvas edits a *definition*
(draft → publish), not a record.

| | **Monitor (observe)** | **Canvas (node-graph)** |
|---|---|---|
| Driven by | filters over an incoming stream | pan / zoom / focus over a graph |
| Primary surface | full-page right pane (timeline / rollup) | `@xyflow/react` canvas |
| Selection | **none** (filters only) | durable, URL-addressable (`?focus=`) |
| What transitions | the cards/stream on first load only | the **inspector** detail, never the graph |
| Editing | none — read-only | a **definition** via draft → publish |
| URL state | `?mode= ?q= ?station= ?range=` | `?v= &focus= &z= &lens=` |
| Empty/error | teaching empty + retryable error | empty graph + per-node lint diagnostics |

---

## Archetype Monitor — observe / dashboard (`filter → stream → read`)

A user **observes** a live or historical **org-scoped** stream or rollup. Read-only, no persistent selection, filters
are ephemeral URL params; data flows *in* (poll/query), the user does not edit.

### When to choose

- **Choose Monitor when the job is "watch / review," not "edit."** The user reads an append-only event stream or a
  KPI rollup and never mutates a record. If a row needs editing, it belongs in a Workbench detail pane — not here.
- **No durable selection.** There is no `?skuId=`-style selected record; there is at most a *filter*. The whole pane is
  the view, and the view is reconstructed from the filter params alone.

### Anatomy

- **Full-page right pane, routed by `?mode=`.** `OperationsWorkspace` (`src/features/operations/workspace/OperationsWorkspace.tsx`)
  reads `useOperationsMode()` and renders one of `live | analytics | insights | history`
  (`OperationsMode` SoT: `src/components/sidebar/operations/operations-sidebar-shared.ts`). `?mode=` is the single
  source of truth, owned by the sidebar's mode rail — **never** a local `useState`.
- **Ephemeral filter band, all in the URL.** `OperationsHistoryView` (`OperationsHistoryView.tsx`) reads `?q=`
  (serial / SKU / order / notes) and `?station=` from `useSearchParams` and filters **client-side**;
  `OperationsAnalyticsView` (`OperationsAnalyticsView.tsx`) reads `?range=` (`24h | 7d | 30d`) and `?section=`
  (scroll-to anchor). Filters are throwaway view state, never a saved record.
- **Newest-first stream / rollup body.** History is a single `EventTimeline` (`src/components/ui/EventTimeline.tsx`)
  fed by `inventoryEventsToTimeline(...)`; analytics is charts + gauges + a heatmap (`MultiSeriesLineChart`,
  `GaugeDonut`, `DistributionTable`, `ActivityHeatmap`). One linear column, `flex-1 overflow-y-auto`.

### Data

- **Org-scoped event spine, NOT cross-tenant KPI rollups.** History reads `GET /api/inventory-events?limit=200`
  (`fetchEvents` in `OperationsHistoryView.tsx`); analytics reads org-scoped kpi-table + reports via
  `useOperationsAnalytics`. **Rationale:** a tenant's Monitor must show *that tenant's* facts. Wiring a Monitor to a
  cross-tenant rollup leaks other orgs' numbers — the single most dangerous mistake on this surface.
- **Poll/query inflow with a `staleTime`, not a live socket per row.** History uses `useQuery({ staleTime: 30_000 })`
  with `cache: 'no-store'` on the fetch; a failing fetch returns `[]` (`if (!res.ok) return []`) so the pane degrades
  to empty instead of throwing.

### Selection & motion

- **No persistent selection — the filter *is* the state.** Nothing in a Monitor is URL-addressable beyond the
  `?mode=`/`?q=`/`?station=`/`?range=` filters. Re-running the same filter reproduces the same view.
- **Stagger-reveal on first load; do not crossfade a list.** Analytics reveals sections with a parent/child stagger
  (`container`/`item` variants, `staggerChildren: 0.05`, ease `[0.22, 1, 0.36, 1]` in `OperationsAnalyticsView.tsx`).
  The stream/cards reveal **once**; subsequent filter changes re-render in place. **Never** crossfade the timeline rows
  on every keystroke — that is a Workbench list anti-pattern (see [../contextual-display.md](../contextual-display.md)).
- **Reduced motion is mandatory.** Route any presence through `useMotionPresence` /`useMotionTransition`
  (`src/design-system/foundations/motion-framer-hooks.ts`) so a stagger collapses to a pure opacity reveal under
  `prefers-reduced-motion`.

### Empty / error / offline

- **loaded-but-empty → a teaching empty, not "Nothing here."** `EventTimeline` takes an `emptyMessage` that reflects
  the filter (`No operations match this filter.` when `q||station`, else `No recent operations.`).
- **errored → a distinct, retryable state.** History renders the dashed `border-rose-200 bg-rose-50` error box
  (`Could not load the operation timeline.`); loading is `Loader2 animate-spin` + text. Mirror the house async/error
  states from [../ui-design-system.md](../ui-design-system.md).
- **Permission-gated sub-data degrades, it never 500s.** Analytics renders a `Locked` placeholder when the org lacks
  the reports permission (`a?.velocityAvailable` false) rather than failing the whole page.

> Rule of thumb: a Monitor is a **window, not a workbench.** If you reach for an edit affordance, a save button, or a
> persistent `?selectedId=`, you picked the wrong archetype — that data wants a Workbench detail pane.

### Update algorithm (Monitor)

1. **MOUNT:** read `?mode=` via `useOperationsMode()` and route to the matching view. Each view reads its own filter
   params (`?q=`/`?station=`/`?range=`/`?section=`) from `useSearchParams` — never local component state.
2. **FETCH:** one org-scoped query with a `staleTime` (`useQuery`, `staleTime: 30_000`); a non-OK response resolves to
   an empty array so the pane degrades, not throws.
3. **FILTER:** apply `?q=`/`?station=` **client-side** in a `useMemo` over the fetched rows; map to timeline items
   (`inventoryEventsToTimeline`) or chart series. Changing a filter re-derives in place — no refetch unless the key
   changes.
4. **RENDER:** newest-first stream (`EventTimeline`) or rollup (charts + heatmap). First load staggers in; later filter
   edits re-render without animation.
5. **NO PERSIST:** nothing is written. A "Create report" action is a client-side CSV export (`exportReport` builds a
   `Blob`), not a mutation. There is no audit, no `transition()`, no CRUD route on a Monitor.

---

## Archetype Canvas — node-graph / semantic-zoom (`graph → zoom/lens → focus → inspect`)

A user navigates a **spatial node-graph** with semantic-zoom depths and overlay lenses. Pan/zoom/focus is the input
model; an **inspector** is the secondary detail. URL carries version, focus, zoom, lens.

### When to choose

- **Choose Canvas when the primary surface is a graph of nodes + edges the user pans, zooms, and focuses** — not a
  list, not a scan stream. The Operations Studio (`src/app/studio/page.tsx` → `StudioShell`) is the only instance:
  the whole operation is one graph.
- **Editing is of a *definition*, not a record.** A Canvas reshapes a workflow **definition** behind a
  **draft → publish** gate. Low tiers / non-managers are read-only; that is a *feature* of the archetype, not a bug.

### Anatomy

- **`@xyflow/react` canvas with semantic zoom.** `StudioCanvas` (`src/components/studio/StudioCanvas.tsx`) renders one
  React Flow surface at two depths: **L0** department group cards (`buildBusinessMap`) ⇄ **L1** process nodes with
  numbered lifecycle states (`buildFlowGraph`, `workflow-stages` order/label, rendered ①②③). Double-click a department
  dives L0→L1; double-click a process node opens its station (`z: '2'`).
- **Overlay lenses as a toggle, not separate pages.** A `lens` (`live | flow | people | gaps | static`) repaints
  *overlays* onto the same nodes/edges — `live` paints occupancy + flow pulses, `flow` paints throughput metrics,
  `people` paints coverage, `gaps` paints lint severity. The graph topology is identical across lenses.
- **Right inspector = secondary detail.** `StudioInspector` (`src/components/studio/StudioInspector.tsx`) summarizes
  the definition with no focus, and shows the focused node's identity / station / lifecycle states / ports / config /
  diagnostics when a node is picked. It is a `w-72` `border-l` aside, collapsible, mounted by `StudioShell`.

### State

- **URL carries the whole *view*: `?v= &focus= &z= &lens=`.** `StudioShell` (`src/components/studio/StudioShell.tsx`)
  persists version, focused node, zoom depth, and lens in `searchParams` via `setParams`, so **every view is
  shareable** (`?v=&focus=&z=&lens=` — see the `StudioShell`/`studio/page.tsx` headers). Selection here is **durable
  and URL-addressable**, the opposite of a Station.
- **Workspace *preferences* go to `localStorage`, not the URL.** Inspector-open and Simulate-open are
  `useLocalStorage('studio:inspector-open', …)` / `('studio:simulate-open', …)` — they are not part of a shareable
  view, so they stay out of `searchParams`.
- **Editing is gated: draft → publish.** Published definitions are fully read-only (`editable=false` everywhere).
  `canManage` + an explicit "Edit as draft" create a draft; mutations (`onGraphChange`, `onUpdateNodeConfig`,
  `onDeleteNode`, annotations) flow **up** to the shell which owns the canonical draft; `saveDraft` / `publish` /
  `discardDraft` (confirm-then-commit) are the only persistence. A Simulate run is a pure client-side dry-run — **zero
  engine writes**.

### Motion

- **Repaint overlays on lens/zoom change; NEVER crossfade the canvas.** Lens switches recompute the overlay maps
  (`liveMap`/`flowMap`/`peopleMap`/`gapsByNode`) but explicitly leave the React Flow surface alone — the canvas `key`
  is `` `${zoom}-${editable?'edit':'view'}` `` (re-fits only on depth/mode change; **lens switches never touch this**,
  per the `StudioCanvas` comment). Animating the graph itself would destroy the user's pan/zoom and node identity.
- **Only the inspector detail transitions.** When focus changes, the inspector swaps its body; the graph stays put.
  Treat the inspector swap like a Workbench right-pane crossfade — opacity + small-y, `mode="wait"`, stable key on the
  focused node id — and route it through `useMotionPresence`/`useMotionTransition`
  (`src/design-system/foundations/motion-framer-hooks.ts`).

### Empty / error / diagnostics

- **No definition → teach the next step.** `StudioShell` renders `No workflow definition yet — seed one to see your
  operation here.` (not a bare blank), and `Loading the operations graph…` while fetching; a load error renders a
  rose error line.
- **Per-node lint, not a hard fail.** The `gaps` lens and the inspector's **Issues** section surface `Diagnostic`
  findings per node (`error`/`warn` with an optional `fix`), so a malformed graph teaches the manager what to fix
  instead of crashing. Coverage gaps under the `people` lens deep-link to the staff editor — read-only here.

> Rule of thumb: the **graph is the map and the inspector is the workspace.** Keep the map stable (pan/zoom/identity);
> transition only the inspector. If you find yourself crossfading nodes or storing focus in `useState`, you are
> fighting the archetype.

### Update algorithm (Canvas)

1. **MOUNT:** `StudioShell` hydrates the graph + view from `?v=&focus=&z=&lens=`; inspector/simulate open-state from
   `localStorage`. No definition → teaching empty; loading → spinner text.
2. **NAVIGATE:** pan/zoom is React Flow's; **focus** writes `?focus=` (`onFocus → setParams`), **zoom depth** writes
   `?z=`, **lens** writes `?lens=`. Every navigation is a URL change → shareable + reload-safe.
3. **RENDER OVERLAYS:** the active `lens` recomputes overlay maps and repaints node decorations; the canvas surface and
   node identities are untouched (stable `key`).
4. **INSPECT:** focus selects a node; `StudioInspector` renders its detail (states / ports / config / diagnostics). The
   inspector body transitions; the graph does not.
5. **EDIT (draft only):** `canManage` + "Edit as draft" → `createDraft`. Node/edge/config/annotation mutations flow up
   via `onGraphChange`; the shell holds the canonical draft and marks it `dirty`.
6. **PERSIST:** `saveDraft` → `publish` (or `discardDraft`, confirm-then-commit). Published = read-only again. Backend
   mutations follow the house route pattern (`withAuth → validate → domain helper → recordAudit → after()`; see
   [../backend-patterns.md](../backend-patterns.md)). Simulate never persists.

---

## Shared read/spatial traits — and the line vs Workbench

- **Both URL-drive their view.** Monitor's `?mode=/?q=/?station=/?range=` and Canvas's `?v=&focus=&z=&lens=` are the
  state SoT; a reload or a shared link reproduces the exact view. This is the trait that separates them from a Station
  (whose selection is ephemeral and never URL-addressable).
- **Both are read-mostly.** A Monitor edits **nothing**; a Canvas edits a **definition** behind draft → publish, not a
  per-record CRUD form. Neither is a Workbench — Workbench's job is "pick a record from a list and edit *that record*"
  with a stable sidebar picker + a crossfading right pane.
- **Org-scope is non-negotiable on a Monitor.** Read the tenant's own event spine
  (`/api/inventory-events`, org-scoped analytics), never a cross-tenant KPI table.

Industry references — the same ideas under their standard names: a Canvas is a **master–detail interface** (graph = master,
inspector = detail) with **semantic zoom**; a Monitor is a filtered, read-only **dashboard** over an event stream.
Motion on both follows the "swap the detail, keep the navigator stable" rule from Material's shared-axis / container
transforms, and degrades slides to crossfades under reduced motion (WCAG 2.3.3). Background, naming, and rationale:

- Master–detail interface — <https://en.wikipedia.org/wiki/Master%E2%80%93detail_interface>
- Material 3 — applying transitions (keep the navigator, transition the content) — <https://m3.material.io/styles/motion/transitions/applying-transitions>
- Linear — designing for the AI age (read-mostly, URL-as-state, ambient observation) — <https://linear.app/now/design-for-the-ai-age>

---

## Anti-patterns (do not)

- **Don't bolt edit controls onto a Monitor read surface.** No inline save, no per-row `?selectedId=` editor. If the
  data needs editing, route it to a Workbench detail pane — the Monitor stays a window.
- **Don't feed a Monitor cross-tenant rollups.** Org-scoped event spine only. A cross-tenant KPI table on a tenant's
  Operations page leaks other orgs' numbers.
- **Don't crossfade (or re-`key`) the graph on a lens/zoom-overlay change.** Repaint overlays; keep the React Flow
  surface, pan/zoom, and node identity stable. Only the inspector detail transitions.
- **Don't allow freeform, un-validated graph composition.** Edits are draft-only, flow up to the shell, and surface
  per-node lint `Diagnostic`s before publish — never publish a graph the diagnostics gate rejects.
- **Don't crossfade a Monitor's timeline rows on every keystroke** (a Workbench-list anti-pattern), and **don't store
  Canvas focus/zoom/lens in `useState`** — they belong in the URL.

---

Indexed by [../contextual-display.md](../contextual-display.md).
