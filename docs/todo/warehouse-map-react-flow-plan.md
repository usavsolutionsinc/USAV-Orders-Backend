# Warehouse Map → React Flow Floor Plan — Implementation Plan

**Status:** proposed · **Owner:** TBD · **Created:** 2026-06-04
**Prototype:** `/design-demo` → "Warehouse floor plan" section
(`src/app/design-demo/_gallery/warehouse-flow-section.tsx`, data in
`warehouse-map-data.ts`).

Goal: replace / augment the flat HTML-table warehouse map with an interactive
**React Flow (`@xyflow/react`) floor-plan map** in the existing `/warehouse`
map mode — draggable, resizable bins laid out like the physical floor, with
SKU **trace** (draw edges from a bin to every other bin holding the same SKU),
pan/zoom, MiniMap, and the existing fill/age/issues color modes.

konva was evaluated and **dropped** (removed from the showroom + deps) — React
Flow wins for this use case because tracing is native (real graph edges), nodes
are DOM (theme straight off design tokens), and Controls/MiniMap are built in.

---

## 1. Current state (what we're building on)

| Concern | Where | Notes |
| --- | --- | --- |
| Map page host | `src/components/warehouse/WarehouseShell.tsx` → `MapTabBody()` | reads `?tab=map&view=fill\|age\|issues&showEmpty=1`; renders `<WarehouseMap>` + `<BinDetailFlyout>` |
| Current map render | `src/components/warehouse/WarehouseMap.tsx` | static `<table>` grid per room; `cellTone(row, mode)` color logic; `<MapLegend>` |
| Sidebar view toggle | `src/components/sidebar/WarehouseSidebarPanel.tsx` → `MapSidebarBody()` | the fill/age/issues buttons + `<MapLegend>`; writes `?view=` |
| Data hook | `src/hooks/useBinsOverview.ts` | `BinsOverviewRow[]` + counts; polls (`pollMs`, map uses 60s) |
| Data API | `src/app/api/inventory/bins-overview/route.ts` → `getBinsOverview()` in `src/lib/neon/location-queries.ts` | `permission: 'sku_stock.view'` |
| Bin detail | `src/components/warehouse/BinDetailFlyout.tsx` | opened on cell click |
| SKU → bins search | `src/app/api/inventory/sku-search/route.ts` + `src/hooks/useWarehouseSkuSearch.ts` | returns `bin_count`, `total_qty` per SKU — basis for real trace |
| Schema | `locations` table (`src/lib/drizzle/schema.ts:1547`) | `room, rowLabel, colLabel, zoneLetter, binType, capacity, parentId, sortOrder`. **No x/y/w/h layout columns** — see §3. |
| Existing React Flow precedent | `src/components/admin/workflow/OperationsFlowBoard.tsx` | proves `@xyflow/react@12` works in a client component with direct import + `@xyflow/react/dist/style.css` |

### `BinsOverviewRow` fields available to the map
`id, barcode, name, room, row_label, col_label, capacity, bin_type, zone_letter,
total_qty, sku_count, fill_pct, last_counted, is_empty, is_stale, has_low_stock,
is_over_capacity`. Everything the fill/age/issues color modes need is already here;
**only physical layout (x/y/size) and per-SKU contents are missing.**

---

## 2. Target architecture

```
WarehouseShell (MapTabBody)
  ?view=floorplan ─────────────► WarehouseFloorPlan         (NEW, promoted prototype)
  ?view=fill|age|issues ───────► WarehouseMap (existing table, kept as fallback)

WarehouseFloorPlan
  ├─ useBinsOverview(rows)                  ← live bins + flags (existing)
  ├─ useBinLayout(layout)                   ← NEW: persisted x/y/w/h per bin (§3/§4)
  ├─ buildFloorNodes(rows, layout, mode)    ← rows → React Flow nodes (zone + bin)
  ├─ useFloorTrace(sku)                     ← NEW: SKU → bin ids → edges (§5)
  ├─ <ReactFlow nodeTypes={{bin,zone}} colorMode edges={traceEdges}>
  │     <Background/> <Controls/> <MiniMap/>
  └─ onNodeClick → setFlyoutRow → <BinDetailFlyout>   (reuse existing)
```

Key principle: **the prototype's `warehouse-flow-section.tsx` already encodes the
node/edge/trace/resize mechanics.** Production work is mostly (a) feeding it real
`BinsOverviewRow` data, (b) a layout-persistence path, and (c) integrating into the
existing map mode + sidebar — not re-inventing the canvas.

