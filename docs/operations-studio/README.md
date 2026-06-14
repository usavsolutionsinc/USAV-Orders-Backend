# Operations Studio — the repo-wide upgrade, in one folder

> The initiative: turn this codebase — a used-electronics reseller backend (receiving →
> test/grade → list on eBay & other platforms → fulfill → returns/warranty) — into a
> **modular, visually-composable operations system**. Business owners model their entire
> operation as a node graph in a dedicated `/studio` page, compose each station from reusable
> blocks, scope staff to exactly their stations, and let the system surface bottlenecks and
> gaps automatically.

## The four layers (top → bottom)

| Layer | Doc | What it specifies | Status |
|---|---|---|---|
| **1. Operations Studio** | [operations-studio-plan.md](operations-studio-plan.md) | The dedicated `/studio` page: semantic zoom L0–L3, five lenses (Build · Live · Flow² · People · Gaps), diagnostics linter, draft→publish, simulate | 📝 planned |
| **2. Station composition** | [station-builder-ui-plan.md](station-builder-ui-plan.md) | Block palette + dnd into sidebar slots + Source/Display/Actions config sheet; block / data-source / action registries; `station_definitions` | 📝 planned |
| **3. Canvas mechanics** | [NODE_UI_PLAN.md](NODE_UI_PLAN.md) | Editable React Flow canvas: OperationNode, palette, connect/save, node config panel, ItemTracker | 📝 deferred build plan |
| **4. Engine & schema** | [NODE_WORKFLOW_ARCHITECTURE.md](NODE_WORKFLOW_ARCHITECTURE.md) · [NODE_WORKFLOW_IMPLEMENTATION_PLAN.md](NODE_WORKFLOW_IMPLEMENTATION_PLAN.md) | Node contract, registry, runtime/router/advance, graph tables, QStash durability | ✅ **engine core built** (`src/lib/workflow/`, tables in schema) |

Key invariants that hold across all layers:

- **Build ON TOP of the existing stack.** Nodes/blocks/actions are thin adapters over
  existing `src/lib/*` modules and `withAuth` routes — never reimplemented logic, never a
  parallel framework (no NestJS/Temporal/Nango-core).
- **Code vs. data line:** node types, blocks, data sources, actions, diagnostics rules are
  **code** (registered, typed, PR-reviewed). Graphs, station configs, bindings, templates
  are **data** (versioned rows, edited in the Studio, published without deploys).
- **Registries drive every UI.** Palettes, config sheets, and canvases render from registry
  metadata; nothing hard-codes a node or block type.
- **Observe before edit.** Read-only value (live board, bottleneck heat, diagnostics) ships
  before graph editing unlocks.
- **Label SoTs are consumed, never forked** (`workflow-stages.ts`, `conditions.ts`,
  `source-platform.ts`, chip registries).

## Where the code lives / will live

```
src/lib/workflow/            # ✅ engine: contract, registry, runtime, router, advance, store
  diagnostics.ts             # 🆕 layer 1: the operations linter
  nodes/                     # 🆕 node-type adapters (see workflow-node skill)
src/lib/stations/            # 🆕 layer 2: blocks/, data-sources.ts, actions.ts registries
src/components/admin/workflow/  # ✅ read-only Operations board (seed of the Studio; currently in /admin)
src/app/studio/              # 🆕 layer 1: the dedicated Studio page
src/app/api/workflow/        # ✅ flow-audit; 🆕 definitions/nodes CRUD (impl-plan Phase D)
Schema: workflow_definitions/nodes/edges, item_workflow_state, workflow_runs  # ✅ applied
       station_definitions, workflow_node_stats                              # 🆕
```

## Build order (cross-layer)

1. **ST1–ST3** (Studio shell + Live/Flow² lenses + diagnostics v1) — read-only, immediate
   owner value, zero operational risk.
2. **S1–S2** (block/source/action registries + checklist vertical slice on receiving
   Incoming) — ships the incoming-tracking-todo feature *through* the new system.
3. **ST4** (editable graph = NODE_UI_PLAN items hosted in the Studio).
4. **S3–S4 / ST5** (station builder edit mode, embedded at Studio zoom L2).
5. **ST6** (People lens, simulate, annotations, reseller templates).

## Skills (how to build any piece of this correctly)

Project skills in `.claude/skills/` encode the contracts so every future session builds the
same way:

| Skill | Use when |
|---|---|
| `/ops-studio` | Any work on `/studio`, lenses, diagnostics, zoom, draft/publish — the master map + rules |
| `/workflow-node` | Adding or changing an engine **node type** (NodeDefinition adapter) |
| `/station-block` | Adding a **block**, **data source**, or **action** to the station registries |
| `/reseller-flow` | Designing graphs/templates for the used-reseller domain (eBay + multi-platform): canonical states, grading, serials, returns loops |
