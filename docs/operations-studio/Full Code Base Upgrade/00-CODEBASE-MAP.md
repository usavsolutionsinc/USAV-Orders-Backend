# Codebase Map — Current State

> The grounded picture of what exists **today**, so the modular upgrade builds on
> real primitives instead of reinventing them. Every path here was read directly
> from the repo. Read this before `01-MODULAR-SYSTEM-PROMPT.md`.

---

## 1. The system at a glance

A Next.js **App Router** reseller-operations backend (Drizzle + Neon, TanStack
Query, Ably realtime, framer-motion, React Flow). Scale today:

| Metric | Count |
|---|---|
| Page routes (`src/app/**/page.tsx`) | **103** |
| API routes (`src/app/api/**/route.ts`) | **572** |
| Design-system primitives | ~27 (`src/design-system/primitives/`) |
| Design-system composite components | ~50 (`src/design-system/components/`) |
| Realtime channels | ~12 named families (`src/lib/realtime/channels.ts`) |

The upgrade target is the **Operations Studio** (`/studio`) — one full-page canvas
where the whole operation is modeled, edited, observed and linted. It is being
built in layers; **the lower layers (the engine, the station registries) already
exist** and are the substrate everything else plugs into.

### The four layers (already partially built)

| Layer | What it is | Where | Status |
|---|---|---|---|
| **L4 — Engine** | The node graph that routes serialized units through process steps | `src/lib/workflow/` | **Built** |
| **L3 — Canvas** | React Flow node editor mechanics (zoom, ports, wiring) | `src/components/studio/StudioCanvas.tsx` | ST1 (read-only + basic edit) |
| **L2 — Station blocks** | Composable station UIs (blocks=code, composition=data) | `src/lib/stations/` | Built (S1 + S3-lite) |
| **L1 — Studio** | The page shell, zoom, lenses, Issues rail, draft/publish | `src/app/studio/`, `src/components/studio/` | **ST1 shipped** |

---

## 2. Route & URL inventory + conventions

### Top-level page families (`src/app/`)

`/operations` · `/dashboard` (Orders/Shipping) · `/walk-in` · `/sourcing` ·
`/products` · `/inventory` · `/warehouse` · `/receiving` · `/tech` · `/fba` ·
`/packer` · `/support` · `/studio` · `/ai-chat` · `/previous-quarters` · `/admin` ·
`/settings` — plus `/m/*` (mobile shell), short-link routes (`/o/[orderId]`,
`/p/[tracking]`, `/l/[ref]`, `/q/[payload]`, `/01/[gtin]/21/[serial]` GS1), and
deep detail routes (`/receiving/lines/[id]`, `/products/[sku]`,
`/inventory/sku/[sku]`, `/admin/inventory/units/[ref]`).

### URL conventions **already in use** (this is the important part)

The app does **not** use version-numbered URLs. It uses a consistent, modular set
of conventions defined as data in `src/lib/sidebar-navigation.ts`:

| Convention | Example | Mechanism |
|---|---|---|
| Path-based page | `/receiving` | `APP_SIDEBAR_NAV` |
| Mode param (sub-view) | `/receiving?mode=triage` | `SIDEBAR_PAGE_NAV[].modes[].to()` / `resolveMode()` |
| `?view=` / `?tab=` / `?section=` | `/products?view=qc`, `/warehouse?tab=map`, `/admin?section=staff` | same registry |
| Dynamic resource segment | `/products/[sku]`, `/o/[orderId]` | App Router |
| **Studio view state** | `/studio?v=<defId>&focus=<nodeId>&z=<0\|1>&lens=<build\|live\|gaps>` | `StudioShell` reads `searchParams` |

The write/read round-trip is enforced pure: `to()` builds the URL delta,
`resolveMode()` reads it back, and `sidebar-navigation.test.ts` asserts
`resolveMode(apply(to(mode))) === mode`. **This is already the "stable URL +
addressable state" pattern** that `02-URL-VERSIONING-AND-ADDRESSING.md` recommends
generalizing — there is nothing to invent, only to extend.

