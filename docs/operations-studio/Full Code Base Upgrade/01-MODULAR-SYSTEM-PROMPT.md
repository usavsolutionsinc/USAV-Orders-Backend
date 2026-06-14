# The Modular System Build Prompt

> **This is the centerpiece of the Full Code Base Upgrade.** It is a paste-ready
> brief that you (or an AI agent) hand to Claude Code to drive the work of making
> the entire codebase fully editable and modular **inside the `/studio` page** —
> with industry-standard, Notion × Linear, icons-first 2026 UX.
>
> The supporting docs are the detail: `00-CODEBASE-MAP.md` (what exists),
> `02-URL-VERSIONING-AND-ADDRESSING.md`, `03-DESIGN-LANGUAGE-2026.md`,
> `04-DATA-FLOW-OBSERVABILITY.md`, `05-EDITABILITY-MODULARITY-SPEC.md`,
> `06-PHASED-IMPLEMENTATION-PLAN.md`.

---

## 0. How to use this prompt

1. **Work one layer / one phase at a time.** Do not attempt the whole vision in a
   single PR. Follow the gates in `06-PHASED-IMPLEMENTATION-PLAN.md`.
2. **Obey the `ops-studio` skill laws** (restated in §8). They are not
   suggestions; the repo's review agents enforce several of them.
3. **Ship read-only observation value before unlocking any editing.** This is
   deliberate de-risking.
4. **Ground every change in the real primitives** listed in `00-CODEBASE-MAP.md`.
   Extend registries; never hard-code what a registry should drive.

> Suggested opening message to Claude Code:
> *"Read `docs/operations-studio/Full Code Base Upgrade/01-MODULAR-SYSTEM-PROMPT.md`
> and the sibling docs, plus invoke the `ops-studio` skill. Implement Phase N from
> `06-PHASED-IMPLEMENTATION-PLAN.md` only. Respect the laws in §8. Stop and show me
> the diff before publishing anything."*

---

## 1. North-star vision

> *"Make this system and this browser fully modular — able to see all the different
> pieces of everything and all the different flows of data, both in real time and in
> a static 'this is where the data will flow' state. Everything editable. Industry
> standard, Notion- and Linear-like, icons-first, 2026 UX."* — the owner

Concretely, when this is done:

- **The Studio is the single place** an owner builds, observes, and diagnoses the
  whole operation — the graph of process steps, the stations staff work at, the
  pages and nav the team sees, and the live flow of inventory through it all.
- **Every piece is visible.** Open the Studio and you can see — at the right zoom —
  the business map, the flow graph, each station's layout, and the data sources and
  actions wired into each block.
- **Every flow is visible two ways:** a **static map** ("this is where data *will*
  flow" — sources → transforms → sinks, always true) and a **live overlay** (units
  moving through the graph in real time, counts, heat, SLA). One canvas, two render
  layers. See `04-DATA-FLOW-OBSERVABILITY.md`.
- **Everything is editable as data,** safely: drafts, diagnostics-gated publish,
  per-org versions, instant rollback — without renaming a single route.

---

## 2. Non-negotiable principles

1. **Registries drive the UI.** Palettes, inspectors, node/block rendering, nav, and
   (eventually) page layout all consume registry/definition data. Node types and
   block types stay **code**; their *composition and config* are **data**. Hard-coding
   a type in a component is a bug.
2. **Blocks/nodes = code; composition = data.** New process step → a `NodeDefinition`
   (`src/lib/workflow/`). New station UI piece → a `BlockDefinition` / `DataSourceDefinition` /
   `ActionDefinition` (`src/lib/stations/`). What the operator arranges is saved as
   rows (`workflow_definitions`, `station_definitions`, and the new page/nav
   definitions).
3. **Schema-driven everything editable.** Config forms render from `configSchema`
   (nodes) and `ConfigField[]`/`FilterDef[]`/`BlockRole[]` (blocks). No bespoke config UI.
4. **Draft-first, publish atomically.** All edits target a draft version. Publish =
   one transaction: run blocking diagnostics → flip `is_active` → record actor.
   In-flight items finish on their old version. The active version is never mutated
   in place.
5. **Lenses are render layers, not routes.** Build / Live / Flow² / People / Gaps
   repaint the *same* laid-out graph. A new "show me X on the graph" feature is a new
   lens (or an addition to one) — never a new page.