---

## 3. Data model: persisting the floor-plan layout

The table map derives position purely from `room/row_label/col_label`. A floor plan
needs free-form **x, y, width, height per bin** that survives reload. The
`locations` table has none of these.

**Option A (recommended) — add layout columns to `locations`:**

```sql
-- migration: src/lib/migrations/2026-06-xx_locations_floorplan_layout.sql
ALTER TABLE locations
  ADD COLUMN layout_x   real,
  ADD COLUMN layout_y   real,
  ADD COLUMN layout_w   real,
  ADD COLUMN layout_h   real;
-- NULL layout_* = "not hand-placed yet"; fall back to the auto grid (§4).
```
Drizzle (`schema.ts`):
```ts
layoutX: doublePrecision('layout_x'),
layoutY: doublePrecision('layout_y'),
layoutW: doublePrecision('layout_w'),
layoutH: doublePrecision('layout_h'),
```
Pros: simplest, one row per bin already exists, no joins. Cons: layout mixed into
the core table (acceptable — it's bin metadata).

**Option B — separate `location_layout` table** (`location_id PK/FK, x, y, w, h,
updated_by, updated_at`). Pick this only if we expect multiple named layouts or
want layout writes isolated from inventory writes. Heavier; not needed for v1.

→ **Decision: Option A.** Zones (room rectangles) are *derived* (bounding box of
their bins + padding), so they need no storage in v1. If we later want hand-placed
zone frames, add a layout row to the parent room `location` (it already exists via
`parentId`/`zoneLetter`).

---

## 4. Layout strategy (auto grid + manual override)

`buildFloorNodes(rows, layout, mode)`:

1. **Auto-place** any bin with `layout_x == null` using the same grid math as the
   prototype's `buildLayout()` (group by `room`, sort `row_label`/`col_label`
   naturally, lay zones left-to-right). This guarantees a sensible map on day one
   with zero manual work — it reproduces today's table spatially.
2. **Manual override**: if `layout_x` is set, use it verbatim (x/y/w/h).
3. Emit one `zone` node per room (bounding box of its bins, `draggable:false,
   selectable:false, zIndex:0`) + one `bin` node per row (`zIndex:1`).
4. Color each bin via a shared `cellTone(row, mode)` — **extract the existing
   function out of `WarehouseMap.tsx` into a shared module** so table + floor plan
   stay in lockstep (the prototype's `binTone` becomes the canvas-hex variant of
   this).

**Editing**: gate dragging/resizing behind an **Edit layout** toggle (off by
default → read-only map for pickers). In edit mode, `onNodeDragStop` /
`onResizeEnd` collect dirty bins; a **Save layout** button `PATCH`es them.

---

## 5. Trace (find & follow a SKU across the floor)

The prototype traces by an in-memory `sku` on each mock bin. Real bins expose only
`sku_count`, not which SKUs. Two real data paths:

- **On-demand (recommended for v1):** when a bin is selected (or a SKU is searched
  via the existing `useWarehouseSkuSearch`), call a small endpoint
  `GET /api/inventory/sku-bins?sku=…` → `{ locationId, qty }[]` (one query on
  `bin_contents WHERE sku = $1`). Map those `locationId`s to nodes, highlight them,
  and build `Edge[]` from the source bin to each. This is the "click a bin → light
  up everywhere this SKU lives" flow.
- **Bin → its SKUs:** to trace *from* a clicked bin we first need that bin's SKUs.
  `BinDetailFlyout` already loads bin contents; reuse that query, or add the SKU
  list to the on-demand endpoint (`GET /api/inventory/bin-skus?binId=…`). For v1,
  trace the bin's **top SKU** (largest qty) and offer a SKU picker if it holds more.

Edges are derived/ephemeral (never persisted): `animated`, dashed, `ArrowClosed`
marker, accent stroke — exactly as in the prototype.

---

## 6. Map-mode integration (the actual wiring)

### 6.1 `WarehouseMap.tsx` → extract shared color logic
- Move `cellTone()` + `MapViewMode` + the `MapLegend` items into
  `src/components/warehouse/map-tones.ts`. Both the table and the floor plan import
  it. (No behavior change to the table.)