---

## 3. Modular primitives already built

### 3.1 Workflow engine — `src/lib/workflow/`

The graph backbone. A unit flows node → node; each node is a **thin adapter** over
an existing `src/lib/*` domain module, and the engine only decides routing.

- **`contract.ts`** — `NodeDefinition { type, label, icon, category, outputs[], configSchema?, run(ctx) }`; `NodeContext`; `NodeResult { output, data?, await? }`; `WorkflowEvent`; `WorkflowStore` (persistence boundary, org-id explicit on every write); `NULL_LOCK` (Upstash lock deferred). `NodeMeta = Omit<NodeDefinition,'run'>` is what the palette consumes.
- **`registry.ts`** — `registerNode()`, `getNode()`, `listNodes()`, **`listNodeMeta()`** (palette feed). Hard-coding a node type in a component is a bug; the UI reads the registry.
- **`diagnostics.ts`** — pure `runDiagnostics(input)` → `Diagnostic { id, severity, nodeId?, edgeId?, message, fix? }`. `DiagnosticSeverity = 'error' | 'warning' | 'info'`. **Severity contract: `error` blocks publish; `warning`/`info` never do.**
- **`router.ts` / `advance.ts` / `runtime.ts` / `store.ts`** — routing + advance + persistence (unit-testable via the `WorkflowStore` fake).
- **`events.ts` / `node-stats.ts` / `tap.ts`** — the event emission + stats accrual that feed the Live / Flow² lenses.

### 3.2 Station builder — `src/lib/stations/`

Layer 2. **Blocks are code, composition is data** (`station_definitions.config`).

- **Slots:** `trigger · queue · workspace · advance · header` (`SlotId`).
- **Field kinds:** `po_ref · tracking_ref · order_ref · sku_ref · serial_ref · condition_grade · source_platform · timestamp · money · text · staff_ref`. Renderers for these **must** delegate to the label SoTs (`conditions.ts`, `source-platform.ts`, `copy-chip-format.ts`) — never an inline map.
- **`DataSourceDefinition`** wraps an **existing GET route** (`endpoint` + `buildUrl` + `parse`); sources never own a query path. Has `permission` + optional `realtime.ablyChannel`.
- **`ActionDefinition`** wraps an **existing mutation route** (descriptors only; the route already owns Zod/auth/idempotency/audit). Has `appliesTo: FieldKind[]`, `confirm: 'none' | 'soft' | 'step_up'`.
- **`BlockDefinition`** (`type, slots, accepts, roles, configSchema, requiredPermissions, lazy component`). `BlockProps` — blocks never fetch; they receive `rows`, `mapping`, `actions`, `doneWhen`.
- **`StationConfig.slots`** can be `'legacy'` — the explicit escape hatch to render the original hard-coded tree, so modes migrate **one at a time**.

### 3.3 Sidebar nav registry — `src/lib/sidebar-navigation.ts`

Single source of truth for navigation. `APP_SIDEBAR_NAV` (page rows, each with
`kind: 'main' | 'station' | 'bottom'`), `SIDEBAR_PAGE_NAV` (per-page L2 modes with
`to()`/`resolveMode()`), `ROUTE_PERMISSIONS` (middleware gate). The master-nav
dropdown (`src/components/sidebar/master-nav/MasterNavDropdown.tsx`) groups pages by
`kind` into **Main / Stations / More**. `DashboardSidebar.tsx`'s
`MASTER_NAV_RAIL_PAGES` controls the always-visible L2 rail.

> **Studio placement (confirmed):** `studio` is registered with `kind: 'bottom'`
> → it renders under the **"More"** heading, is excluded from the rail, and is in
> the mobile-restricted set. This is correct and already done.

### 3.4 Design system — `src/design-system/`