6. **Live data arrives via Ably, never polling.** Subscribe to the engine's events
   (`src/lib/workflow/events.ts`) and the CDC channel `db:public:item_workflow_state`.
   Trends read `workflow_runs` / `workflow_node_stats` via TanStack Query with sane
   staleness. **No `refetchInterval` on the canvas** (Neon CU cost — the
   neon-cost-reviewer agent flags it).
7. **Stable URLs + entity versioning — NOT numbered routes.** Routes keep their
   semantic names; versions are rows pinned via `?v=`. See
   `02-URL-VERSIONING-AND-ADDRESSING.md`. The owner's hypothesis ("URLs become
   version numbers") is explicitly **rejected** there.
8. **Gap detection = diagnostics rules.** Anything shaped like "warn when X is
   misconfigured/slow/uncovered" is a rule in `src/lib/workflow/diagnostics.ts`
   returning a `Diagnostic`, surfaced via the Issues rail + Gaps lens. `error` blocks
   publish; `warning`/`info` never do.
9. **Permissions intersect modularity.** `studio.view` to observe, `studio.manage`
   (+ step-up on publish) to edit. Edit mode is a *gate*, not data. Any
   `permission-registry.ts` change pairs with `route-permission-manifest.test.ts`.
10. **Label SoTs are sacred.** Numbered states read `workflow-stages.ts`
    (`WORKFLOW_STAGES.order` + `label`); grades read `conditions.ts`; platforms read
    `source-platform.ts`; serial/chip display reads `copy-chip-format.ts`. Never
    inline a second map.

---

## 3. The target modular model — "everything as data"

| Concern | Code (PR-reviewed) | Data (edited in Studio) | Storage |
|---|---|---|---|
| Process steps | `NodeDefinition` | graph: nodes, edges, per-node config | `workflow_definitions` / `workflow_nodes` |
| Station UI | `BlockDefinition`, `DataSourceDefinition`, `ActionDefinition` | slot composition + bindings | `station_definitions.config` |
| **Pages / layouts** | block/region renderers (new) | page composition (new) | **`page_definitions` (new)** |
| **Sidebar nav** | nav renderer (exists) | page rows, groups, modes (new: as data) | **`nav_definitions` (new)** or generalize `sidebar-navigation.ts` |
| Theme | token primitives | per-org overrides (new) | **`org_theme` (new, optional)** |
| Permissions | `permission-registry.ts` | role → permission grants (exists) | role store |

Everything editable is **addressable + versioned**: it has a stable id, a `version`,
an `is_active` flag, and a draft lifecycle — exactly like `workflow_definitions` and
`station_definitions` do today. Generalize that one pattern; do not invent a second.

---

## 4. How the Studio becomes the single editor/observer/diagnoser

Built on the existing `StudioShell` (`src/components/studio/StudioShell.tsx`):

- **Semantic zoom (one canvas, no extra pages):**
  - **L0 — Business map:** department group nodes (read-only aggregate).
  - **L1 — Flow graph:** numbered states `①②③…` from `workflow-stages.ts` `order`.
  - **L2 — Station detail:** the Inspector hosts the **station builder** for the node's bound station (`workflow_nodes.workflow_node_id` ↔ `station_definitions`).
  - **L3 — Block binding:** the Config Sheet (source filters, field mapping, actions, display) for one block instance.
  Depth + focus + version + lens persist in the URL (`?v=&focus=&z=&lens=`).
- **Five lenses** (render layers): Build (edit), Live (in-flight occupancy), Flow²
  (throughput/SLA trends), People (who works where), Gaps (diagnostics).
- **Issues rail:** every `Diagnostic`, click-to-focus the offending node/edge;
  re-lints client-side on every edit (pure `runDiagnostics`).
- **Draft ▸ Publish:** *Edit as draft* → wire on the working copy → *Save draft* →
  *Publish* (step-up; blocking diagnostics inside the activation txn).
- **Simulate (later):** dry-run a unit through the draft graph before publishing.

---

## 5. The data-flow observability mandate

The owner asked to see all pieces and all flows, **live and static**. Deliver both
on the same canvas (full spec: `04-DATA-FLOW-OBSERVABILITY.md`):

- **Static map** — always-true sources → transforms → sinks: Ably channels
  (`realtime/channels.ts`), API namespaces, TanStack query factories, DB tables,
  integrations. This is "where data *will* flow," independent of whether anything is
  moving right now.
