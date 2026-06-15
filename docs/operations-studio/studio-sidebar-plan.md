# Studio Sidebar — the command-rail expansion plan

> Layer-1 (Studio) companion to `operations-studio-plan.md`. Scope: the `/studio`
> **left sidebar only** — what it shows, how it adapts, and how it grows into the
> Studio's single command surface. Canvas mechanics live in `NODE_UI_PLAN.md`;
> the engine in `NODE_WORKFLOW_*`; blocks in `station-builder-ui-plan.md`.

---

## 0. Where we are (2026-06-13)

The Studio's whole left chrome was just consolidated into **one** master-nav
panel so the canvas runs full-width:

- **`StudioSidebarPanel`** (master-nav body for `/studio`) = a combined **View
  dropdown** (lens · zoom) → the node **Library** → the **Issues** rail.
- **`StudioShell`** (page body) = full-width canvas / station preview + a
  **collapsible** Inspector aside (localStorage-persisted).
- **`StudioWorkspaceContext`** (mounted in `app/layout.tsx`) is the single owner
  of all studio client state; the sidebar and the canvas are sibling consumers.
- The panel's own "STUDIO" header was removed — `MasterNavHeader` already renders
  the route title + nav dropdown chevron.

See memory `studio-sidebar-consolidation`. This doc plans what comes next.