- **`tokens/`** — `z-index.ts` (the named z-scale SoT: `z-panel/z-modal/z-panelPopover/z-toast/z-tooltip`), `colors/`, `spacing.ts`, `radii.ts`, `shadows.ts`, `borders.ts`, `css-variables.ts`, plus `haptics/sounds/touch`.
- **`primitives/`** — `Button.tsx` (canonical, 5 variants; `PrimaryButton` is a thin alias), `IconButton.tsx`, `EmptyState.tsx`, `CardShell.tsx`, `SearchField.tsx`, `TextField.tsx`, `Spinner.tsx`, `StaggerReveal.tsx`, …
- **`foundations/`** — `motion-framer.ts` + `motion.ts` (spring presets), `breakpoints.ts`, `icons/`.
- **`src/components/Icons.tsx`** — the lucide-based icon set; nav and node icons resolve from here. Label SoTs: `src/lib/conditions.ts`, `src/lib/source-platform.ts`, `src/lib/copy-chip-format.ts`.

### 3.5 The Studio shell — `src/components/studio/StudioShell.tsx`

Three panes: **Library | Canvas (React Flow) | Inspector**. Verified behavior:

- **URL state:** `?v=` (definition id), `?focus=` (node), `?z=` (0 map / 1 flow), `?lens=` (build/live/gaps). `router.replace` keeps views shareable.
- **Lenses:** Build / Live / Gaps enabled; **Flow² / People disabled** (later phases). Lenses repaint the same fetched graph — they never reload or re-layout.
- **Draft-first editing:** viewing an **inactive** version with `studio.manage` makes the canvas editable against a local working copy. *Save draft* PUTs the full graph; *Publish* runs **blocking diagnostics server-side inside the activation transaction** and requires a **step-up** grant. The active version is never editable.
- **Client-side re-lint:** while editing, `runDiagnostics` (pure) re-runs on every change, so gaps surface as you wire.
- **Live:** one fetch on lens activation + an Ably subscription to `db:public:item_workflow_state` (`db.row.changed`) with a **1200 ms trailing debounce — never a poll interval** (Neon CU cost).

API: `GET /api/studio/graph`, `GET /api/studio/live`, `POST /api/studio/definitions/draft`, `PUT /api/studio/definitions/[id]/graph`, `POST /api/studio/definitions/[id]/publish` (step-up).

---

## 4. Realtime + query data-flow backbone

### Realtime (the LIVE half) — `src/lib/realtime/channels.ts`

Named channel families, each env-overridable with a default:

| Channel | Carries |
|---|---|
| `orders:changes`, `fba:changes`, `walkin:changes`, `repair:changes` | domain row changes |
| `station:changes` | all station-level row changes (tech/packer/receiving logs) |
| `staff:changes`, `dashboard:operations` | staff + dashboard ops |
| `ai:assist` (+`:session`) | AI assist streams |
| `inbox:{staffId}` | per-staff priority alerts (token grants `inbox:*`) |
| `db:{schema}:{table}` (+`:{rowId}`) | **CDC stream** — the Studio Live lens rides `db:public:item_workflow_state` |

`src/lib/realtime/publish.ts` + `db-events.ts` are the emit side; client subscribes
via `useAblyChannel` (`src/hooks/useAblyChannel.ts`).

### Query graph (the STATIC half)

TanStack Query factories under `src/lib/queries/`, cache domains in
`src/lib/cacheDomains.ts`, query-key conventions throughout. API route → table →
query → component is the static "where data flows" path that the Data-Flow lens
(`04-DATA-FLOW-OBSERVABILITY.md`) renders.

---

## 5. Permissions model — `src/lib/auth/`