### 6.2 New component `src/components/warehouse/WarehouseFloorPlan.tsx`
Promote the prototype. Props mirror `WarehouseMap`:
```ts
{ rows: BinsOverviewRow[]; loading: boolean; mode: MapViewMode;
  showEmpty: boolean; onCellClick: (row) => void;
  editable?: boolean; }   // editable gated by permission (§8)
```
- `import { ReactFlow, ReactFlowProvider, Background, Controls, MiniMap,
  NodeResizer, Handle, Position, MarkerType, useNodesState, useReactFlow }
  from '@xyflow/react'` + `'@xyflow/react/dist/style.css'`.
- Wrap in `<ReactFlowProvider>` (needed for `fitView` on reset / focus-bin).
- `nodeTypes = { bin: BinNode, zone: ZoneNode }` (lifted from the prototype;
  `BinNode` shows fill%/qty, `NodeResizer` visible only when `editable && selected`).
- `colorMode` from the app theme (see §7).

### 6.3 `WarehouseShell.tsx` → `MapTabBody`
- Extend `parseMapMode` (and the sidebar `parseView`) to accept `'floorplan'`.
  Keep `fill/age/issues` as the table's sub-modes; treat `floorplan` as a **render
  switch** that still carries a color mode. Cleanest: split the concern —
  `?map=table|floorplan` (renderer) × `?view=fill|age|issues` (color). For minimal
  churn in v1, add `?view=floorplan` and default its color mode to `fill`.
- Render:
  ```tsx
  {mode === 'floorplan'
    ? <WarehouseFloorPlan rows={rows} loading={loading} mode="fill" showEmpty={showEmpty}
        onCellClick={setFlyoutRow} editable={canEditLayout} />
    : <WarehouseMap … />}
  ```
- `BinDetailFlyout` stays exactly as is (node click → `setFlyoutRow`).

### 6.4 `WarehouseSidebarPanel.tsx` → `MapSidebarBody`
- Add a **"Floor plan"** option to the `View by` grid (or a separate Table/Floor
  plan switch). When floor plan is active, show: the fill/age/issues color toggle,
  the legend, the **Show empty** toggle, and (if `canEditLayout`) **Edit layout /
  Save layout**.

### 6.5 New API routes
- `PATCH /api/inventory/bins-layout` — body `{ updates: {id, x, y, w, h}[] }`,
  `permission: 'bin.layout'` (new, see §8). Bulk-update `locations.layout_*`.
- `GET /api/inventory/sku-bins?sku=…` — `permission: 'sku_stock.view'`, returns
  `{ locationId, qty }[]` for trace.
- Extend `getBinsOverview()` to `SELECT` the four `layout_*` columns and add them to
  `BinsOverviewRow` (`layout_x?: number | null`, …).

---

## 7. Theming, SSR, performance

- **Theme:** pass `colorMode={isDark ? 'dark' : 'light'}` so React Flow's own chrome
  (Controls, MiniMap, edges, handles) follows the app. The app's dark signal — reuse
  whatever drives it (the prototype reads `[data-theme="dark"]`; production should
  use the real theme context if one exists, else the same DOM probe). Bin/zone nodes
  are DOM → they use Tailwind token classes (`bg-surface-card`, `text-text-default`,
  `border-border-soft`) and theme automatically.
- **SSR:** `OperationsFlowBoard` imports `@xyflow/react` directly in a client
  component with no `ssr:false` and ships fine — **no `next/dynamic` needed** (unlike
  konva). `WarehouseFloorPlan` is `'use client'`; give its wrapper a fixed height
  (the map area) so React Flow can measure.
- **Performance:** React Flow comfortably handles hundreds of nodes. Set
  `onlyRenderVisibleElements` if bin count grows large; memoize `nodeTypes` at module
  scope; derive display nodes (color/trace injection) with `useMemo` keyed on
  `rows/mode/tracedIds` so drags don't recompute colors. `useBinsOverview` already
  polls at 60s — reconcile poll updates into node *data* without clobbering
  in-progress drags (only patch `data`, keep `position` from state for dirty bins).

---

## 8. Permissions

- **View** floor plan: `sku_stock.view` (same as the map today).
- **Edit/save layout:** add `{ id: 'bin.layout', category: 'inventory', label:
  'Edit warehouse floor-plan layout' }` to `permission-registry.ts`. Per the
  permission-registry guard, the same change must update
  `route-permission-manifest.test.ts` and keep `audit-route-auth` passing — wire the
  new `PATCH /api/inventory/bins-layout` route with `withAuth(..., { permission:
  'bin.layout' })`.
- Trace endpoint: `sku_stock.view`.

---

## 9. Phasing

