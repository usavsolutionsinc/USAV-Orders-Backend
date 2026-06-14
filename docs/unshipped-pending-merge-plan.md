# Merge "Awaiting" + "Pending" into one **Unshipped** mode — implementation plan

_Status: plan only (2026-06-13). Work-on-main._

## 0. Decision summary (locked with owner)

- **Goal:** collapse the two pre-ship modes — **Awaiting** and **Pending** — into a
  single **Unshipped** mode, a single filtered list of *all* not-yet-shipped orders.
- **Name / URL:** tab label **"Unshipped"**, param **`?unshipped`**. Old `?pending`
  links resolve to the same view (no hard redirect needed — both params map to one view).
- **Layout:** ONE unified list. Reuse the **existing `FilterRefinementBar`** component
  (do not build a new segment control) to filter by **stage** (All · Awaiting · Pending)
  plus existing facets. The stage is already visible per-row (Awaiting rows show the
  **Add TRK#** affordance; Pending rows show a real tracking chip).
- **Sync consolidation:** combine the two separate sync surfaces — the main **Sync**
  dialog and the **Sync & Backfill** panel — into **one Sync button + one tabbed
  popover/dialog**.
- **Additions in scope:** (1) count badges on the mode tabs, (2) align the mobile
  PickQueue, (3) sort the unified list by **stage + priority**.

## 1. The two stages (verified semantics)

These are two **sequential stages of the same pre-ship pipeline**, not unrelated views:

| Stage | Today's param | Predicate | Needs | Row affordance |
|---|---|---|---|---|
| **Awaiting** | `?unshipped` | `o.shipment_id IS NULL` | a carrier label / tracking | **Add TRK#** chip (paste) |
| **Pending** | `?pending` | `o.shipment_id IS NOT NULL` AND no `station_activity_logs` row for that shipment | to be physically packed | real tracking chip |
| (Shipped) | `?shipped` | has shipment AND packed/shipped | — | — |

**Union (the new Unshipped list)** = `NOT (has shipment AND packed)` ≈ *every non-FBA
order that isn't packed yet*. Per-row **stage** is derived purely from
`shipment_id`: `stage = shipment_id == null ? 'awaiting' : 'pending'`.

## 2. Current-state map (file:line)

**Mode rail / detection**
- `src/components/DashboardSidebar.tsx:57` — `DASHBOARD_ORDERS_SUBVIEW_ITEMS` (Awaiting/Pending/Shipped/Warranty).
- `src/utils/dashboard-search-state.ts:6` — `type DashboardOrderView = 'pending' | 'unshipped' | 'shipped' | 'fba' | 'warranty'`.
- `:33` `getDashboardOrderViewFromSearch()` (checks `shipped`/`unshipped`/`pending`/`fba`/`warranty`; default `'pending'`).
- `:48` `normalizeDashboardOrderViewParams()` (deletes all view params, sets the chosen one).
- `src/hooks/useDashboardSearchController.ts:75` `setOrderView()`.

**Data layer**
- `src/lib/queries/dashboard-queries.ts` — `unshippedOrdersQuery()` (staleTime 5m) / `pendingOrdersQuery()` (staleTime 60s).
- `src/lib/dashboard-table-data.ts:157` `fetchUnshippedOrdersData()` → `/api/orders?awaitingOnly=true`, client-filters `shipment_id == null`.
- `:65` `fetchPendingOrdersData()` → `/api/orders?excludePacked=true`, `dedupeByOrderId`, client-filters `shipment_id != null`.
- `src/app/api/orders/route.ts:81` `awaitingOnly` → `AND o.shipment_id IS NULL`; `:77` `excludePacked` → `AND NOT EXISTS (station_activity_logs …)`.
- `src/queries/keys.ts:26` `dashboardTable.{pending,unshipped,shipped,shippedFba}`.

**Components**
- `src/components/unshipped/UnshippedTable.tsx` (Awaiting) and `src/components/PendingOrdersTable.tsx` (Pending) — both render `src/components/dashboard/OrdersQueueTable.tsx`.
- Sidebars: `src/components/unshipped/UnshippedSidebar.tsx` (Awaiting) vs `src/components/sidebar/DashboardManagementPanel.tsx` (Pending/default).
- `src/components/unshipped/UnshippedDetailsPanel.tsx` — shared details (mode-agnostic).
- Page routing: `src/app/dashboard/page.tsx:116` (`orderView` switch).

**Sync surfaces (to merge)**
- **Main Sync:** `DashboardManagementPanel.tsx` — `handleTransfer`/`consumeTransferStream`/`consumeExceptionsStream` (`streamNdjson`, `/api/orders-exceptions/sync`) → **`src/components/sidebar/OrderSyncDialog.tsx`** which ALREADY has tabs `sheets | ecwid | exceptions` (state types in `src/lib/orders-sync/types.ts`).
- **Sync & Backfill:** `src/components/unshipped/AwaitingEbayPanel.tsx` — eBay backfill (`/api/orders/backfill/ebay`), Ecwid backfill (`/api/orders/backfill/ecwid`), integrity-check (`/api/orders/integrity-check`).

**Realtime**
- `src/hooks/useRealtimeInvalidation.ts:52` (invalidates both `pending` + `unshipped` keys), `src/hooks/useDeleteOrderRow.ts:66`, plus per-table Ably `setQueriesData` (`UnshippedTable.tsx`, `PendingOrdersTable.tsx`; the latter also handles `order.tested`).

**Mobile / deep links**
- `src/components/mobile/redesign/PickQueue.tsx` + `src/components/mobile/feed/rows/PendingOrderRow.tsx` target the `?pending` table + `PENDING_QUERY_KEY`.
- `src/app/api/work-orders/route.ts:245` builds `sourcePath: '/dashboard?pending='`.

**Filter component to reuse**
- `src/design-system/components/FilterRefinementBar.tsx` — `{ label, refinements[], activeCount, renderDropdown(onClose), onClearAll, variant: 'sidebar' }`. Analog usage: `src/components/sidebar/receiving/IncomingSidebarPanel.tsx` (facet-filters a unified list by colored state pills with counts).

## 3. Target architecture (phased)

Each phase is independently shippable; keep both `?unshipped` and `?pending` resolving to the new view throughout so nothing breaks mid-migration.

### Phase 1 — Data layer: one query, both stages
- **API:** add a unified scope to `src/app/api/orders/route.ts` — `unshippedScope=true` →
  `WHERE (o.shipment_id IS NULL) OR NOT EXISTS (SELECT 1 FROM station_activity_logs sal WHERE sal.shipment_id = o.shipment_id)`
  (i.e. `awaitingOnly` ∪ `excludePacked`). Keep `awaitingOnly`/`excludePacked` for now (mobile still uses them).
- **Fetch:** broaden `fetchUnshippedOrdersData()` to call `unshippedScope=true`, return *both* stages, and tag each record with a derived `stage: 'awaiting' | 'pending'` (in `toOrderRecord`). Unify the dedupe (`dedupeByOrderId`) and the non-search client filter (`!(shipment_id != null && packed)`).
- **Query:** `unshippedOrdersQuery()` becomes the single source; pick **staleTime 60s** (the more-live of the two). `pendingOrdersQuery()` → thin alias that delegates to it (kept only until mobile migrates).
- **Keys:** `src/queries/keys.ts` — collapse `pending` + `unshipped` to one `dashboardTable.unshipped`; add a `pending` alias const pointing at the same tuple for transitional code.

### Phase 2 — View + URL
- `dashboard-search-state.ts`: in `getDashboardOrderViewFromSearch`, map `?pending` → `'unshipped'`; change default fallback to `'unshipped'`. `normalizeDashboardOrderViewParams` still deletes `pending` (so switching modes cleans it up). Optionally drop `'pending'` from the `DashboardOrderView` union (or keep as deprecated alias).
- `DASHBOARD_ORDERS_SUBVIEW_ITEMS`: remove the `pending` item; relabel `unshipped` → **"Unshipped"**. Result rail: **Unshipped · Shipped · Warranty**.
- **Stage sub-state:** read an optional `?stage=awaiting|pending|all` (default `all`) in the table for the filter (Phase 4). Lives alongside `?unshipped`.

### Phase 3 — Unified table
- Make `UnshippedTable.tsx` the single pre-ship table. Fold in from `PendingOrdersTable.tsx`: the `order.tested` Ably patch (sets `has_tech_scan`) and a merged empty state ("No unshipped orders").
- `OrdersQueueTable.tsx`: add **stage + priority sort** — awaiting before pending, then by deadline/`daysLate` (reuse the existing priority axis); apply the `?stage` filter; expose row counts (total + per-stage) for badges (Phase 7). The per-row stage is already legible via the tracking column, so no new chip is required (optional faint stage label in the meta `rest` slot if desired).
- `dashboard/page.tsx`: delete the `pending` branch; `unshipped` and default both render the unified `UnshippedTable`. Retire `PendingOrdersTable.tsx` once mobile no longer imports its query key.

### Phase 4 — Reuse FilterRefinementBar for the stage/facet filter
- Add a `FilterRefinementBar` (variant `'sidebar'`) section to the unified `UnshippedSidebar`, modeled on `IncomingSidebarPanel`. Refinements:
  - **Stage** — All · Awaiting · Pending (colored pills; counts from Phase 7) → writes `?stage`.
  - **Existing facets** — platform, packer (`packedBy`), tester (`testedBy`) → writes the existing query params already plumbed through `OrderQueryParams`.
- Active pills + `onClearAll`. This is the "import the existing filter component" the owner asked for — no bespoke segment control.

### Phase 5 — One Sync button + tabbed popover (Sync + Backfill)
- Extract the sync orchestration out of `DashboardManagementPanel` into a shared `useOrdersSync()` hook (the `handleTransfer` + stream consumers + `OrderSyncDialog` state).
- Build/extend a single **`OrdersSyncPopover`** with top-level tabs:
  - **Sync** — Google Sheets / Ecwid Direct / Resolved Exceptions (the existing `OrderSyncDialog` content + streams).
  - **Backfill** — eBay backfill, Ecwid backfill, integrity-check (from `AwaitingEbayPanel`).
- One **"Sync"** trigger button in the unified sidebar opens it. Retire `AwaitingEbayPanel`'s standalone "Sync & Backfill" block (it becomes the Backfill tab).

### Phase 6 — Sidebar consolidation
- Unified `UnshippedSidebar` = search + `FilterRefinementBar` + recent searches + Sync button (Phase 5) + new-order intake + "see shipped matches" handoff.
- `DashboardSidebar.tsx`: remove the `pending → DashboardManagementPanel` branch; route default → unified `UnshippedSidebar`. Salvage any pending-only bits from `DashboardManagementPanel` then retire it.

### Phase 7 — Count badges on tabs
- Extend `HorizontalSliderItem` rendering to show a count badge. Source: derive total + per-stage counts from the unified query cache (cheap, already fetched), or add a small `/api/orders/counts`. Show **total** on the Unshipped tab; **per-stage** counts on the FilterRefinementBar pills.

### Phase 8 — Mobile alignment
- Point `PickQueue.tsx` / `PendingOrderRow.tsx` at the unified query key (or keep the `pending` alias). Decide scope: packers likely still want the **Pending stage only** on mobile — keep that as a stage-scoped read of the unified data, not a separate query.

### Phase 9 — Realtime collapse
- Replace every `['dashboard-table','pending']` + `['dashboard-table','unshipped']` pair with the single key: `useRealtimeInvalidation.ts`, `useDeleteOrderRow.ts`, `keys.ts`, and the table's Ably `setQueriesData`. Union the listeners (`order.changed`, `order.assignments`, `order.tested`).

### Phase 10 — Cleanup + verify
- Remove dead exports once mobile is migrated: `pendingOrdersQuery`, `fetchPendingOrdersData`, `PendingOrdersTable`, `DashboardManagementPanel` (knip wave per the project's dead-code protocol).
- `tsc --noEmit` + `eslint` (touched files) + `next build`. Manual verify: Unshipped list shows both stages; Add TRK# on awaiting rows; pack flow clears pending rows; `?pending` deep links land on Unshipped; counts + filter + sync popover work.

## 4. Risks / edge cases

- **Search scope:** today, searching in either mode returns all matches regardless of stage (so any order is findable). Preserve that — the unified search must not be stage-gated.
- **`staleTime` divergence** (5m vs 60s) — standardize on 60s.
- **Dedupe divergence** — `fetchPendingOrdersData` dedupes by order id; `fetchUnshippedOrdersData` does not. Apply dedupe in the unified path.
- **Mobile packer semantics** depend on the Pending predicate; keep a stage-scoped read so packers aren't shown untracked (awaiting) orders.
- **Sort:** awaiting rows may lack a packer/deadline; define a deterministic stage-then-deadline order.
- **`normalizeDashboardOrderViewParams`** must still strip `pending` so it doesn't linger in the URL after a mode switch.

## 5. Suggested sequencing

1 (data+URL, both params resolve) → 3 (table merge) → 4 (filter) → 5 (sync popover) → 7 (counts) → 8 (mobile) → 9 (realtime) → 10 (cleanup). Phases 1–3 deliver the visible merge; 4–10 are the "additions."

## 6. File-change checklist

| File | Change |
|---|---|
| `src/app/api/orders/route.ts` | add `unshippedScope` union predicate |
| `src/lib/dashboard-table-data.ts` | broaden `fetchUnshippedOrdersData`, derive `stage`, unify dedupe/filter |
| `src/lib/queries/dashboard-queries.ts` | `unshippedOrdersQuery` = single source; `pendingOrdersQuery` → alias |
| `src/queries/keys.ts` | collapse pending+unshipped key; add transitional alias |
| `src/utils/dashboard-search-state.ts` | `?pending`→`unshipped`; default `unshipped`; add `?stage` |
| `src/components/DashboardSidebar.tsx` | rail items (drop Pending), remove pending sidebar branch, mount unified sidebar |
| `src/app/dashboard/page.tsx` | remove pending branch; default→unified table; prefetch single query |
| `src/components/unshipped/UnshippedTable.tsx` | absorb pending Ably/empty-state; stage+priority sort; emit counts |
| `src/components/dashboard/OrdersQueueTable.tsx` | stage filter + sort; (optional) stage label |
| `src/components/unshipped/UnshippedSidebar.tsx` | add `FilterRefinementBar` section + Sync button |
| `src/components/sidebar/OrderSyncDialog.tsx` (+ new `OrdersSyncPopover`, `useOrdersSync`) | Sync + Backfill tabs in one popover |
| `src/components/unshipped/AwaitingEbayPanel.tsx` | becomes the Backfill tab content |
| `src/hooks/useRealtimeInvalidation.ts`, `useDeleteOrderRow.ts` | single key |
| `src/components/mobile/redesign/PickQueue.tsx`, `…/PendingOrderRow.tsx` | unified key, stage-scoped |
| `src/components/PendingOrdersTable.tsx`, `src/components/sidebar/DashboardManagementPanel.tsx` | retire after migration |

## 7. Build progress (2026-06-13)

**Shipped (verified: tsc clean on touched files, eslint 0 new errors, build gated):**
- **Phase 1** — `fetchUnshippedOrdersData` broadened to the union via `excludePacked=true` (no new API param needed — the base query already excludes shipped, and `NOT EXISTS(station_activity_logs)` covers shipment-less awaiting rows); `unshippedOrdersQuery` staleTime → 60s; dedupe unified. `pending` path kept intact (mobile, unchanged per owner).
- **Phase 2** — `getDashboardOrderViewFromSearch` maps `?pending` + default → `unshipped`; `SIDEBAR_PAGE_NAV` + the legacy rail dropped the Pending item; nav test updated; page routing + prefetch fold default → `UnshippedTable`.
- **Phase 3** — `UnshippedTable` is the single pre-ship table (absorbed the `order.tested` Ably patch, generic empty copy); `OrdersQueueTable` sorts Awaiting-before-Pending within each day; `?stage` filter applied.
- **Phase 4** — `FilterRefinementBar` (via `SidebarShell`'s `filter` prop) drives a **Stage** filter writing `?stage`; active-stage pill + clear-all.
- **Phase 5** — extracted `useOrdersSync` hook; new **`OrdersSyncPopover`** = one "Sync Orders" button → tabbed popover **[Sync | Backfill]** (Sync = sheets/ecwid/exceptions via `OrderSyncDialog`; Backfill = `AwaitingEbayPanel`), mounted in `UnshippedSidebar` (replaced the standalone backfill panel).

**Owner feedback folded in (2026-06-13):**
- **Unshipped mode icon** → `Inbox` (was `AlertCircle`), in both `DASHBOARD_ORDERS_SUBVIEW_ITEMS` and `SIDEBAR_PAGE_NAV`.
- **"Sync Orders" button label** → explicit white (`sectionLabel`'s `text-gray-500` was invisible on blue).
- **New stage "Tested, packing"** (`?stage=tested`) — the Pending subset with `has_tech_scan` (tech-tested, currently packing); emerald pill. Uses the existing `has_tech_scan` field (no new endpoint).
- **Per-stage counts** in the filter dropdown — sidebar reuses the table's `unshippedOrdersQuery` cache key (React Query dedupes → no extra fetch) to count all / awaiting / pending / tested.

**Owner feedback round 2 (2026-06-13):**
- **Count badges moved to the far left** of each filter row, fixed width (`w-9`, centered) so every number lines up in one column.
- **Sync popover width** now matches the trigger via `--radix-popover-trigger-width` (was a fixed `w-[300px]` that over/under-hung the sidebar) → matches the master-nav/sidebar width.
- **Sort control** added to the filter dropdown (the receiving-Incoming precedent): a **Sort** section writes `?sort` (`priority` default / `newest`), surfaced as an active pill, shared clear-all resets stage + sort in one pass. `OrdersQueueTable` gained an optional `sort` prop (default `priority` = unchanged for other consumers); `newest` bands by created date, most-recent first. **This is the recommended pattern for the other tabs too** — Shipped/Warranty can read the same `?sort` with their own option sets in their own sidebars' filter dropdowns.

**Remaining / deferred follow-ups:**
- **Rail tab count badges** (total on the Unshipped tab) — needs the shared `HorizontalSliderItem`/master-nav rail to carry a badge; per-stage counts already live in the filter dropdown.
- **Retire / dedupe `DashboardManagementPanel`** — it still holds an inline copy of the sync logic now also in `useOrdersSync`; refactor it onto the hook (or retire it) once its remaining edge route (`?fba` sidebar) is confirmed dead.
- **Mobile PickQueue** — intentionally left on the `pending` stage (owner: no mobile changes for this).