- **`permission-registry.ts`** — the permission taxonomy SoT (paired test: `permission-registry.test.ts`).
- **`route-permission-manifest.ts`** (+`.test.ts`) — every route's required permission; the audit-route-auth script enforces coverage.
- **`page-guard.ts` / `dynamic-route-guard.ts` / `withAuth.ts`** — server guards; `stepup.ts` — step-up grants.
- **Studio gates:** `studio.view` (read) and `studio.manage` (edit/publish, **`stepUp: true` on publish**). `ROUTE_PERMISSIONS` in `sidebar-navigation.ts` gates page navigation.

> Rule: any change to `permission-registry.ts` must update
> `route-permission-manifest.test.ts` and pass audit-route-auth.

---

## 6. DB / versioning model — `src/lib/drizzle/schema.ts`

The entity-revision pattern that the whole modular system standardizes on is
**already implemented**:

```
workflow_definitions   (schema.ts:2378)
  organizationId, name, version (int, default 1), is_active (bool, default false)
  UNIQUE (organization_id, name, version)
  → "one named, versioned graph per org; publishing a new version flips is_active"

station_definitions    (schema.ts:2508)
  organizationId, page_key, mode_key, label, workflow_node_id, config (jsonb),
  version (int), is_active (bool), updated_by, updated_at
  UNIQUE (organization_id, page_key, mode_key, version)
  → "versioning + is_active publish semantics copy workflow_definitions exactly"
```

`workflow_runs` / `workflow_node_stats` accrue observability; the daily snapshot
cron is `src/app/api/cron/workflow-node-stats/route.ts`. `slaHours` lives in
`workflow_nodes.config` (no schema change needed for SLA).

**This is the answer to the URL question in physical form:** versions are rows, not
route names. Pinning a version = `?v=<id>`; publishing = flip a flag in a
transaction. (See `02-URL-VERSIONING-AND-ADDRESSING.md`.)

---

## 7. The modularity ledger — registry-driven vs hard-coded

| Surface | Driven by | Editable in Studio today? | Gap to "fully modular" |
|---|---|---|---|
| Workflow graph (nodes/edges) | `workflow_definitions` + registry | **Yes** (draft/publish) | L2/L3 station detail not yet hosted |
| Node types | `workflow/registry.ts` | Code (correct) | More node types needed for full lifecycle |
| Station UIs | `station_definitions.config` + block registry | Partial (Incoming pilot) | Most modes still `'legacy'` |
| Sidebar nav | `sidebar-navigation.ts` (data) | **No** (edited in code) | Make nav itself a versioned definition |
| Pages / layouts | Hard-coded React trees | **No** | The big one — "pages-as-data" |
| Table columns / panels | Hard-coded per page | **No** | Generalize block model to lists/detail |
| Design tokens | `design-system/tokens` (data) | Code (correct) | Expose theme as per-org config |
| Permissions | `permission-registry.ts` (code) | No (correct) | Edit-mode gating, not data |

---

## 8. Biggest fixed surfaces (the migration scope)

The "god component" cleanup is already underway (see project memory: hook library +
`StaffAccessDetail` 1361→209, `UnfoundQueueDetailsPanel`, `FbaShipmentEditorForm`,
`LineEditPanel` slices, mode-registry SoT). The flagship hard-coded surfaces that a
**pages-as-data** model must eventually absorb:

- **`/dashboard`** (Orders/Shipping) — multi-mode order tables, the densest page.
- **`/receiving`** — Incoming/Triage/Unbox/Pickup/History; Incoming is the **station-builder pilot** already.
- **`/inventory`**, **`/products`**, **`/tech`**, **`/fba`** — each a fixed tab/column/panel composition.
- **Admin** (`?section=`) — 20+ sections already derived from `ADMIN_SECTION_OPTIONS` (a partial "sections-as-data" precedent).

The migration path is **incremental, mode-by-mode**, using the station
`'legacy'` escape hatch — never a big-bang rewrite. See
`05-EDITABILITY-MODULARITY-SPEC.md`.

_Part of the Full Code Base Upgrade spec — see README.md for the index._
