# Node UI — build plan

> **Status:** Largely BUILT. The editable node-builder UI now lives in the Operations Studio (`/studio`): registry-driven nodes, a node palette/Library, an editable canvas (drag/connect/delete), and the full draft → publish lifecycle — including the generic schema-driven node config sheet (Phase C). The remaining deferred items are the live ItemTracker dot, the Audit↔engine toggle, and templates/onboarding.
> **Companions:** `docs/operations-studio/NODE_WORKFLOW_ARCHITECTURE.md` (why/what), `docs/operations-studio/NODE_WORKFLOW_IMPLEMENTATION_PLAN.md` (full phasing), `docs/operations-studio/NODE_UI_PLAN.md` (this — the UI plan).

## What already exists (don't rebuild)

| Piece | File | Role it plays for the node UI |
|---|---|---|
| Engine core | `src/lib/workflow/*` | The runtime the editable graph will drive (registry, advance, store). |
| Graph tables | `workflow_definitions / nodes / edges`, `item_workflow_state`, `workflow_runs` | Persistence the canvas saves to / loads from. |
| Audit board | `src/components/admin/workflow/OperationsFlowBoard.tsx` | The React Flow host + animated grid + layout — the editable canvas forks this. |
| Operations catalog | `src/components/admin/workflow/operations-catalog.ts` | Station/identifier/flow content; `highlightStatesFor()` already maps selections → node sets. |
| Operations sidebar | `OperationsSidebarPanel.tsx` | The reference panel; the node **palette** slots in beside it. |
| `?ops=` selection + board spotlight | board + sidebar | The selection/URL-state plumbing the editable canvas reuses. |

The read-only board rendered **lifecycle states** (derived from real data). The **editable engine graph** — user-defined nodes wired to the engine — is now BUILT inside `/studio` (items 1–5 below). Items 6–8 remain.

## Pieces

### 1. ✅ BUILT — registry-driven node (StudioNode)
Implemented in the Studio canvas: each node renders from `/api/studio/graph` palette metadata (`listNodeMeta()`) — icon, label, and **one source handle per declared output port** (so `inspection` shows `pass` / `fail`). (`src/components/studio/StudioCanvas.tsx` + the studio node component.)

### 2. ✅ BUILT — node palette / Library
The Studio's master-nav panel hosts a **Library** of registered node types, registry-driven (new node types appear without touching the UI). Adding from it appends a node via the provider's `onAddNode` → saved on "Save draft". (`StudioSidebarPanel` + `StudioWorkspaceContext.onAddNode`.)

### 3. ✅ BUILT — editable canvas
The Studio canvas is editable in draft mode: drag/move, connect (`onConnect` → edge), and delete nodes/edges; changes flow through `onGraphChange` and persist via `PUT /api/studio/definitions/[id]/graph`. Loads a `workflow_definitions` version (the active one, or `?v=`).

### 4. ✅ BUILT (Phase C) — node config sheet
`src/components/studio/NodeConfigForm.tsx` — a **generic, schema-driven** config sheet rendered in the inspector from each node type's `configSchema` (one input per field, typed by the schema: string→text/select, number→number, boolean→toggle). Writes back through `onUpdateNodeConfig`. Replaces the previous two hardcoded `station`/`slaHours` knobs (the station node's schema now drives those generically). This is the shared seam the decision-node + station editor reuse.

### 5. ✅ BUILT — definition management (draft → publish lifecycle)
Full draft lifecycle behind `studio.manage`: create draft (`POST …/draft`), save (`PUT …/graph`), publish with blocking diagnostics + step-up (`POST …/publish`), and **discard** a never-published draft (`DELETE …/discard`, Phase C.2). The draft-copy + publish-flip domain logic lives in `src/lib/studio/definitions.ts` (Deps-injectable, unit-tested DB-free). Version switch + `isActive` UI in `StudioShell`; in-flight items finish on their old version.

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