| Phase | Deliverable | Touches |
| --- | --- | --- |
| **0 ✅** | Prototype on mock data in `/design-demo` | done |
| **1** | Read-only floor plan in real map mode (auto grid from room/row/col, fill/age/issues colors, click→flyout, pan/zoom/MiniMap). **No persistence, no editing.** | extract `map-tones.ts`; `WarehouseFloorPlan.tsx`; `MapTabBody` + sidebar `floorplan` option; extend `getBinsOverview` (no schema change yet — auto-layout only) |
| **2** | Trace by SKU (click bin / search SKU → highlight + edges) | `GET /api/inventory/sku-bins`; `useFloorTrace`; reuse `useWarehouseSkuSearch` |
| **3** | Editable layout + persistence | migration (`layout_*`), schema, `PATCH /api/inventory/bins-layout`, `bin.layout` permission, Edit/Save UI |
| **4** | Polish | deep-link `?bin=` to focus+`fitView`; zone frames; density; empty-bin fade; legend parity; a11y/keyboard |

Phase 1 alone replaces the screenshot's static grid with a live, navigable spatial
map — ship-worthy on its own.

---

## 10. File-by-file change list

**New**
- `src/components/warehouse/WarehouseFloorPlan.tsx` (promoted prototype)
- `src/components/warehouse/map-tones.ts` (extracted `cellTone`/`MapViewMode`/legend)
- `src/components/warehouse/floor-layout.ts` (`buildFloorNodes`, auto-grid)
- `src/hooks/useFloorTrace.ts`
- `src/app/api/inventory/sku-bins/route.ts`
- `src/app/api/inventory/bins-layout/route.ts` (Phase 3)
- `src/lib/migrations/2026-06-xx_locations_floorplan_layout.sql` (Phase 3)

**Modified**
- `src/components/warehouse/WarehouseMap.tsx` (import tones from shared module)
- `src/components/warehouse/WarehouseShell.tsx` (`parseMapMode` + render switch)
- `src/components/sidebar/WarehouseSidebarPanel.tsx` (Table/Floor-plan + Edit/Save)
- `src/hooks/useBinsOverview.ts` (add `layout_*` to `BinsOverviewRow`)
- `src/lib/neon/location-queries.ts` (`getBinsOverview` selects `layout_*`)
- `src/lib/drizzle/schema.ts` (`layout_*` columns — Phase 3)
- `src/lib/auth/permission-registry.ts` + `route-permission-manifest.test.ts`
  (`bin.layout` — Phase 3)

**Removed (done)**
- `src/app/design-demo/_gallery/warehouse-map-canvas.tsx` (konva) ✓
- `src/app/design-demo/_gallery/warehouse-map-section.tsx` (konva) ✓
- deps `react-konva`, `konva` ✓

---

## 11. Risks & open questions

- **`?view` overloading.** Mixing renderer (table/floor) and color (fill/age/issues)
  on one param gets awkward. Recommend the `?map=` × `?view=` split in §6.3 before it
  spreads. *Decide in Phase 1.*
- **Drag vs. live poll.** A 60s `useBinsOverview` refresh must not snap a bin the
  user is dragging. Patch only `data`, never `position`, for nodes in flight.
- **Bin → SKU for trace.** A bin holds N SKUs; tracing needs a chosen SKU. v1 traces
  the top-qty SKU + offers a picker. Confirm desired UX.
- **Coordinate authority.** Once a bin is hand-placed (`layout_x` set), the
  room/row/col grid no longer governs it. Decide whether renaming a bin's
  row/col should re-snap it (recommend: no — manual wins until "Reset to grid").
- **Scale.** If a single room has thousands of bins, enable
  `onlyRenderVisibleElements` and consider virtualized zones. Current data volume is
  small.
- **Theme source.** Confirm the canonical app dark-mode signal so we don't ship the
  prototype's `[data-theme]` DOM probe into production.

---

## 12. Verification

- Phase 1: load `/warehouse?tab=map&view=floorplan` — bins appear in the same
  spatial arrangement as the table, colors match `cellTone`, click opens the
  existing flyout, pan/zoom/MiniMap work, light/dark themes correctly.
- Phase 2: select a bin / search a SKU → only same-SKU bins highlight with edges;
  counts match `sku-search.bin_count`.
- Phase 3: drag+resize+save → reload → layout persists; non-permitted users see a
  read-only map (no handles, no Save); `npm run audit-route-auth:check` passes.
