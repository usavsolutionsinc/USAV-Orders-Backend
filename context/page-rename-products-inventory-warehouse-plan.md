# Page Rename & Modernization Plan
## Products · Inventory · Warehouse

**Status:** Draft v1
**Saved:** 2026-05-18
**Scope:** Rename two existing top-level routes (`/sku-stock` → `/inventory`, `/inventory` → `/warehouse`), introduce a first-class `/products` page, and design a modern UX/UI for all three. The three pages form the operator's mental model of inventory:

```
Products    →   "What things do we sell?"            (catalog)
Inventory   →   "Where is each unit right now?"       (live ledger)
Warehouse   →   "What's in this physical location?"   (spatial)
```

Every other admin tool (`/admin/inventory-v2/*`) stays where it is — those are the underlying ops console, not the operator-facing trio.

---

## Table of Contents

1. [Naming rationale](#1-naming-rationale)
2. [Rename map and route table](#2-rename-map-and-route-table)
3. [Information architecture](#3-information-architecture)
4. [Cross-page navigation graph](#4-cross-page-navigation-graph)
5. [Products page — modern UX/UI](#5-products-page--modern-uxui)
6. [Inventory page — modern UX/UI](#6-inventory-page--modern-uxui)
7. [Warehouse page — modern UX/UI](#7-warehouse-page--modern-uxui)
8. [Shared components and tokens](#8-shared-components-and-tokens)
9. [Mobile / narrow-viewport behavior](#9-mobile--narrow-viewport-behavior)
10. [Search and filter language](#10-search-and-filter-language)
11. [Realtime + caching contract](#11-realtime--caching-contract)
12. [Permissions and gating](#12-permissions-and-gating)
13. [Migration and rollout](#13-migration-and-rollout)
14. [Implementation plan](#14-implementation-plan)
15. [Open decisions](#15-open-decisions)

---

## 1. Naming rationale

Today's labels are confusing because they don't match the data model:

| Today | What it actually shows | Problem |
|---|---|---|
| **SKU Stock** (`/sku-stock`) | Browse SKUs, see per-SKU bin distribution + ledger | Operators look here for "where is this stock?" but call the page "stock" not "inventory" |
| **Inventory** (`/inventory`) | Rooms, bins, fill bars, label-print workspace, map | It's the **warehouse map**, not the ledger |

The proposed names map cleanly to the underlying tables and to operator intuition:

| Renamed | What it shows | Backed by |
|---|---|---|
| **Products** | SKU catalog rows + their attributes | `sku_catalog`, `sku_platform_ids`, `sku_kit_parts` |
| **Inventory** | Per-unit serial_units + bin_contents qty per SKU + event timeline | `serial_units`, `sku_stock_ledger`, `inventory_events`, `bin_contents` |
| **Warehouse** | Physical map of rooms, bins, fill states | `locations`, `bin_contents` (joined) |

The names also map to the inventory v2 admin tools under `/admin/inventory-v2/`:

| Operator page | Admin counterpart |
|---|---|
| Products | (none — `/admin/inventory-v2/sku/[sku]` is the admin drill-down) |
| Inventory | `/admin/inventory-v2/events`, `/admin/inventory-v2/units/[ref]`, `/admin/inventory-v2/sku/[sku]` |
| Warehouse | (no direct admin equivalent; cycle counts at `/admin/inventory-v2/cycle-counts` complement) |

---

## 2. Rename map and route table

### File / route migration

| Action | From | To | Notes |
|---|---|---|---|
| Rename | `src/app/sku-stock/page.tsx` | `src/app/inventory/page.tsx` | Old `/sku-stock` becomes `/inventory` |
| Rename | `src/app/sku-stock/[sku]/page.tsx` | `src/app/inventory/sku/[sku]/page.tsx` | Per-SKU drill-down moves under `inventory` |
| Rename | `src/app/sku-stock/location/[barcode]/page.tsx` | `src/app/inventory/location/[barcode]/page.tsx` | Per-bin drill-down moves with it |
| Move + rename | `src/app/inventory/page.tsx` (current) | `src/app/warehouse/page.tsx` | The old "Inventory" page (rooms/bins/map) becomes Warehouse |
| New | — | `src/app/products/page.tsx` | Brand new product catalog page (user said one exists; this plan covers a modern build either way) |
| New | — | `src/app/products/[sku]/page.tsx` | Product detail |

### Component / module migration

The `src/components/sku/` and `src/components/inventory/` directory names are now misleading. Rename to match:

| Action | From | To |
|---|---|---|
| Rename dir | `src/components/sku/` | `src/components/inventory/` *(see conflict resolution below)* |
| Rename dir | `src/components/inventory/` | `src/components/warehouse/` |
| New dir | — | `src/components/products/` |

**Conflict:** the current `src/components/inventory/` directory occupies the target name. Order matters:
1. First move `src/components/inventory/` → `src/components/warehouse/` (free up the name)
2. Then move `src/components/sku/` → `src/components/inventory/`
3. Then create `src/components/products/`

### Sidebar panel migration

| From | To |
|---|---|
| `SkuStockSidebarPanel.tsx` | `InventorySidebarPanel.tsx` *(name conflict — see below)* |
| `InventorySidebarPanel.tsx` (current) | `WarehouseSidebarPanel.tsx` |
| — | `ProductsSidebarPanel.tsx` *(new)* |

Same ordering trick: rename the warehouse one first.

### Route shim (back-compat)

A small Next.js redirect shim keeps existing operator bookmarks and external links working through the rename. Add to `next.config.js`:

```js
async redirects() {
  return [
    { source: '/sku-stock', destination: '/inventory', permanent: true },
    { source: '/sku-stock/:path*', destination: '/inventory/:path*', permanent: true },
    // /inventory keeps its slug — no redirect needed for the rename
    // /warehouse is new; no existing links to redirect from
  ];
}
```

For the `/inventory` → `/warehouse` swap, since `/inventory` becomes the **new** ledger page (formerly `/sku-stock`), we don't redirect — anyone bookmarked at `/inventory` will land on the ledger now. That's the right behavior for the relabel, but operators who had `/inventory` bookmarked for the WAREHOUSE map will need a heads-up. Suggest a short banner on the new `/inventory` page for the first two weeks: *"Looking for the warehouse map? It moved to [/warehouse](/warehouse)."*

### Navigation menu labels

Wherever the sidebar / app shell labels these routes, update simultaneously with the file moves. Grep for current strings:

```
grep -rn '"sku-stock"\|>SKU Stock<\|>Inventory<\|/sku-stock\|/inventory' src/components/sidebar src/app/layout.tsx
```

---

## 3. Information architecture

Each page has **one job**. The job determines the dominant scan motion (left-to-right vs top-to-bottom), the primary search field, and which other pages it cross-links to.

### Products

**Job:** answer "what do we sell, and what are its attributes?"

**Primary verbs:** browse, search, edit, sync to platform.

**NOT this page's job:** show stock levels, show units, show recent events. (Those belong on Inventory.)

**Default view:** virtualized table of every `sku_catalog` row.

**Required cross-links:**
- Each row → `/inventory?sku={sku}` (see units of this product)
- Each row → `/admin/inventory-v2/sku/{sku}` (admin drill-down)

### Inventory

**Job:** answer "where is each unit right now, and what state is it in?"

**Primary verbs:** search by SKU / unit / location / state / condition, scan to resolve, drill into one unit's full history.

**NOT this page's job:** edit product attributes (Products), manage physical bins (Warehouse), tune workflows (admin).

**Default view:** filter-driven results list. No filter → recent inventory_events. With a SKU filter → bin-distribution + serial-units list for that SKU.

**Required cross-links:**
- Each unit → `/admin/inventory-v2/units/[ref]` (full timeline)
- Each SKU → `/products/[sku]` (catalog row)
- Each location → `/warehouse/[barcode]` (bin contents)

### Warehouse

**Job:** answer "what's in this physical location, and how full is it?"

**Primary verbs:** view the floor plan, click a bin, see contents, label-print.

**NOT this page's job:** show every event (Inventory), edit product attributes (Products).

**Default view:** visual room map with fill bars. Click a room → expand to bin grid. Click a bin → side flyout with contents.

**Required cross-links:**
- Bin contents → `/inventory?bin={barcode}` (filter the ledger to this bin)
- SKU rows inside a bin → `/products/{sku}`

---

## 4. Cross-page navigation graph

```
       ┌─────────────────────────────────────────────┐
       │              Search-anywhere bar             │
       │         (global, top of every page)          │
       └────────┬────────────────┬──────────────────┬─┘
                │                │                  │
                v                v                  v
     ┌───────────────┐  ┌──────────────────┐  ┌────────────┐
     │   Products    │  │     Inventory    │  │  Warehouse │
     │   (catalog)   │  │   (live ledger)  │  │  (spatial) │
     └───────┬───────┘  └────────┬─────────┘  └──────┬─────┘
             │                   │                   │
             │   click SKU       │   click unit      │  click bin
             │   ─────────────►  │   ──────────────► │  ──────────►
             │                   │                   │
             │           ┌───────┴──────────┐        │
             │           │ Per-unit timeline │        │
             │           │ /admin/inventory- │        │
             │           │ v2/units/[ref]    │        │
             │           └──────────────────┘        │
             │                                       │
             └───────────────────┬───────────────────┘
                                 v
                 (bidirectional: SKU appears in both)
```

Operator never has to ask "which page do I open?" — the answer is dictated by the question:

| Question | Page |
|---|---|
| "What's the title of SKU X?" | Products |
| "Is SKU X in stock?" | Inventory |
| "What units of SKU X do we have, and what condition?" | Inventory |
| "Where is unit Y?" | Inventory |
| "What's in bin A-12-03?" | Warehouse |
| "Why is bin A-12-03 over capacity?" | Warehouse |

---

## 5. Products page — modern UX/UI

### Layout

```
┌───────────────────────────────────────────────────────────────┐
│  Products                                  ⌘K  [+ New product] │
│  ────────────────────────────────────────────────────────────  │
│  [Search: code / title / category / GTIN ▾]   [Filters: …] │ ▾ │  ← sticky header
│  ┌────────────────────────────────────────────────────┐         │
│  │ SKU         Title                Cat  GTIN   Last  │         │
│  │ ──────────────────────────────────────────────────│         │
│  │ IPH13-128…  iPhone 13 128 Blue   📱   02…36   2h   │ ←row    │
│  │ IPH13-256…  iPhone 13 256 Blue   📱   02…43   3h   │         │
│  │ MBP14-M3…   MBP 14 M3 512        💻   —       4d   │         │
│  │ …                                                   │         │
│  └────────────────────────────────────────────────────┘         │
│                                                                 │
│  ─────────────────  showing 247 of 1,194 ─────────────────      │
└───────────────────────────────────────────────────────────────┘
```

### Components

| Component | Purpose | New / reuse |
|---|---|---|
| `<ProductsShell>` | Top-level page wrapper; mounts the toolbar + table | New (`src/components/products/`) |
| `<ProductsToolbar>` | Search field + filter pills + new-product CTA | New |
| `<ProductsTable>` | Virtualized table (TanStack Virtual) of `sku_catalog` rows | New — but reuses `@/design-system/components/Table` |
| `<ProductRow>` | One row; SKU code, title, category chip, GTIN status dot, last-updated relative time, hover actions (Open, Edit, Open in admin) | New |
| `<ProductSheet>` | Slide-over drawer for inline edit. Falls back to a full page on `<md` | New |
| `<ProductFiltersBar>` | Chip-style filters: category, active/inactive, with/without GTIN, has manual, has platform link | New |
| `<NewProductDialog>` | Modal to add a new SKU row — title, category, optional GTIN, image URL | New |

### Detail page `/products/[sku]`

Header: title, SKU, GTIN, category, active toggle.

Section grid:
- **Attributes** — editable text fields (title, category, upc, ean, image_url). One Save action.
- **Platform links** — `sku_platform_ids` rows (Ecwid, eBay, Amazon, Zoho) with the platform's title override (`display_name`) when set.
- **Kit / BOM** — `sku_kit_parts` rows for what's in the box.
- **QC checks** — `qc_check_templates` rows for the QA flow.
- **Live stock summary** — small card with WAREHOUSE qty + BOXED qty + serial-units count by status. Cross-links to `/inventory?sku={sku}`.

### Search behavior

- Press `/` or `⌘K` from anywhere → focus the search field.
- Pasting a string with leading zeros tolerated (mirrors `normalizeSku` in `src/utils/sku.ts`).
- Typing a 14-digit numeric → resolve as GTIN if no SKU match.
- Hitting Enter with one match → navigate to `/products/[sku]`.

### Performance

- Initial load: 100 rows server-rendered; infinite scroll fetches subsequent pages via `/api/products?cursor=…`.
- Filter changes don't refetch the catalog; client-side filtering on the in-memory page slice plus a debounced server-side query when crossing the page boundary.

### Bulk operations

A right-rail panel (collapsed by default) for bulk actions on selected rows:
- Bulk activate / deactivate
- Bulk re-sync with Ecwid (one platform at a time)
- Bulk GTIN backfill (the existing `scripts/backfill-internal-gtins.mjs` mechanism, but as a UI action)
- Bulk add to print queue

Selection mode: shift-click to range-select, ⌘-click to add/remove single rows.

---

## 6. Inventory page — modern UX/UI

The hardest of the three because it has the broadest query surface: SKU, unit ID, location, state, condition, time. Today's `/sku-stock` is mostly a SKU browser; we need to expand to all five filters and keep the UX scannable.

### Layout

```
┌───────────────────────────────────────────────────────────────────────┐
│  Inventory                                              ⌘K  [Scan ⌐⊙] │
│  ───────────────────────────────────────────────────────────────────  │
│  [Search/scan anything: SKU / unit / location / serial …       ▾]    │  ← search bar dominant
│  Filters:  [State ▾]  [Condition ▾]  [Location ▾]  [Last 24h ▾]  ╳   │  ← active filter chips
│  ───────────────────────────────────────────────────────────────────  │
│  ┌────────────────────┐   ┌────────────────────────────────────────┐  │
│  │ Results            │   │  Selected result detail (right panel)  │  │
│  │                    │   │                                        │  │
│  │ IPH13-128-BLU      │   │  ▒▒▒  IPH13-128-BLU-2026-000142        │  │
│  │   12 STOCKED       │   │  iPhone 13 128GB Blue · USED_A         │  │
│  │   3 ALLOCATED      │   │                                        │  │
│  │   2 SHIPPED today  │   │  Status:    STOCKED                    │  │
│  │ ─────────────      │   │  Location:  A-12-03                    │  │
│  │ MBP14-M3-512       │   │  Condition: USED_A                     │  │
│  │   …                │   │                                        │  │
│  │                    │   │  ⏱ Recent events                       │  │
│  │                    │   │  ▢ STOCKED   2026-05-17 14:32  Tuan    │  │
│  │                    │   │  ▢ GRADED    2026-05-17 13:45  Cuong   │  │
│  │                    │   │  ▢ TEST_PASS 2026-05-17 12:01  Cuong   │  │
│  │                    │   │                                        │  │
│  │                    │   │  [Open full timeline →]                │  │
│  └────────────────────┘   └────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────┘
```

### Three views, one URL

The page switches between three views based on URL params, with smooth (no full reload) transitions:

| URL state | View |
|---|---|
| `/inventory` (no filter) | **Pulse** — recent inventory_events list across all SKUs, last 50, auto-refresh every 30s |
| `/inventory?sku={sku}` | **By SKU** — bin distribution + serial_units grouped by status |
| `/inventory?bin={barcode}` | **By bin** — contents of the bin (same as today's `/sku-stock/location/[barcode]`) |
| `/inventory?unit={id-or-serial}` | **By unit** — single-unit drill-down, mini-timeline |
| `/inventory?state=ALLOCATED&...` | **By filter** — every unit matching the filter combo |

The search box parses the input and routes to the matching view:
- Numeric `42` → `?unit=42`
- `IPH13-128-BLU` (SKU pattern) → `?sku=IPH13-128-BLU`
- `A-12-03` (bin code) → `?bin=A-12-03`
- GS1 Digital Link URL → extract serial via `parseScannedUrl`, then `?unit={serial}`

This is one component (`<InventorySearchBar>`) feeding one router action — operators don't have to know which "tab" they want, they just type/scan.

### Components

| Component | Purpose | Reuse |
|---|---|---|
| `<InventoryShell>` | Layout: header + filter chips + split view | New |
| `<InventorySearchBar>` | Universal search + scan input | New — wraps `parseScannedUrl` |
| `<InventoryFilterChips>` | Active-filter chips + dropdowns | New |
| `<PulseView>` | Default view, recent events feed | New — reuses `<EventRow>` from admin |
| `<BySkuView>` | Per-SKU bin distribution + unit count by status + ledger summary | Adapt today's `SkuDetailView.tsx` |
| `<ByBinView>` | Per-bin contents + last-counted + cycle-count link | Adapt today's `LocationDetailView.tsx` |
| `<ByUnitView>` | Per-unit summary (status, condition, location) + mini-timeline | Adapt admin's per-unit page (compact) |
| `<ByFilterResultList>` | Virtualized list of units matching the filter combo | New |
| `<InventoryRightPanel>` | Slide-over detail when a row is clicked from the list | New |

### Filter dropdown spec

Each dropdown is a multi-select with search. Selecting any value adds a chip to the active-filter bar. Filters compose with AND.

- **State** — multi-select of all 19 `serial_status_enum` values, color-coded badges
- **Condition** — `BRAND_NEW / USED_A / USED_B / USED_C / PARTS`
- **Location** — autocomplete on `locations.name` or `locations.barcode`
- **Time range** — preset pills (`Last 1h`, `Today`, `Last 24h`, `Last 7d`, `Custom range`)
- **Actor** — autocomplete on staff name

Applied filters appear as removable chips immediately below the search bar. Hitting `Esc` clears all.

### Saved views

Operators frequently re-run the same query (e.g., "STOCKED USED_A iPhones"). Add a small "Save view" button next to the chip row. Saved views live in `localStorage` first (no schema change) — promote to a `staff_saved_views` table later if there's demand.

### Mobile

On `<md` (≤768px), the split disappears: list takes the full width; tapping a row pushes the right panel as a separate route (`/inventory/unit/{id}`), with a back gesture returning to the list (preserves filter state in the URL).

---

## 7. Warehouse page — modern UX/UI

The most visual of the three. The current `/inventory` shell has the right components (`WarehouseMap`, `RoomsBoard`, `BinsTable`); the rename is mostly relabelling + IA polish.

### Layout

```
┌────────────────────────────────────────────────────────────────────┐
│  Warehouse                                                          │
│  ────────────────────────────────────────────────────────────────  │
│  [Map] [List] [Print Labels]                          [+ Add bin]   │  ← view toggle
│  ────────────────────────────────────────────────────────────────  │
│                                                                     │
│   ROOM 1            ROOM 2            ROOM 3                        │
│   ┌──┬──┬──┐        ┌──┬──┬──┐        ┌──┬──┬──┐                  │
│   │██│▓▓│░░│        │▓▓│██│░░│        │░░│░░│██│      ← grid       │
│   │██│██│██│        │██│▓▓│▓▓│        │██│██│▓▓│                  │
│   │██│██│██│        │░░│░░│██│        │██│██│██│                  │
│   └──┴──┴──┘        └──┴──┴──┘        └──┴──┴──┘                  │
│   23/30 bins        18/30 bins        25/30 bins                    │
│                                                                     │
│  ─── Click a bin → side flyout ──────────────────────────────────  │
└────────────────────────────────────────────────────────────────────┘
```

### Three view modes (toggle pills at the top)

#### Map (default)

A grid layout, one block per room. Each room renders its bins as cells:
- Fill state via heat: white = empty, light blue = <50%, blue = 50–95%, dark blue = ≥95%, red = >100% (over capacity)
- Stale-count badge in the corner (orange dot when `last_counted` is older than X days)
- Click a cell → right-side flyout with bin contents

The map uses the existing `WarehouseMap.tsx` + `RoomsBoard.tsx` components. Polish: clearer fill-level legend, room-collapse toggle (`–` to fold a whole room into a single row), and a small minimap on the right when many rooms exist.

#### List

A table view (the existing `BinsTable.tsx`) with the same data:
- bin code, room, capacity, current qty, fill %, # SKUs, last counted
- Sortable, filterable
- Bulk-action checkboxes for cycle-count campaigns ("Snapshot selected for a new campaign")

The bulk-action bar (the existing `BinsBulkActionBar.tsx`) lives at the bottom and grows the existing actions:
- Snapshot for cycle count (new — links to `/admin/inventory-v2/cycle-counts`)
- Print bin labels (existing)
- Mark all counted (existing)

#### Print Labels

Today's `LabelPrintWorkspace.tsx`. Layout polished:
- Left: bin selector tree (rooms → bins, with multi-select)
- Center: live preview of one label
- Right: print profile picker (`printer_profiles` rows) + copies count + Print button

### Components

All existing — relabel + minor polish, no rewrite:

| Existing component | New home |
|---|---|
| `src/components/inventory/InventoryShell.tsx` | `src/components/warehouse/WarehouseShell.tsx` |
| `src/components/inventory/WarehouseMap.tsx` | `src/components/warehouse/WarehouseMap.tsx` |
| `src/components/inventory/RoomsBoard.tsx` | `src/components/warehouse/RoomsBoard.tsx` |
| `src/components/inventory/BinsTable.tsx` | `src/components/warehouse/BinsTable.tsx` |
| `src/components/inventory/BinDetailFlyout.tsx` | `src/components/warehouse/BinDetailFlyout.tsx` |
| `src/components/inventory/RoomManager.tsx` | `src/components/warehouse/RoomManager.tsx` |
| `src/components/inventory/LabelPrintWorkspace.tsx` | `src/components/warehouse/LabelPrintWorkspace.tsx` |
| `src/components/inventory/SkuLocationFinder.tsx` | `src/components/warehouse/SkuLocationFinder.tsx` |
| `src/components/inventory/BinsFilterBar.tsx` | `src/components/warehouse/BinsFilterBar.tsx` |
| `src/components/inventory/BinsBulkActionBar.tsx` | `src/components/warehouse/BinsBulkActionBar.tsx` |
| `src/components/inventory/FillBar.tsx` | `src/components/warehouse/FillBar.tsx` |
| `src/components/inventory/StatusChip.tsx` | `src/components/warehouse/StatusChip.tsx` |

### New polish for Warehouse

1. **Open-DRIFT-alerts banner** at the top when the drift-check cron has flagged anything. Click → `/admin/inventory-v2` drift section.
2. **Open cycle-count campaigns** strip below the toolbar — shows any campaign with `pending_review` lines, click to jump to `/admin/inventory-v2/cycle-counts/[id]`.
3. **Bin search field** that accepts barcode scans (GS1 internal `/l/{ref}` URLs route here via the scan resolver).
4. **"Show empty bins"** toggle — by default empty bins fade, with toggle they become full-opacity.

---

## 8. Shared components and tokens

A few primitives the three pages need in common; build once in `src/design-system/components/inventory/` (or under each component's existing home) and reuse:

| Primitive | Purpose | Approx LoC |
|---|---|---|
| `<StatusBadge>` | Tag rendering one of the 19 `serial_status_enum` values with a consistent color palette | 30 |
| `<ConditionBadge>` | Tag for `condition_grade_enum` (5 values) | 25 |
| `<FillBar>` | Horizontal bar: current vs max with heat color | already exists |
| `<EventRow>` | One inventory_events row, condensed: event_type, prev→next, when, actor | 60 |
| `<UnitChip>` | Inline-renderable unit reference (id + short serial) with hover-card preview | 50 |
| `<SkuChip>` | Inline-renderable SKU reference, hover preview | 50 |
| `<BinChip>` | Inline-renderable bin reference, hover preview | 50 |
| `<ScanInput>` | Search field that calls `parseScannedUrl` + `classifyInput` and routes accordingly | 80 |
| `<RelativeTime>` | "2h ago" with tooltip showing absolute timestamp | already exists |
| `<EmptyState>` | Empty-list/zero-results state with consistent voice and CTA | already exists |

Color palette anchored to the design tokens already in place (`--ds-color-base-*`). Status badges:

| Status | Color |
|---|---|
| UNKNOWN | gray |
| RECEIVED, TRIAGED | blue |
| IN_TEST | indigo |
| IN_REPAIR, REPAIR_DONE | amber |
| TESTED, GRADED | emerald |
| STOCKED | green |
| ALLOCATED, PICKED, PACKED, LABELED, STAGED | purple |
| SHIPPED | gray-200 |
| RETURNED, RMA | orange |
| ON_HOLD | red |
| SCRAPPED | red |

Condition badges:

| Grade | Color |
|---|---|
| BRAND_NEW | white border, gray text |
| USED_A | emerald |
| USED_B | yellow |
| USED_C | orange |
| PARTS | red |

These mirror what the admin pages already use, just extracted to one shared primitive.

---

## 9. Mobile / narrow-viewport behavior

The warehouse runs an Electron desktop app for stationary stations and a phone-friendly web app for floor staff. All three pages must work at `≤768px`.

| Page | Mobile shape |
|---|---|
| Products | Single-column list; tapping a row pushes detail as a separate route. Search is sticky at the top. New-product CTA in a FAB. |
| Inventory | Search bar dominant; no split view. Filter chips collapse into a single "Filters" sheet. Tapping a result pushes the detail page. |
| Warehouse | Map view replaced with a sectioned list of rooms (each section collapsible). Tap a bin → flyout. Print Labels view requires connecting to a print profile; on mobile it just lists which printers are available. |

For all three: the existing `RouteShell` (`@/design-system/components/RouteShell`) already handles the desktop sidebar vs mobile sheet split, so we lean on it.

---

## 10. Search and filter language

A consistent search-input grammar across the three pages reduces operator cognitive load. Each page accepts the same inputs; only the default routing differs.

### Recognized inputs

| Input shape | Resolves to |
|---|---|
| Numeric, ≤7 digits | unit id (`serial_units.id`) |
| Numeric, 14 digits | GTIN → product |
| SKU-like (alphanumeric + dashes, contains a category prefix) | SKU code |
| Letter-letter-digit-digit-digit (`A-12-03`) | bin barcode |
| Starts with `https://…/01/{gtin}/21/{serial}` | unit via parseScannedUrl |
| Starts with `https://…/l/{ref}` | bin via parseScannedUrl |
| Starts with `https://…/s/{sku}` | SKU |
| Any tracking-shaped string | order via tracking |
| Anything else | full-text search across SKU title + serial number + notes |

### Cross-page consistency

The same `<ScanInput>` component lives on every page header. The behavior is uniform — only the **default landing** when no filter is set differs:

| Page | Default landing |
|---|---|
| Products | First match navigates to the product detail |
| Inventory | First match populates filters + opens the right panel |
| Warehouse | First match opens the bin flyout |

A keyboard shortcut (`/` or `⌘K`) focuses the input from anywhere.

---

## 11. Realtime + caching contract

All three pages need to feel live without polling-induced jitter.

### Channels (Ably)

| Page | Subscribes to |
|---|---|
| Products | `db:public:sku_catalog`, `db:public:sku_platform_ids` |
| Inventory | `db:public:inventory_events`, `db:public:serial_units`, `db:public:sku_stock_ledger`, optional row-level on `serial_units:{id}` when a detail panel is open |
| Warehouse | `db:public:bin_contents`, `db:public:locations` |

On receive: invalidate the relevant React Query cache tag and refetch. No full-page reloads.

### Cache tags (Upstash + in-memory)

| Tag | Used by |
|---|---|
| `products` | Products list query |
| `products:{sku}` | Single product detail |
| `inventory-events` | Inventory pulse view |
| `serial-units` | All Inventory unit queries |
| `serial-units:{id}` | Single-unit detail in side panel |
| `bin-contents` | Warehouse map + bin list |
| `bin-contents:{location_id}` | Single bin flyout |

Invalidation: anything that mutates a row publishes the matching tag invalidation after commit. The existing `invalidateCacheTags` helper in `src/lib/cache/upstash-cache.ts` already supports this pattern.

---

## 12. Permissions and gating

Re-use existing permissions from `src/lib/auth/permissions-shared.ts`:

| Page / action | Permission |
|---|---|
| Products list, detail | `sku_stock.view` (read-only) |
| Products edit, new, bulk | `sku_stock.manage` |
| Inventory list, detail, scan | `sku_stock.view` |
| Inventory open-DRIFT panel | `admin.view` |
| Warehouse map, list | `sku_stock.view` |
| Warehouse bin actions (set qty, swap, add SKU) | `bin.*` (already wired) |
| Warehouse label printing | `print.label` |

No new permissions needed.

---

## 13. Migration and rollout

The rename touches dozens of files (routes + components + sidebar panels + nav labels + every `href` referencing the old paths). Doing it as a single big-bang commit is risky because it ripples across the whole app. Recommended approach:

### Phase A — Add new routes alongside the old (no rename yet, ~1 day)

1. Copy `src/app/sku-stock/page.tsx` → `src/app/inventory/page.tsx` (component imports unchanged for now). Both routes render the same content. **`/inventory` previously rendered the warehouse map — that existing file is moved to `/warehouse/page.tsx` first.**
2. Copy `src/app/inventory/page.tsx` (warehouse) → `src/app/warehouse/page.tsx`. Both routes render the same warehouse content.
3. Stub `/products/page.tsx` with a placeholder card so the route exists and the sidebar link lands somewhere.

Now both old and new URLs work. No operator workflow breaks.

### Phase B — Modernize each page in place (~1 week each)

Iterate on `/products`, then `/inventory`, then `/warehouse` — building out the new components and progressively replacing the old shell with the modernized one. Use feature flags (`PRODUCTS_V2_NEW_UI`, `INVENTORY_V2_NEW_UI`, `WAREHOUSE_V2_NEW_UI`) to render the old shell when off and the new shell when on. Default off.

This lets operators preview each page individually without the whole app shifting around them.

### Phase C — Flip flags + sidebar relabeling (~1 day)

Once the new UIs are validated:
1. Flip the three flags on
2. Update the sidebar labels to the new names
3. Add the `/sku-stock/*` → `/inventory/*` redirect in `next.config.js`
4. Add the temporary "Looking for the warehouse map?" banner on `/inventory`

### Phase D — Remove the old code (~1 day, two weeks later)

After two clean weeks:
1. Delete `src/app/sku-stock/`
2. Delete the duplicated `src/app/inventory/page.tsx` (replaced by the new content)
3. Delete the legacy component folders (`src/components/sku/`, `src/components/inventory/`) by then renamed
4. Drop the feature flags
5. Drop the temporary banner

### Risk mitigation

- Operator bookmarks: the `/sku-stock/*` redirect rule catches them. Add a brief in-app announcement banner.
- Slack-shared deep links: same — redirect handles them.
- Mobile app: if the Electron / mobile app has hardcoded URLs, audit before flipping flags. Run `grep -rn "/sku-stock" .` after Phase A.
- Print-label profiles: warehouse page changes don't touch the printer-profile data; safe.

---

## 14. Implementation plan

Concrete file-level plan, ordered by Phase. Each row is a single commit.

### Phase A — Routes exist (no UI change)

| # | Action | File |
|---|---|---|
| A1 | Move warehouse files (free up the name) | `src/app/inventory/page.tsx` → `src/app/warehouse/page.tsx` |
| A2 | Copy SKU stock content to new home | `src/app/sku-stock/page.tsx` → `src/app/inventory/page.tsx` |
| A3 | Stub products route | new `src/app/products/page.tsx` |
| A4 | Add `next.config.js` redirect `/sku-stock/*` → `/inventory/*` | `next.config.js` |
| A5 | Add sidebar entries for `/products` + `/warehouse`; keep `/sku-stock` for now | sidebar component(s) |

### Phase B — Products modernization

| # | Action | File |
|---|---|---|
| B1 | Create `src/components/products/` | new dir |
| B2 | Build shared primitives (`StatusBadge`, `ConditionBadge`, `ScanInput`, `<SkuChip>`, etc.) | `src/components/inventory-shared/` |
| B3 | Build `<ProductsShell>` + `<ProductsToolbar>` + `<ProductsTable>` | `src/components/products/` |
| B4 | Build `<ProductSheet>` + `<NewProductDialog>` | `src/components/products/` |
| B5 | Build `/products/[sku]` detail page | `src/app/products/[sku]/page.tsx` |
| B6 | Wire feature flag `PRODUCTS_V2_NEW_UI` | `src/lib/feature-flags.ts` (existing) |

### Phase B — Inventory modernization

| # | Action | File |
|---|---|---|
| B7 | Build `<InventoryShell>` + `<InventorySearchBar>` + `<InventoryFilterChips>` | new `src/components/inventory/` |
| B8 | Build `<PulseView>`, `<BySkuView>`, `<ByBinView>`, `<ByUnitView>`, `<ByFilterResultList>` | new |
| B9 | Build `<InventoryRightPanel>` | new |
| B10 | Hook up Ably channel subscriptions + React Query cache tags | `src/components/inventory/InventoryShell.tsx` |
| B11 | Wire `INVENTORY_V2_NEW_UI` flag; render old `<SkuStockWorkspace>` when off | the page file |

### Phase B — Warehouse modernization

| # | Action | File |
|---|---|---|
| B12 | Rename `src/components/inventory/` → `src/components/warehouse/` (the existing one) | git mv |
| B13 | Update imports in `src/app/warehouse/page.tsx` | one file |
| B14 | Polish: DRIFT-alert banner, open-campaign strip, empty-bin toggle | `WarehouseShell` |
| B15 | Wire `WAREHOUSE_V2_NEW_UI` flag | flag file |

### Phase C — Flag flips + cleanup

| # | Action |
|---|---|
| C1 | Flip the three `*_V2_NEW_UI` env vars on Vercel |
| C2 | Update sidebar labels: SKU Stock → Inventory, Inventory → Warehouse, add Products |
| C3 | Add `/inventory` "moved to /warehouse" banner |
| C4 | Audit any remaining hard-coded `/sku-stock` paths |

### Phase D — Remove legacy

| # | Action |
|---|---|
| D1 | Delete `src/app/sku-stock/` |
| D2 | Delete old `src/components/sku/` after move to `src/components/inventory/` |
| D3 | Drop the three feature flags |
| D4 | Remove the temporary banner |

### Estimated effort

| Phase | Effort |
|---|---|
| A | 1 day |
| B Products | 4–6 days |
| B Inventory | 5–7 days |
| B Warehouse | 1–2 days (mostly rename) |
| C | 1 day |
| D | 1 day |
| **Total** | **2.5–3.5 weeks** |

---

## 15. Open decisions

1. **Where does Products live in the sidebar?** Suggest: top of the nav, above Inventory and Warehouse, since "what is it" precedes "where is it".
2. **Should Products auto-mint a GTIN on save?** Current behavior: GTIN auto-mints on first label print via `getOrCreateInternalGtin`. Modernization could pre-mint at create time so the GTIN is always available; tradeoff is "wasted" GTIN numbers for SKUs that never get a label. Recommendation: keep lazy mint.
3. **Product image storage?** `sku_catalog.image_url` is text today; assume it stays a URL pointing at external storage (Ecwid CDN, etc.). If the warehouse wants to upload its own photos, we need a Vercel Blob path. Defer.
4. **Saved views — server-side or localStorage-only?** Recommendation: localStorage for v1, promote to a `staff_saved_views` table if operators ask for shareable links.
5. **Empty-bin display on Warehouse map** — fade by default vs hide vs show normally. Suggest: fade (`opacity-30`) by default with a toggle to fully show.
6. **Cycle-count snapshot from Warehouse** — should the bulk-action bar's "Snapshot for cycle count" jump to `/admin/inventory-v2/cycle-counts` to confirm campaign name/tolerance, or do it inline? Recommend: jump to admin for the form, with bins preselected.
7. **Realtime granularity for the Inventory ledger** — subscribing to every `inventory_events` row may be too chatty in busy hours. Tradeoff: server-side debounce (publish every 1s with a batched payload) vs row-level subscription only when a detail panel is open. Recommendation: row-level only.
8. **Mobile FAB pattern** — every page has a different primary action. Suggest a single `<MobilePrimaryFab>` primitive that renders the page-specific action with consistent placement.

---

*End of plan v1. Iterate per phase as implementation reveals new requirements.*