- **Live overlay** — animated edges/particles + per-node counts + heat + SLA,
  driven by `workflow/events.ts` over Ably (`db:public:item_workflow_state`), no
  polling. Switching Static↔Live is a lens toggle, not a navigation.

---

## 6. The design-language mandate

Notion × Linear, icons-first, calm-enterprise 2026 (full spec:
`03-DESIGN-LANGUAGE-2026.md`). Build on the existing design system — do not
restyle from scratch:

- Tokens from `src/design-system/tokens/` (z-scale SoT in `z-index.ts`); primitives
  from `src/design-system/primitives/` (`Button` is canonical); motion from
  `src/design-system/foundations/motion-framer.ts`; icons from
  `src/components/Icons.tsx` (one icon per concept; icon-first rows).
- **Keyboard-first:** a `cmd-k` command palette over the nav registry + node/block
  palettes (`CommandBar.tsx` is the seed).
- Restrained color, generous density control, spring motion, reduced-motion respect,
  light/dark via tokens, first-class empty/loading states (`primitives/EmptyState.tsx`,
  `Skeletons.tsx`).

---

## 7. The URL / addressing model (summary; full doc: `02-...`)

- Routes keep **semantic, stable, human-readable** names. **Do not** rename pages to
  numbers.
- A resource's **version** is a row pinned in the URL via `?v=<id>` (the Studio
  already does this). Draft vs published is a flag, not a separate route.
- Deep links round-trip: `/studio?v=12&z=1&focus=n-abc&lens=gaps` reconstructs the
  exact view cold. Extend the `to()`/`resolveMode()` contract in
  `sidebar-navigation.ts` to any new addressable state.

---

## 8. Guardrails — the laws (restated, enforced)

1. The Studio is a **page** (`src/app/studio/`), never a new `/admin` section or a
   one-off panel. Promote the read-only board from `OperationsFlowsDisplay.tsx` as
   the seed.
2. **One canvas, semantic zoom** (L0→L3). Never build a separate page for a deeper
   detail level.
3. **Lenses repaint; they never reload/re-layout/navigate.**
4. **Ably for live, snapshots for trends. No polling on the canvas.**
5. **Gaps = diagnostics rules** (`diagnostics.ts`), surfaced via Issues rail + Gaps
   lens. `error` blocks publish; `warning`/`info` never do.
6. **Draft-first, publish atomically** (transaction: diagnostics → flip `is_active`
   → record actor). Never mutate the active version.
7. **Perms:** view `studio.view`, edit/publish `studio.manage` + step-up on publish.
   `permission-registry.ts` changes pair with the manifest test.
8. **Registries drive the UI.** Numbered-state labels read `workflow-stages.ts`;
   other labels read their SoTs.
9. **URL state round-trips** (deep-link to `?focus=` works cold).
10. **New tables go through the `/db-migrate` skill flow.**

---

## 9. Acceptance criteria for "fully modular"

The upgrade is "done enough to sell the vision" when:

- [ ] The Studio renders the org's real operation as a graph and the owner can read it at L0–L3 without leaving the page.
- [ ] **Live** lens shows units moving in real time (Ably, no polling); **Static** map shows where data flows even when idle.
- [ ] An owner can **edit** the graph + at least the **Receiving Incoming** station as a draft and **publish** it (diagnostics-gated, step-up), with instant rollback by re-publishing the prior version.
- [ ] At least **one flagship page mode** renders from a `page_definitions` row (pages-as-data), with `'legacy'` fallback for the rest.
- [ ] The sidebar nav is editable as data (or has a clear, written migration to it).
- [ ] Every editable thing is **versioned + addressable** (`?v=`), and **no route was renamed to a number**.
- [ ] The whole surface reads as one coherent Notion × Linear, icons-first system.
- [ ] `cmd-k` reaches any page, node type, or block.

---

## 10. Anti-goals (do not do these)

- ❌ Rename routes to version numbers (`/v3/...`). See `02-...`.
- ❌ Add a new `/admin` tab for any of this.
- ❌ Add `refetchInterval` polling to the canvas.
- ❌ Big-bang rewrite of a flagship page — migrate mode-by-mode behind the `'legacy'` slot.
- ❌ Inline a second label/status/grade map instead of reading the SoT.
- ❌ Mutate the active workflow/station version in place.
- ❌ Introduce a parallel runtime (NestJS/Temporal/Nango) — build on the existing stack.

_Part of the Full Code Base Upgrade spec — see README.md for the index._
