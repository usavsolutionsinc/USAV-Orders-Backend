# Node UI — deferred build plan

> **Status:** Plan for later. Captures the node-builder UI that is *not* yet built, so the current read-only Operations board can ship without it.
> **Companions:** `docs/operations-studio/NODE_WORKFLOW_ARCHITECTURE.md` (why/what), `docs/operations-studio/NODE_WORKFLOW_IMPLEMENTATION_PLAN.md` (full phasing), `docs/operations-studio/NODE_UI_PLAN.md` (this — the UI that's deferred).

## What already exists (don't rebuild)

| Piece | File | Role it plays for the node UI |
|---|---|---|
| Engine core | `src/lib/workflow/*` | The runtime the editable graph will drive (registry, advance, store). |
| Graph tables | `workflow_definitions / nodes / edges`, `item_workflow_state`, `workflow_runs` | Persistence the canvas saves to / loads from. |
| Audit board | `src/components/admin/workflow/OperationsFlowBoard.tsx` | The React Flow host + animated grid + layout — the editable canvas forks this. |
| Operations catalog | `src/components/admin/workflow/operations-catalog.ts` | Station/identifier/flow content; `highlightStatesFor()` already maps selections → node sets. |
| Operations sidebar | `OperationsSidebarPanel.tsx` | The reference panel; the node **palette** slots in beside it. |
| `?ops=` selection + board spotlight | board + sidebar | The selection/URL-state plumbing the editable canvas reuses. |

The read-only board renders **lifecycle states** (derived from real data). The deferred work is the **editable engine graph** — user-defined nodes wired to the engine.

## Deferred pieces

### 1. OperationNode component (registry-driven node)
`src/components/admin/workflow/nodes/OperationNode.tsx` — one component renders every node type from `/api/workflow/nodes` registry metadata: icon, label, and **one source handle per declared output port** (so `inspection` shows `pass` / `fail` handles). Sketch in architecture doc §4.2.

### 2. Node palette
`NodePalette.tsx` — draggable list of registered node types (reuse `@dnd-kit`, already a dep), grouped by `category`. Drag onto the canvas to add a `workflow_nodes` row. Lives beside `OperationsSidebarPanel` (or as a 4th lens: "Nodes").

### 3. Editable canvas
Fork `OperationsFlowBoard` → `WorkflowCanvasTab.tsx`:
- `nodesDraggable / nodesConnectable / elementsSelectable = true`
- `onConnect` → create a `workflow_edges` row (validate: one edge per source port)
- `onNodesChange` (position) → debounced save of `position_x/y`
- Loads a `workflow_definitions` version instead of the flow-audit aggregate.

### 4. Node config panel
Right-pane form rendered from each node's `configSchema` (architecture doc §3.2). Writes `workflow_nodes.config`. Reuse `src/components/ui/RightPaneOverlay.tsx` (already in the tree).

### 5. Definition management
- `useWorkflowGraph.ts` — TanStack Query hooks: list/load/save definitions (`/api/workflow/definitions*` from impl-plan Phase D).
- Version + publish UI (`isActive`); in-flight items finish on their old version.

### 6. ItemTracker live dot (Phase F)
Overlay on either board: subscribe to Ably (`emitWorkflowEvent` already publishes `item_workflow_state` row events), animate a dot to the node a scanned unit just entered. Backfill `item_workflow_state` from latest `station_activity_logs` per unit.

### 7. Audit ↔ engine toggle
A header switch on the Operations page: **Audit** (today's read-only real-data board) vs **Workflow** (the editable engine graph). Same React Flow host, two data sources.

### 8. Templates + onboarding
Seed `workflow_definitions` for `Standard refurb-and-list`, `Test-only consignment`, `Returns triage`. Empty-state via the `onboard` skill / design system.

## Suggested order when resumed
1. Phase D API routes + `workflow.*` perms (GUARDED — pairs with `route-permission-manifest.test.ts`).
2. OperationNode + palette + read-only render of a saved definition.
3. Editable canvas (connect/move/save) + node config panel.
4. ItemTracker live dot.
5. Audit↔engine toggle + templates.

## Dependencies already satisfied
`@xyflow/react`, `@dnd-kit/*`, `framer-motion`, `@tanstack/react-query`, design-system primitives, Ably realtime, `RightPaneOverlay.tsx`. No new deps needed for the node UI.

---
*The node-builder UI is intentionally deferred. The read-only Operations board + catalog sidebar deliver the audit value now; this plan is the path to the editable engine canvas.*