### The gap
The sidebar body is still **static**: it shows the same node Library + Issues no
matter the zoom depth or active lens. But the canonical plan already calls for a
sidebar that *follows depth* (operations-studio-plan.md §1: "Library pane follows
depth"), and each lens asks a different question that wants different tools. The
sidebar is doing one job; it should be the Studio's **command rail**.

---

## 1. North star — the sidebar is the Studio's command rail

One principle: **everything you do *to* the graph originates in the rail;
everything you learn *about* the graph that isn't spatial surfaces in the rail.**
The canvas stays the single focus; the rail is how you reach for tools and read
non-spatial state.

Concretely, the rail body becomes a **stack of sections chosen by `(zoom × lens ×
editing)`**. Switching a lens or zoom **re-selects which sections render** — it
never refetches or re-lays-out the graph (Studio law #3). Everything a section
needs comes from `StudioWorkspaceContext`; a new feed is added to the context
(one fetch, shared), never fetched ad-hoc inside a section (Neon/Ably discipline,
law #4).

---

## 2. Architecture

### 2.1 A section registry (law #8 — registries drive the UI)

```ts
// src/components/studio/sidebar/sections.ts
export interface StudioSidebarSection {
  id: string;
  title: string;
  /** Which (depth, lens, editing) combinations show this section. */
  visibleAt: (s: { z: StudioZoom; lens: StudioLens; editing: boolean }) => boolean;
  /** Pure render from the shared workspace value — no own fetches. */
  render: (ctx: StudioWorkspaceValue) => ReactNode;
  defaultCollapsed?: boolean;
  /** Gate a section behind a permission (e.g. People, Versions). */
  permission?: string;
}
export const STUDIO_SIDEBAR_SECTIONS: StudioSidebarSection[] = [ /* … */ ];
```

`StudioSidebarPanel` becomes a thin driver: it reads the workspace context, maps
over `STUDIO_SIDEBAR_SECTIONS`, filters by `visibleAt` + `permission`, and renders
each surviving section inside a collapsible shell. **Adding a sidebar capability =
adding a registry entry, never editing the panel's JSX.** The View dropdown stays
as the fixed top control (it *is* the depth/lens switch that drives the registry).

### 2.2 Collapsible sections + density

Each section renders inside a disclosure (chevron header). Collapsed state is
persisted **per section** in localStorage (`studio:sec:<id>`), reusing the same
`useLocalStorage` choice we made for the Inspector toggle. A "density" toggle
(comfortable / compact) tunes padding for power users on tall graphs.

### 2.3 State split — the rule, restated

| Lives in… | Holds | Why |
|---|---|---|
| **URL** (`?v=&focus=&z=&lens=`) | shareable *view* state | deep-links must reproduce the exact view |
| **localStorage** | personal *chrome* prefs — inspector open, section collapse, density | never pollute a shared link with someone's panel layout |

Section visibility derives from URL state (z/lens); section *collapse* is
localStorage. Don't conflate them.

---

## 3. The sections (what renders, at which depth × lens)

| Section | Shows | Visible at | Source of truth |
|---|---|---|---|
| **View control** | lens · zoom dropdown (current) | always (fixed top) | context `lens`/`z` |
| **Search / filter band** | filters the palette/list below | L0–L2 | local; 40px `sidebarHeaderSearchRowClass` band (memory `sidebar-search-band`) |
| **Palette · Nodes** | registered node types, grouped by category | L0–L1, Build/Static/Gaps | `listNodeMeta()` (`src/lib/workflow/registry.ts`) — already in `graph.palette` |
| **Palette · Templates** | seed/flow templates to instantiate into a draft | L0–L1, Build | `/reseller-flow` seeds |
| **Palette · Blocks** | station blocks for the focused node | L2 | stations block registry (`src/lib/stations`) — rides ST5 |
| **Palette · Sources** | sources compatible with the selected block | L3 | stations source registry — rides ST5 |
| **Departments / Stations** | department groups + station legend | L0 (+ reference) | `operations-catalog` `STATIONS` |
| **Live legend + WIP** | heat key + per-station in-flight, ranked | Live lens | context `live` (Ably-driven; no poll) |
| **Data-flow legend** | sources → transforms → sinks key | Static lens | static lens metadata |
| **Flow² bottlenecks** | nodes ranked by time-in-node / queue | Flow² lens | `workflow_node_stats` (rides ST2) |
| **People roster** | staff + coverage, **read-only**, deep-links to staff editor | People lens | staff access (law #7 — never writes) — rides ST6 |
| **Issues rail** | diagnostics; **promoted + expanded** under Gaps; severity-grouped; publish-blockers pinned; click-to-focus; quick-fix deep-links | always (compact); Gaps (full) | context `diagnostics` (`diagnostics.ts`) |
| **Versions & drafts** | definitions list (active/draft), create draft, switch, history | always (Build emphasis) | context `graph.definitions` — re-homes the shell header `<select>` |
| **Outline / node list** | searchable node list → click to focus/center | L1 (large graphs) | context `nodes` |
| **Simulate** | inject ghost units, scrub time | Build, ST6 | ghost-run engine — rides ST6 |
| **Annotations** | sticky notes on nodes/edges | any, ST6 | annotations store — rides ST6 |

### Lens behavior, in one line each
- **Build** → palette + templates + versions + compact issues.
- **Static** → data-flow legend + read-only palette.
- **Live** → live legend + per-station WIP ranked + in-flight total (context Ably).
- **Gaps** → Issues promoted to top & expanded, severity filter, "Fix" deep-links.
- **People** → roster + coverage, deep-link only.
- **Flow²** → bottleneck ranking.

### Zoom behavior, in one line each
- **L0** → departments + templates + L0 heat; palette is department/station *reference*, not node types.
- **L1** → node palette + outline + issues (today's default).
- **L2** → block palette + station meta (mirrors the Inspector station builder).
- **L3** → source palette for the selected block.

---

## 4. Interactions

- **Drag-to-add** from the Nodes palette onto the canvas (NODE_UI_PLAN item);
  keep click-to-add as the fallback we already ship.
- **Search** filters the *active* palette/list (nodes at L1, blocks at L2, …).
- **Keyboard:** `[` toggles the Inspector, `\` toggles sidebar density, `/`
  focuses the sidebar search. (Additive; no conflict with canvas shortcuts.)
- **Quick-fix:** Issues with a `fix` deep-link to `?focus=…&z=…&lens=gaps` and,
  where safe in a draft, offer a one-click config patch via the existing
  `onUpdateNodeConfig`.

---

## 5. Phasing (each independently shippable; aligned to the ST gates)

| Phase | Ships | Rides |
|---|---|---|
| **SB0 — done** | consolidation, duplicate-header removal, Inspector toggle | ST1 |
| **SB1** | section registry + collapsible sections + **Versions/Drafts** section (re-home the `<select>`) + **Search** band | ST1–ST3 (read-only) |
| **SB2** | depth-adaptive body (L0 departments vs L1 nodes) + lens-adaptive Issues promotion + **Live legend / WIP** | ST2 + ST3 data already present |
| **SB3** | **drag-to-add** + **Templates** section | ST4 (editable graph) |
| **SB4** | **L2 Blocks** / **L3 Sources** palette in the rail | ST5 (station editing) |
| **SB5** | **People roster** + **Simulate** + **Outline** + **Annotations** | ST6 |

Rationale mirrors the Studio's own "observe before edit": SB1–SB2 make the rail
smarter for the read-only viewer first; editing-only tools (drag-to-add,
templates, blocks) land as the matching ST phase unlocks them.

---

## 6. Guardrails / merge checklist

- [ ] New sidebar capability = a `STUDIO_SIDEBAR_SECTIONS` entry, **not** new JSX in the panel (law #8).
- [ ] Sections render purely from `StudioWorkspaceValue`; any new live/Flow² feed is added to `StudioWorkspaceContext` (one shared fetch / Ably sub), **no `refetchInterval` in a section** (law #4).
- [ ] Lens / zoom switch only re-selects sections — never refetches the graph or re-lays-out nodes (law #3).
- [ ] Node meta from `listNodeMeta()`; blocks/sources from the `src/lib/stations` registries; numbered states from `workflow-stages.ts` — **no inlined type/label maps**.
- [ ] URL holds view state; localStorage holds chrome prefs (collapse/density). Section *visibility* derives from URL; section *collapse* does not.
- [ ] People section reads, never writes — deep-links to the staff editor (law #7). Permission-gated sections honor `permission`; any `permission-registry` change pairs the manifest test.
- [ ] Versions/Drafts edits stay draft-scoped; publish runs blocking diagnostics with step-up (law #6/#7).
- [ ] Files: `src/components/studio/sidebar/` (sections registry + section components), `StudioSidebarPanel.tsx` (driver), `StudioWorkspaceContext.tsx` (new feeds only). Nothing lands in `/admin` or as a page one-off (law #1).

---

## 7. Files in play

- `src/components/sidebar/StudioSidebarPanel.tsx` — becomes the registry driver.
- `src/components/studio/sidebar/sections.ts` *(new)* — `STUDIO_SIDEBAR_SECTIONS`.
- `src/components/studio/sidebar/*Section.tsx` *(new)* — one file per section.
- `src/components/studio/StudioWorkspaceContext.tsx` — host any new shared feed.
- `src/components/studio/StudioLibrary.tsx` — folds into the Nodes/Blocks sections.
- `src/lib/workflow/registry.ts`, `src/lib/stations/*` — the palettes' SoT (consumed, never duplicated).
