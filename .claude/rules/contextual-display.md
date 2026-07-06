# Contextual display rules — master index

One house style (`ui-design-system.md`), but **four display archetypes**. Which one a surface follows is decided by
the **user's job and input model**, not by the feature area. **Pick the archetype first**, then apply the shared house
style *inside* it. Mixing two archetypes in one region — a browse list inside a station, related items where the picker
belongs, edit controls bolted onto a read-only dashboard — is the **single most common way these surfaces start to feel
wrong**.

This file is the **entry point** and the **decision algorithm**. The four archetypes and the cross-cutting motion/timeline
patterns each have a deep child doc under `display/` (see [the index](#index-of-child-docs)). Read this file to pick the
archetype; read the child doc to build it.

The discriminator, in one line: **does the region react to a *scanner*, an *observer*, a *graph*, or a *pointer*?**

---

## The decision algorithm (pick the archetype first)

A mechanical procedure for picking the archetype — run it **per region**, not per page. A page with N jobs is N
regions; each region gets exactly one archetype.

### Discriminator questions — run in order, first **yes** wins

- **Q1 — INPUT (scanner?):** Does this region react to a **scanner / keyboard-wedge / barcode / camera scan**?
  → **Station.** Scanner-driven always short-circuits; it is the single most decisive question.
- **Q2 — JOB (observe-only?):** Is the user **observing** a live/historical stream or rollup, with **no intent to edit**
  and **no durable selection** (read-only, filters are throwaway URL params)? → **Monitor.**
- **Q3 — TOPOLOGY (node-graph?):** Is the primary surface a **spatial node-graph** the user **pans / zooms / focuses**
  (semantic-zoom depths, overlay lenses, an inspector as secondary detail)? → **Canvas.**
- **Q4 — DEFAULT (pick + edit):** Otherwise the user **picks a record from a list and edits it** (durable,
  URL-addressable selection, CRUD). → **Workbench.** Workbench is the fallthrough.
- **Q5 — CARDINALITY sanity check:** one transient entity at a time → Station; many records you navigate+edit →
  Workbench; an append-only event stream you read → Monitor; a graph of nodes+edges → Canvas. If cardinality contradicts
  Q1–Q4, **re-read the JOB** — the job wins, never the feature area.
- **Q6 — RISK / PERSISTENCE:** act-and-clear (no undo trail in URL) → Station; edit-and-keep (persists via CRUD route) →
  Workbench; nothing persists (pure read) → Monitor; draft→publish of a definition → Canvas.

### Procedure

1. **Name the JOB and INPUT MODEL in one sentence** — e.g. "operator scans cartons to receive them" / "author edits a
   SKU's QC checklist" / "manager watches today's throughput" / "owner reshapes the ops graph". **Do not** start from the
   route or the feature area.
2. **Run Q1→Q4 in order; the first yes selects the archetype for THIS REGION.** Scanner → Station; observe-only →
   Monitor; node-graph → Canvas; everything else → Workbench.
3. **If a page hosts multiple jobs** (a scan bench with an inspector; a Monitor page with a clickable detail), **split it
   into regions** and run the algorithm per region. Each region obeys exactly one archetype.
4. **Instantiate the chosen archetype's scaffold** from its child doc (Station = scan bar + active card; Workbench =
   sidebar picker + right pane; Monitor = filter + `EventTimeline`/rollup; Canvas = React-Flow + inspector). **Reuse the
   named reference modules; compose rails, never fork them.**
5. **Apply the shared house style INSIDE the archetype** (`ui-design-system.md`: semantic tokens, linear scaffold,
   one-row anatomy, eyebrow+chips, `HoverTooltip`, icon pairing).
6. **Wire motion** from [`display/motion-crossfade.md`](display/motion-crossfade.md): Station crossfades the active card;
   Workbench/Monitor-detail crossfades the right pane (never the list); Canvas repaints overlays on lens/zoom (never
   crossfades the graph). Route every preset through `useMotionTransition`/`useMotionPresence` so `prefers-reduced-motion`
   is automatic.
7. **Re-check the [anti-mix rules](#choosing--not-mixing).** If any fires, you picked the wrong archetype or didn't split
   regions — go back to step 2.

### `pickArchetype()` — the decision table as code

```ts
function pickArchetype(region) {
  // region = { job, inputModel, dataShape, navigation, selection, persistence }
  if (region.inputModel === 'scanner') return 'station';        // Q1 — scanner wins
  if (region.job === 'observe' && region.persistence === 'none'
      && region.selection === 'ephemeral-or-none')
    return 'monitor';                                            // Q2 — read-only stream/rollup
  if (region.dataShape === 'node-graph' && region.navigation === 'pan-zoom-focus')
    return 'canvas';                                             // Q3 — spatial graph
  return 'workbench';                                            // Q4 — default: list→select→detail→edit
}
// A page with N jobs => split into N regions, run per region; never blend two archetypes in one region.
// On ambiguity, the JOB (observe vs edit vs act-and-clear vs reshape) decides — not the feature area or route.
```

> **Code home (operator surfaces refactor).** This algorithm is implemented in
> `src/lib/stations/archetype.ts` (`pickArchetype()` — explicit hint wins, else runs Q1→Q4). Each
> first-class operator surface declares its archetype in the closed `SURFACE_REGISTRY`
> (`src/lib/stations/surface-keys.ts`): a stable `SurfaceKey` (`unbox`, `triage`, `incoming`, …) → route
> + archetype + permission + `station_definitions` `page_key`/`mode_key`. A surface renders its legacy
> tree by default and, once an org publishes a composition + enables `surface_composed_render`, through
> the `SurfaceRenderer`/`StationSlot` host (`resolveSurface` / `SurfaceGate`). See
> `docs/todo/studio-driven-operator-surfaces-refactor-plan.md`.

---

## At a glance

| | **Station** (scan) | **Workbench** (browse/edit) | **Monitor** (observe) | **Canvas** (node-graph) |
|---|---|---|---|---|
| Driven by | a scanner | a pointer | data flowing in (poll/SSE) | pan / zoom / focus |
| Primary input | focus-locked scan bar | searchable sidebar picker | ephemeral filter params | the canvas + lenses |
| Selection | ephemeral (one at a time) | durable, URL-addressable (`?skuId=`) | none (filters only) | durable focus (`?focus=`) |
| What crossfades | the **active card** | the **right pane** (detail), not the list | the detail/drill, not the stream | overlay repaint on lens/zoom, not the graph |
| Sidebar role | minimal chrome / none | the master picker (never forked) | mode/filter rail | mode + lens rail; inspector is secondary |
| Persistence | act-and-clear | edit-and-keep (CRUD) | nothing persists (pure read) | draft → publish |
| Empty / error | "station down" is first-class | teaching empty + retryable, degrade-not-fail | empty range / no-events teaching state | empty graph / failed-version state |
| Reference modules | `StationScanBar`, `StationPacking`, `PackChecklist`, `OfflineBanner` | `ProductsWorkspace`, `QcChecklistWorkspace`, `SidebarRailShell` | `OperationsWorkspace`, `EventTimeline` | `StudioShell`, `StudioCanvas`, `StudioInspector` |
| Deep dive | [station.md](display/station.md) | [workbench.md](display/workbench.md) | [monitor-and-canvas.md](display/monitor-and-canvas.md) | [monitor-and-canvas.md](display/monitor-and-canvas.md) |

---

## The four archetypes in brief

### Station — `scan → crossfade → display`

**Scanner-driven.** A **persistent, focus-locked scan bar** pinned at the top; below it a **single "active entity" card**
that *replaces* the previous one on each scan. Minimal chrome (goal/throughput HUD). Selection is **ephemeral** — resolve
→ act → clear → re-focus for the next scan; never written to the URL. **"Station down" is first-class** — offline /
printer-down / scale-down show via `OfflineBanner` and never block the next scan. Reference modules:
`src/components/station/scan-bar/StationScanBar.tsx`, `src/components/station/StationPacking.tsx`,
`src/components/station/PackChecklist.tsx`, `src/lib/station-scan-routing.ts`, `src/lib/scan-hotkey/store.ts`,
`src/components/layout/OfflineBanner.tsx`. The mobile scan flows (`ScanInput`/`UniversalScan` on `MobileShell`) are the
**same archetype on a phone shell**, not a fifth one.

> Rule of thumb: if the input is a scanner and the operator's hands are busy, the **screen serves the scan, not the
> pointer.** Don't add browsable lists, hover-reveal detail, or persistent selection — they slow the only thing that
> matters here (the next scan). → Deep dive: [`display/station.md`](display/station.md).

### Workbench — `list → select → detail → update`

**Pointer-driven.** The **sidebar is the primary picker** — a searchable master list, the stable navigator for every mode
in the page. The **right pane is the selected record's detail/editor**, and selection is carried in the **URL**
(`?skuId=`) so every view is deep-linkable. **Compose the rail, never fork it** (`SidebarRailShell`); related/similar is
**progressive disclosure** *below* the picker, never an inverted sidebar. Empty/error must **teach and degrade** — a
failing sub-resource renders empty, it never 500s the whole record. Reference modules:
`src/components/products/ProductsWorkspace.tsx`, `src/components/products/QcChecklistWorkspace.tsx`,
`src/components/sidebar/SidebarRailShell.tsx`, `src/components/ui/HorizontalButtonSlider.tsx`,
`src/components/receiving/ReceivingRightPane.tsx`.

> Rule of thumb: if the user **picks from a list and edits**, the **sidebar is the map and the right pane is the
> workspace.** Keep the map stable; transition the workspace. → Deep dive: [`display/workbench.md`](display/workbench.md).

### Monitor — `filter → stream → read`

**Observe-only.** A full-page org-scoped **timeline / KPI rollup**; newest-first, **no edit, no durable selection**,
filters are ephemeral URL params, data flows in (poll/SSE). The Operations master page's live/analytics/history modes and
the shared `EventTimeline` history surface are the reference. Analytics must use **org-scoped inventory-events**, never
cross-tenant KPI rollups. Reference modules: `src/features/operations/workspace/OperationsWorkspace.tsx`,
`src/components/ui/EventTimeline.tsx`.

> Rule of thumb: if the user **watches and never edits**, give them a stream and a filter, not a picker. The moment a row
> grows a durable selection or an edit affordance, you've drifted into Workbench — split the region.
> → Deep dive: [`display/monitor-and-canvas.md`](display/monitor-and-canvas.md).

### Canvas — `graph → zoom/lens → focus → inspect`

**Spatial.** A React-Flow canvas (L0 department cards ⇄ L1 process nodes) with toggleable overlay **lenses** and a
**focused-node inspector** as secondary detail; read-only at low zoom tiers, editable at higher; state in
`?v=&focus=&z=&lens=`. Reference modules: `src/components/studio/StudioShell.tsx`,
`src/components/studio/StudioCanvas.tsx`, `src/components/studio/StudioInspector.tsx`, `src/app/studio/page.tsx`.

> Rule of thumb: the **graph is the map, the inspector is the workspace** — pan/zoom/focus drives everything; the lens
> repaints overlays, it never re-lays-out or crossfades the graph. → Deep dive:
> [`display/monitor-and-canvas.md`](display/monitor-and-canvas.md).

---

## Update / lifecycle algorithm (per archetype)

### Station lifecycle — `scan → resolve → set-active → re-focus → act → clear`

1. **MOUNT:** scan bar auto-focuses (last-registered scan target wins the global F2 hotkey, `src/lib/scan-hotkey/store.ts`).
   Active-card region is empty; goal/throughput HUD renders as ambient chrome.
2. **SCAN:** the focus-locked input fills from the wedge/camera; Enter resolves. Classify the raw value
   (`src/lib/station-scan-routing.ts`) → route to the domain handler.
3. **RESOLVE → SET ACTIVE:** the active card **mounts** via `AnimatePresence mode="wait"` keyed on the entity id —
   opacity + small-y only. The previous card **exits first**; never two cards on screen.
4. **RE-FOCUS:** input auto-clears and re-focuses immediately; a focus-watchdog re-grabs on blur/visibilitychange
   (modals/tab-away steal focus — the classic wedge failure mode).
5. **ACT:** scan-to-confirm gating advances only on a matching scan. Render optimistically; thread a per-scan
   `clientEventId` so a retry is an idempotent no-op (`backend-patterns.md`); reconcile on the server result. On
   409/reject, revert with a big pass/fail state, not a small toast.
6. **CLEAR:** entity is transient — resolved → acted → cleared. Selection is **ephemeral**, never URL-addressable.
7. **STATION-DOWN (orthogonal, first-class):** `OfflineBanner` is a singleton near app root; offline OR queue-depth>0
   shows it. **Degrade-not-block** — the bench keeps scanning into a durable queue; never gate a scan on infra.

### Workbench lifecycle — `mount → select → fetch → crossfade → edit → persist`

1. **MOUNT:** the picker (the stable map) renders from a search hook, composing `SidebarRailShell` — never forked. Mode
   rail (`HorizontalButtonSlider`, `variant='nav'`) reads `?view=`/`?mode=`. Right pane shows a **teaching empty state**.
2. **SELECT:** row click writes selection to the URL (`router.replace`, e.g. `?skuId=`) — durable + deep-linkable. **The
   list does not animate.**
3. **FETCH:** detail hook gates on a valid id (`enabled: id>0`). Each right-pane **sub-resource** fetches in its own
   `try/catch` + boundary: a failing sub-resource renders empty, it **never 500s** the whole record (mirror
   `get-title-by-sku`).
4. **RENDER → CROSSFADE:** the **right pane** crossfades between empty/overview and the selected detail, keyed on the
   selection id (`ReceivingRightPane` is the reference: table kept mounted, `display:none`, to preserve cache+scroll).
5. **EDIT → PERSIST:** mutations follow the house CRUD route (`withAuth → validate → domain helper → map status →
   recordAudit → after()`). Optimistic `onMutate→apply→onError(rollback)→onSettled(invalidate)`; thread `clientEventId`.
   **Deletes are confirm-then-commit, never optimistic.**
6. **STATE:** mode-scoped params clear on mode change; selection clears when the mode changes. Filters/sort/search
   **should** live in the URL too (currently partial).

**Monitor** and **Canvas** lifecycles (`filter→stream→read`, `graph→zoom/lens→focus→inspect`) live in
[`display/monitor-and-canvas.md`](display/monitor-and-canvas.md).

### Shared lifecycle rules

- A page may host multiple archetypes, but **each region obeys exactly one** — never blend two in one region.
- **Selection lives where the archetype says:** Station = ephemeral (never in URL); Workbench/Canvas = durable +
  URL-addressable; Monitor = none (filters only).
- **Crossfade target is archetype-specific and singular:** Station = active card; Workbench/Monitor-detail = right pane;
  Canvas = overlay repaint. **Never crossfade the list/map/graph itself.**
- **Backend half is shared** (`backend-patterns.md`): `transition()`/`applyTransition()` with `expectedFrom` (409 =
  conflict-safe), `clientEventId → UNIQUE(client_event_id)` idempotency, `withTenantTransaction` org scoping,
  `recordAudit`. The display archetype never reimplements these.

---

## Choosing & not mixing

- **Decide the archetype before the layout.** Run Q1→Q4 first.
- **Don't put a browsing list in a Station** — it competes with the scan focus.
- **Don't make a Station react to hover/click** — it must react to scans only.
- **Don't invert a Workbench sidebar** to hold related/similar instead of the picker — it breaks cross-mode consistency.
- **Don't crossfade a Workbench list, a Monitor stream, or a Canvas graph** — only the detail/right-pane/overlay
  transitions; the map stays put.
- **Don't bolt edit affordances onto a Monitor** read surface — the moment a row gains durable selection or a save
  action, it's a Workbench region; split it.
- **A page may host several archetypes** (a scan bench with a mini-workbench inspector; a Monitor page whose row opens a
  detail), but **each region obeys exactly one** — split a multi-job page into regions and run the algorithm per region.

---

## Shared foundation

All four archetypes inherit `ui-design-system.md` — **do not restate it here**, read it. The load-bearing inheritances:

- **Color only** from `src/design-system/tokens/colors/semantic.ts`; **z-index only** from the named scale
  `src/design-system/tokens/z-index.ts` (never `z-[NNN]`); status tones from the lifecycle/timeline tone registries.
  No invented hex, no arbitrary shades.
- **Linear vertical scaffold** (`space-y-*` / `divide-y`, `flex-1 overflow-y-auto`, `min-h-0`); **one-row anatomy**
  (title → meta → chips; selection = `bg-blue-50 ring-1 ring-inset ring-blue-400` only, **never a size shift**); eyebrow
  headers + 3-layer chips; contextual info via `HoverTooltip` (body portal, not `title=`); icons structural and paired.
- **Compose rails/shells, never fork them** — `SidebarRailShell`/`src/components/layout/SidebarShell.tsx` own the infrastructure (fetch, selection,
  grouping, keyboard nav); domain wrappers supply only renderers. Applies wherever a picker/list appears.
- **Presentation-ready values:** format via the SoT resolvers (`conditionLabel` in `src/lib/conditions.ts`,
  `get-title-by-sku`, `src/lib/source-platform.ts`, `TimelineRef` chips) server/lib-side; render dumb. **Never re-derive
  a mapping in a view** (`source-of-truth.md`).
- **Empty/error must teach and degrade** in every archetype that fetches: typed states (first-use vs no-results vs
  loading vs retryable error) + sub-resource degrade-not-fail.
- **Backend half** is `backend-patterns.md` (status via `transition()`/`applyTransition()`, `clientEventId` idempotency,
  `withTenantTransaction`, `recordAudit`). Optimistic UI sits on top of these, never replaces them.

### The motion law

One engine: `src/design-system/foundations/motion-framer.ts`. **Opacity + transform only**, `mode="wait"`,
`initial={false}` on first mount, **stable keys** (entity/`skuId`, never array index). **Never animate layout**
(width/height/padding — for height use `grid-template-rows`). The crossfade **target** is archetype-specific (active card
/ right pane / overlay), and is **singular**. Route every preset through `useMotionTransition`/`useMotionPresence`
(`src/design-system/foundations/motion-framer-hooks.ts`) so `prefers-reduced-motion` collapses slides to pure opacity
crossfades **automatically** (reduced = collapse x/y to 0 + ~0.01s, not "no motion"). Full recipe and the spring-vs-tween
split: [`display/motion-crossfade.md`](display/motion-crossfade.md).

---

## Index of child docs

Read this file to **pick** the archetype; read the child doc to **build** it. All links are relative to `.claude/rules/`.

- **[`display/station.md`](display/station.md)** — *Station display — scan → crossfade → display.* Scan-driven operator
  bench: focus-locked scan bar + single active-entity card that replaces on scan; ephemeral selection, act-and-clear,
  station-down first-class. Includes the mobile-scan variant.
- **[`display/workbench.md`](display/workbench.md)** — *Workbench display — list → select → detail → update.*
  Pointer-driven master-detail editor: stable sidebar picker + URL-addressable selection (`?skuId`) + crossfading
  right-pane CRUD; teaching empty + degrade-not-fail sub-resources.
- **[`display/monitor-and-canvas.md`](display/monitor-and-canvas.md)** — *Monitor (observe) & Canvas (node-graph).* The
  two read-mostly, URL-driven archetypes that are neither scan benches nor record editors: org-scoped observe/dashboard
  + semantic-zoom node-graph studio.
- **[`display/motion-crossfade.md`](display/motion-crossfade.md)** — *Motion / crossfade engine.* The cross-cutting
  motion law: opacity+transform-only recipe, per-archetype crossfade target, spring-vs-tween split, and the
  reduced-motion mandate — keyed to `motion-framer.ts` presets.
- **[`display/reference-timeline.md`](display/reference-timeline.md)** — *Reference timeline.* The shared read-only
  history→detail pattern (`EventTimeline` + adapters + tone registry + serial↔time toggle) that lives **inside** a
  Workbench detail pane or a Monitor page; `AuditTimeline` is the one sanctioned fork.

---

## How to add a new display surface (the recipe)

1. **Write the JOB in one sentence** — who, doing what, with what input. Ignore the route and feature area.
2. **Run `pickArchetype()`** (Q1→Q4): scanner → Station, observe-only → Monitor, node-graph → Canvas, else → Workbench.
3. **Split multi-job pages into regions** and pick per region; never blend two archetypes in one region.
4. **Open the child doc** for the chosen archetype and instantiate its scaffold from the named reference modules; compose
   rails, never fork them.
5. **Apply the shared house style inside** (`ui-design-system.md`) — semantic tokens, linear scaffold, one-row anatomy,
   eyebrow+chips, `HoverTooltip`, paired icons.
6. **Wire motion** from `display/motion-crossfade.md` — crossfade only the archetype's singular target, through the
   reduced-motion hooks.
7. **Wire the backend half** from `backend-patterns.md` (route skeleton, `transition()`/`applyTransition`,
   `clientEventId`, `withTenantTransaction`, `recordAudit`).
8. **Re-check the anti-mix rules.** If any fires, you picked wrong or didn't split regions — go back to step 2.

---

## Open questions / known gaps

- **Reduced-motion: residual raw consumers** — the workbench right panes (`ReceivingRightPane`, `TechRightPane`) now
  route through `useMotionPresence`/`useMotionTransition` and the canonical `framerPresence.workbenchPane` preset, but
  the station cards and `StationPacking` still consume presets raw. Bake the reduce-to-opacity collapse into the presets,
  or make "always go through the hook bridge" a lint-enforced rule?
- **cmd-K deep-link: FBA shipped-shipment fallback** — `?openShipmentId=` (FBA) and `?openReceivingId=` (Receiving) now
  open the record straight from cmd+k. Residual caveat: the FBA board excludes `SHIPPED`, so a cmd+k hit on an
  already-shipped shipment navigates to `/fba` but can't open its panel (there is no single-shipment fetch in the
  `FbaBoardItem` shape). Add a shipped-shipment detail fetch if that becomes a real need.
- **URL-as-state is only partial in Workbench** — selection (`?skuId`) and mode (`?view`) are in the URL, but
  filters/sort/search are often in-memory. Adopt a type-safe search-params layer and push them into the URL?
- **Studio publish gate** — should the "diagnostics gate publish" step machine-enforce archetype + house-style rules as a
  validation schema (allowed archetypes, allowed slots, semantic-token-only color), turning these prose rules into a
  publish-time check?
- **Monitor↔Workbench boundary** — Operations "insights" (AI chat) and clickable Monitor rows both flirt with Workbench;
  confirm no Monitor surface has grown durable selection or edit affordances.
- **`AuditTimeline` deliberately does not use the `EventTimeline` primitive** (separate 3-source adjacency list for
  bin/SKU). Still the right call, or should the timeline SoT absorb the `sku_stock_ledger` spine into one history
  primitive?
- **Block registry** — promote recurring compositions (`RowMetaColumns`, `CollapsibleGroupRow`, eyebrow+chips section,
  dashed empty/error box) into a named BLOCK registry so the station-builder/Studio `composition=data` can select blocks
  by id. In scope here or a separate design-system initiative?
