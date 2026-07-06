# Unshipped dashboard — display, fetch & performance plan

> **Status (2026-07-04): Phases 0–5 BUILT + VERIFIED.** Work-on-main. `tsc` + ESLint + DS-guards (13/13)
> + route-auth manifest + registry pin + 3 new unit/E2E specs all clean. (Phase 5 = the read *substrate*;
> its live-client cutover stays scale-gated — see its note.)
> - **Phase 0** (virtualize lane bodies) — behind `NEXT_PUBLIC_UNSHIPPED_VIRTUAL_LIST` (default ON).
>   E2E `tests/e2e/unshipped-virtual-list.spec.ts`: 500 mocked rows → ~26 in the DOM.
> - **Phase 1** (thin projection + server `stage` filter + keyset `limit`/`cursor`) — opt-in on
>   `/api/orders` (all other callers byte-for-byte unchanged). Real-DB smoke: stage split sums (4+29=33),
>   cursor pages disjointly, queue shape trims tracking arrays, legacy path intact.
> - **Phase 2** (counts endpoint + pagination) — new `/api/orders/queue-counts` (COUNT + raw combos,
>   lane mapping applied client-side via the TS SoT, Decision 8); sidebar legend / stage dropdown / nav
>   badge no longer download rows to count. Bounded 200-row page + counts-total-driven "Load more".
>   E2E `tests/e2e/unshipped-pagination.spec.ts`: 200 → 400 → footer clears at the 450 total.
> - **Phase 3** (incremental sync) — new `src/lib/queries/dashboard-cache-patch.ts`
>   (patch / remove / invalidate-counts, unit-tested 6/6). `order.tested` now patches the row in place +
>   refreshes the cheap counts instead of a broad row refetch → **0 full `/api/orders`** on an idle
>   dashboard tab; and the new counts key is refreshed on every order event (closing a Phase-2 gap where
>   the separate `unshipped-counts` prefix wasn't covered by the existing invalidations).
> - **Phase 4** (bundle deferral) — the three non-default order views (Shipped / FBA / Warranty) and both
>   detail panels are now `next/dynamic` (`ssr:false`); the default Unshipped view stays eager so its
>   first paint isn't gated on a second chunk. `tsc` + ESLint clean; dashboard E2E unaffected.
>
> - **Phase 5** (feed-projection read model) — **read substrate BUILT + verified** (per request).
>   New `src/lib/orders/feed-membership-projection.ts` computes each order's lane in Node via
>   `deriveFulfillmentState` (Decision 8 — never in SQL) and stores it in `feed_memberships.state`;
>   migration `2026-07-04a` widened the state CHECK to add the lanes (APPLIED — reuses the existing
>   `idx_feed_memberships_org_feed_state_time` index, so `getFeedState`'s GROUP BY state *is* the
>   per-lane count). Wired into the existing projection cron. Unit-tested 3/3; run live via the cron →
>   **upserted 33, byLane `{pending:29, tested:4, blocked:0}`** — matches the Phase 2 counts endpoint and
>   Phase 1 stage split exactly. **The live-client cutover is deliberately deferred** (still scale-gated):
>   the dashboard keeps reading real-time `/api/orders` — swapping to the ≤10-min-stale projection buys
>   nothing at 33 rows and only costs freshness. The substrate is one `fetchUnshippedOrdersData` swap away
>   when the metric (p95 miss > 500ms at ≥ 2k rows) fires.
>
> **Scope:** the Orders / Shipping dashboard in **Unshipped mode** (`/dashboard?unshipped` or default).
> Improve loading time, scroll performance, and long-term SaaS scalability by **extending and
> composing existing components** — not hand-rolling new UI primitives.
>
> **Headline:** the Shipped board already solved most of this (virtualized lane bodies, week
> pagination, thin fetch ceilings, Redis read models). This plan **ports those patterns to
> Unshipped** and wires them into the fetch layer the repo already has (`unshippedOrdersQuery`,
> `/api/orders`, Redis cache, Ably invalidation, feed projection substrate).
>
> **Validation (2026-07-04, code-verified):** current-state claims confirmed against the code —
> Shipped's `@tanstack/react-virtual` reference (`VirtualShippedSections` / `ShippedLaneTable` /
> `SwimlaneBoard`), Unshipped's all-rows-mounted `OrdersQueueTable`, and the unbounded, wide
> `/api/orders?fulfillmentScope=true` (Redis `api:orders`, 300s) are all as described. Four
> corrections were folded into this revision: (a) Phase 5's projector path was wrong — see §7 & Phase
> 5; (b) the "same query key" dedup between table and sidebar is only partial — see Decision 4;
> (c) `ustatus`/lane filtering must **not** be re-implemented in SQL — see Decision 8 & Phase 1;
> (d) Unshipped paginates as a deadline-sorted work queue, **not** Shipped's weekly buckets — see
> Decision 9 & Phase 2.

---

## 0. Decisions (locked unless flagged OPEN)

1. **No new design-system or row UI.** All rows stay on `OrdersQueueTableRow`, chips, `StatusLegend`,
   `SwimlaneBoard`, `SidebarShell`, etc. New code is glue, query factories, and API projection — not
   bespoke table markup.
2. **Mirror the Shipped lane pattern.** Shipped uses `SwimlaneBoard` + `ShippedLaneTable` +
   `VirtualShippedSections`. Unshipped gets the same three-layer shape: board → lane table → virtual
   window. Do not invent a second board mechanic.
3. **Extend `/api/orders`, do not fork a parallel orders API** for Phase 1–3. Add query params
   (`limit`, `cursor`, `stage`, `ustatus`, list projection flag) to the existing route and its Redis
   cache key. A dedicated `/api/orders/queue` route is acceptable only if the handler delegates to
   the same SQL builder (single SoT).
4. **Query factories stay the SoT.** All prefetch (`warmActiveView`, `BootGate`), table, and sidebar
   consumers must call `unshippedOrdersQuery()` / a sibling factory — never ad-hoc `fetch` keys.
   **Caveat (verified):** the shared key is `['dashboard-table','unshipped', {searchQuery, packedBy,
   testedBy, staffId, strictSearchScope}]`; React Query dedupes on the *full* params object, so today
   the table (`staffId`, `strictSearchScope=false`) and the sidebar/count (`strictSearchScope=true`,
   no `staffId`) are **not** the same cache entry — only the sidebar↔count pair truly dedupes. Adding
   `stage/cursor/limit` fragments this further, which is *why* counts move to their own factory
   (Phase 2), not onto the list key. Ably/DOM patches match by key **prefix**, so they still update
   every param variant.
5. **Invalidate-on-write stays canonical.** Order mutations continue through `invalidateOrderViews()`
   → org-scoped Redis tag bust + Ably publish. Client-side broad invalidates remain the reconnect
   safety net only.
6. **Feed projection (`orders_unshipped`) is Phase 5, not Phase 0.** Phases 0–4 deliver wins on
   today's tables; Phase 5 aligns with `docs/todo/universal-feed-polymorphic-plan.md` when queue
   depth outgrows SQL+Redis.
7. **OPEN — dense (non-board) unshipped view.** Today Unshipped always mounts `UnshippedShelfBoard`.
   If a future “table-only” toggle is added, it should reuse `OrdersQueueTable` with the same
   virtualized path — not a third renderer. This is where the **compact lane + “full-screen”/expand
   toggle** (owner's ask) lands: the compact lane is today's `autoHeight` `OrdersQueueTable`; “expand”
   mounts the *same* virtualized `OrdersQueueTable` dense and full-height — one renderer, two size
   modes, never a second table.
8. **Fulfillment-state / lane membership derivation stays in the TS SoT — never re-implemented in
   SQL.** `deriveFulfillmentState` (SoT: `src/lib/order-lifecycle.ts`) is the only place lane/`ustatus`
   is decided. Phase 1 keeps that derivation in TS (client-side over a thin projection). The long-term
   answer (Decision 9 + Phase 5) is the `orders_unshipped` **projector**, which runs in Node and calls
   the *same* `deriveFulfillmentState`, writing its result into indexed columns — so reads get
   server-side lane filtering + per-lane pagination with **zero** mapping duplication. `stage`
   (`has_tech_scan`) is a raw column, so a SQL predicate on it is fine; fulfillment **state** is not.
9. **Unshipped paginates as a deadline-sorted work queue, not weekly buckets.** Shipped's weekly
   bucketing fits an archival history you browse by calendar; the Unshipped queue answers “what ships
   next,” so the model is: **default sort = ship-by/deadline ASC** (with the existing per-lane
   `LaneSortMenu` offering order-date / other sorts), **bounded by the date-range (“all dates”) control
   already on `SwimlaneBoard`**, and **keyset “load more” within that window**. True per-lane “load
   more” depends on server-side lane filtering, so it lands with the Phase 5 projector (Decision 8);
   until then, load-more is a global deadline cursor and lanes fill from the same window.

---

## 1. Industry benchmark & targets

Mature B2B ops dashboards (Shopify fulfillment, Linear inbox, Stripe dashboard lists) converge on:

| Concern | Industry norm | Target for Unshipped |
|--------|---------------|---------------------|
| Initial list paint | Shell + counts fast; rows stream or hit warm cache | ≤ 1s to first rows on sign-in (BootGate hit); ≤ 300ms on cache hit |
| List API payload | Thin list DTO (15–25 fields), not detail shape | ≤ 50KB gzip for default page (200 rows) |
| Scroll | Virtualized DOM for 100+ rows | 60fps scroll at 1,000+ rows across lanes |
| Pagination | Cursor/keyset, explicit “load more” | Default 200 rows total (configurable per lane in Phase 2) |
| Freshness | Patch or row-level invalidation; full refetch on reconnect | Single scan → 0–1 row network cost (Phase 3) |
| Counts vs list | Counts endpoint or projection table | Sidebar legend renders before board rows (Phase 2) |

**Acceptance gates (per phase below)** must pass in Chrome DevTools Performance + Network on a tenant
with ≥ 500 unshipped rows (seed fixture or staging).

---

## 2. Current-state map

### 2.1 Route & composition

| Layer | File | Role in Unshipped mode |
|-------|------|------------------------|
| Page shell | `src/app/dashboard/page.tsx` | `BootGate` → `DashboardOrdersView` + `DashboardOrderDetails` |
| Main region switch | `src/components/dashboard/DashboardOrdersView.tsx` | Renders `UnshippedTable` when `orderView !== shipped/fba/warranty` |
| Table orchestrator | `src/components/unshipped/UnshippedTable.tsx` | React Query fetch, Ably patch, stage/status client filters → `UnshippedShelfBoard` |
| Board | `src/components/unshipped/UnshippedShelfBoard.tsx` | `SwimlaneBoard` + per-lane `OrdersQueueTable` (`autoHeight`, `hideHeader`) |
| Row renderer | `src/components/dashboard/OrdersQueueTable.tsx` | Date bands → `QueueDateSection` → `OrdersQueueTableRow` (**all rows mounted**) |
| Sidebar | `src/components/sidebar/DashboardOrdersContextPanel.tsx` → `UnshippedSidebar.tsx` | Search, filters, legend, sync — **same `unshippedOrdersQuery` key** |
| Details | `src/components/dashboard/DashboardOrderDetails.tsx` → `UnshippedDetailsPanel` | Thin wrapper → `ShippedDetailsPanel` (`context="fulfillment"`) |
| Bulk actions | `ContextualSelectionBar` | When pencil select enabled |

### 2.2 Data flow (today)

```
URL (?unshipped, ?stage, ?ustatus, ?staff, ?search)
  → useDashboardSearchController
  → unshippedOrdersQuery (staleTime 60s)
  → fetchUnshippedOrdersData
  → GET /api/orders?fulfillmentScope=true[&q=&staff=]
  → Redis cache api:orders (300s, bypass on search / single-order)
  → client dedupe (dedupeByOrderProduct) + client stage/status filter (UnshippedTable)
  → UnshippedShelfBoard buckets rows (deriveFulfillmentState)
  → OrdersQueueTable maps every row in DOM
```

### 2.3 What already matches industry practice (keep as-is)

| Asset | Location | Notes |
|-------|----------|-------|
| Prefetch on sign-in | `BootGate`, `warmActiveView`, `useDashboardViewWarmup` | Same factories as table → cache hit |
| Shared query key | `unshippedOrdersQuery` in `dashboard-queries.ts` | Sidebar + table dedupe |
| Server Redis cache | `src/app/api/orders/route.ts` | Org-scoped lookup key; tag `orders` |
| Post-write invalidation | `invalidateOrderViews` in `lib/orders/invalidation.ts` | Redis + Ably |
| Assignment event patch | `UnshippedTable.patchOrderRecordFromAssignmentEvent` | Partial cache merge (extend in Phase 3) |
| Memoized rows | `OrdersQueueTableRow` (`memo`) | Helps re-renders, not mount cost |
| Shipped reference impl | `ShippedLaneTable` + `VirtualShippedSections` | **Port target** |
| Board mechanics | `SwimlaneBoard` | Lane order, resize, staff prefs `unshippedBoard` |
| Empty / search UX | `OrdersFirstRunEmptyState`, `OrderSearchEmptyState` | No change |
| Column config | `TableColumnConfigProvider` + `ColumnConfigButton` | Already wraps board |

### 2.4 Gaps (why it slows down at scale)

1. **Unbounded fetch** — `/api/orders` with `fulfillmentScope=true` has no `LIMIT`; every cache miss
   runs the full CTE query and returns all rows.
2. **Detail-shaped payload for list** — same wide row as detail panel; large JSON + client mapping in
   `toOrderRecord`.
3. **No virtualization** — Shipped lanes use `@tanstack/react-virtual`; Unshipped lanes mount every
   `OrdersQueueTableRow` (+ `framer-motion` per row).
4. **Client-side filters** — `stage`, `ustatus` applied in `UnshippedTable` after full download;
   sidebar counts derived from full dataset.
5. **Broad client invalidation** — Ably handlers invalidate entire `['dashboard-table', 'unshipped']`
   prefix; busy floor → refetch storms across tabs.
6. **Full client page** — dashboard route is `'use client'`; no RSC shell streaming (acceptable
   Phase 4+ optimization, not blocking).

---

## 3. Component reuse matrix (no hand-rolled UI)

**Rule:** every display change routes through an existing component or a **thin adapter** that only
wires props (same pattern as `ShippedLaneTable`, `UnshippedDetailsPanel`).

| Need | Reuse (do not replace) | Adapter / extension (allowed) |
|------|------------------------|----------------------------------|
| Lane board | `SwimlaneBoard` | None — keep `UnshippedShelfBoard` as consumer |
| Virtual scrolling | `VirtualShippedSections` (`@tanstack/react-virtual`) | **Generalize** to `VirtualQueueSections` (see §4.1) — same file family, parameterized row renderer |
| Lane body embed | `OrdersQueueTable` (`autoHeight`) | **As-built:** a `virtualized` prop on `OrdersQueueTable` swaps its body to `VirtualQueueSections` — no separate `UnshippedLaneTable`, so selection / column-config wiring is reused verbatim (lower risk than a ShippedLaneTable-style fork) |
| Queue rows | `OrdersQueueTableRow`, `QueueDateSection`, `useOrdersQueueRows` | **As-built:** shared `QueueGroupRow` (extracted from `QueueDateSection`) renders one order group for BOTH dense + virtual paths — one source of group markup |
| Loading skeleton | `SkeletonList` | Already used |
| Selection | `useTableSelectMode`, `ContextualSelectionBar` | Unchanged |
| Sidebar chrome | `SidebarShell`, `FilterRefinementBar`, `StatusLegend`, `SavedViewsControl` | Unchanged |
| Sync | `OrdersSyncPopover`, `OrderSyncDialog`, `AwaitingEbayPanel` | Unchanged |
| Details | `UnshippedDetailsPanel` → `ShippedDetailsPanel` | Unchanged; detail fetch already cached (`order-detail`, 20s) |
| Code split (defer) | `next/dynamic` pattern from `ProductsWorkspace.tsx` | Lazy-load `UnshippedShelfBoard` / `ShippedDetailsPanel` only — Phase 4 |

**Explicit non-goals for components:** no new chip styles, no new row anatomy, no replacement for
`SwimlaneBoard`, no parallel “UnshippedGrid”.

---

## 4. Phased implementation

### Phase 0 — Virtualize lane bodies (display)

**Goal:** DOM size constant regardless of row count; match Shipped scroll behavior.

**Approach (as-built — shipped 2026-07-04):**

1. **New `VirtualQueueSections`** (`src/components/dashboard/orders-queue/VirtualQueueSections.tsx`) —
   clones `VirtualShippedSections`' `useVirtualizer` + `measureElement` + sticky-header-pin pattern.
   Input: `orderGroupsByDate` from **`useOrdersQueueRows`** (unchanged). Flat item kinds: `header`
   (day band) and `group` (one folded order) — each group is measured as a unit, so a multi-product
   expand/collapse just re-measures in place.

2. **New shared `QueueGroupRow`** (`src/components/dashboard/orders-queue/QueueGroupRow.tsx`) —
   extracted from `QueueDateSection`; renders one order group (singleton row or `CollapsibleGroupRow`)
   at a continuous `baseStripeIndex`. **Both** the dense `QueueDateSection` and `VirtualQueueSections`
   render through it → one source of group/row markup, zebra parity preserved. This **replaced the
   plan's `useOrdersQueueRowRenderer` idea** — the existing in-component `renderRow` is threaded
   straight through, so no renderer extraction was needed.

3. **`virtualized` prop on `OrdersQueueTable`** (instead of a separate `UnshippedLaneTable`) — when
   set, the non-empty body renders `VirtualQueueSections` instead of `orderGroupsByDate.map(QueueDateSection)`,
   passing the existing body `scrollRef` as the scroll parent. Selection, column config, empty/search
   states, week controls, loading all stay put. **Why the deviation:** a ShippedLaneTable-style fork
   would re-implement the `useTableSelectMode` / `useOrdersQueueSelection` wiring per lane; the
   in-place flag reuses it verbatim — less code, lower risk, same result. (The reuse matrix already
   listed this `virtualized` flag as an allowed adapter.)

4. **`UnshippedShelfBoard`** passes `virtualized={VIRTUAL_LANES}` to its lane-body `OrdersQueueTable`.
   The dense table and every other caller stay non-virtualized (prop defaults `false`).

5. **Motion watch-out — resolved.** `framerPresence.tableRow` is opacity-only, so it does NOT perturb
   `measureElement` height; the only issue was the enter-fade re-firing on every scroll-into-view.
   `OrdersQueueTableRow` now takes `disableEnterAnimation` (set on the `virtualized` path) that drops
   the enter fade while keeping `whileHover` / `whileTap`. Calm scroll, clean measurement.

**Files touched (as-built):**

- `src/components/dashboard/orders-queue/VirtualQueueSections.tsx` — **new** (virtualizer).
- `src/components/dashboard/orders-queue/QueueGroupRow.tsx` — **new** (shared group renderer).
- `src/components/dashboard/orders-queue/QueueDateSection.tsx` — now delegates to `QueueGroupRow`.
- `src/components/dashboard/orders-queue/OrdersQueueTableRow.tsx` — `disableEnterAnimation` prop.
- `src/components/dashboard/OrdersQueueTable.tsx` — `virtualized` prop + body branch.
- `src/components/unshipped/UnshippedShelfBoard.tsx` — `NEXT_PUBLIC_UNSHIPPED_VIRTUAL_LIST` gate +
  `virtualized` pass-through.
- *Not created (vs original plan): `UnshippedLaneTable.tsx`, `useOrdersQueueRowRenderer.ts` — folded
  into the `virtualized` flag + `QueueGroupRow`.*

**Acceptance:**

- DOM node count in a lane ∝ viewport (~30–50 rows), not total rows. ✅ **Verified 2026-07-04** —
  `tests/e2e/unshipped-virtual-list.spec.ts` mocks `/api/orders` with 500 rows: **26 in the DOM**, 38
  after scroll (bounded/recycled).
- With 500+ rows, scroll stays ≤ 16ms/frame (DevTools). *(Optional profile pending on a real tenant;
  the DOM-count guard above is the environment-independent proof.)*
- Selection, shift-range select, column config, lane resize, staff filter unchanged. *(Board rendered +
  2-up toggle exercised by the spec; broader manual QA still pending — see §11.)*

> **Known limitation (matches `ShippedLaneTable`):** windowing is active in the capped **2-up/3-up**
> layout. In the **1-up stacked** default (`growToContent`), the ancestor owns the scroll and the lane
> grows to content, so all rows mount — same as Shipped today. Closing that (target the ancestor
> scroller + `scrollMargin`) is a follow-up, not a Phase 0 blocker.

---

### Phase 1 — Thin list fetch + server-side filters (fetch)

**Goal:** smaller payloads, faster cache misses, filters match URL params server-side.

**API changes** (`src/app/api/orders/route.ts` — extend, not duplicate):

| Param | Purpose |
|-------|---------|
| `listShape=queue` | Return **`OrderQueueListItem`** projection (see §5) instead of full row |
| `limit` | Default **200** when `fulfillmentScope=true` + no search; max 500 |
| `cursor` | Keyset on `(deadline_at ASC NULLS LAST, o.id ASC)` — same ORDER BY as today |
| `stage=pending\|tested` | SQL predicate on `has_tech_scan` (a raw column — safe in SQL; replaces the client `stageRecords` slice) |
| ~~`ustatus`~~ | **Not a SQL filter (Decision 8).** Fulfillment **state** = `deriveFulfillmentState` (TS SoT); Phase 1 keeps `ustatus` derivation client-side over the thin projection. It becomes a server filter only in Phase 5, when the projector (TS, same SoT) has stamped indexed lane columns. |
| `staff` | Already supported — ensure fulfillment scope respects it in cache key |

Search (`q`) continues to **bypass cache** and may return detail shape for match highlighting.

**Client changes:**

1. **`fetchUnshippedOrdersData`** (`dashboard-table-data.ts`) — pass URL params from
   `useSearchParams` (`stage`, `staff`) + `listShape=queue`, `limit`, `cursor`. (Also fix the verified
   bug that it drops `fulfillmentScope` on a non-strict search.) `ustatus` is **not** sent — it stays a
   client-side derivation (Decision 8).
2. **`unshippedOrdersQuery`** — include `{ stage, staffId, cursor, limit }` in **queryKey**. This does
   **not** magically dedupe table↔sidebar (Decision 4); the sidebar reads counts from its own factory
   (Phase 2), so it never needs the list's `stage/cursor/limit` variant.
3. **`UnshippedTable`** — remove the client-side `stageRecords` slice (now server-side via `stage`);
   **keep** the `statusFilter`/`deriveFulfillmentState` slice client-side (Decision 8) until the Phase 5
   projector can filter lanes server-side.
4. **Types** — add `OrderQueueListItem` in `src/types/orders.ts` (or extend `ShippedOrder` with
   documented subset); row renderer reads only list fields.

**Redis:** extend `createCacheLookupKey` with new params; keep TTL 300s for non-search list pages.

**Files touched:**

- `src/app/api/orders/route.ts` — projection SELECT, filters, limit/cursor
- `src/lib/dashboard-table-data.ts` — param wiring
- `src/lib/queries/dashboard-queries.ts` — queryKey + factory params
- `src/components/unshipped/UnshippedTable.tsx` — drop client filters
- `src/utils/dashboard-search-state.ts` — ensure stage/ustatus exported for factories
- `src/hooks/useDashboardViewWarmup.ts` / `dashboard-warm.ts` — warm with current URL params

**Acceptance:**

- Default unshipped load payload ≤ 50KB gzip at 200 rows.
- `?stage=tested` network response contains only tested rows (verify via count).
- Cache HIT header on repeat load within 300s (`x-cache: HIT`).

---

### Phase 2 — Pagination + sidebar counts split (fetch + display)

**Goal:** explicit ceiling like Shipped’s week bump; sidebar counts without full row download.

**List pagination:**

1. API returns `{ orders, count, nextCursor, truncated: boolean }`.
2. Introduce `UNSHIPPED_QUEUE_PAGE_SIZE = 200` in `dashboard-queries.ts`. **Borrow Shipped's
   *load-more component*, not its *weekly-bucket model*** (Decision 9): Unshipped is deadline-sorted,
   not calendar-archival, so `SHIPPED_WEEK_PAGE_SIZE` (=1000, per-week) is a UI reference only.
3. **Window control = the existing date-range (“all dates”) filter on `SwimlaneBoard`**; **sort = the
   existing per-lane `LaneSortMenu`** (default ship-by/deadline ASC; order-date and others already
   offered). Pagination happens *within* the selected window — no new sort/date UI.
4. **“Load more” UI** — reuse the Shipped truncation button/copy (same `Button` + `sectionLabel`
   styling, not a new component); a global deadline cursor within the window.
5. Per-lane load-more (**deferred to Phase 5**): passing `lane=PENDING|TESTED|BLOCKED` needs
   server-side fulfillment-state filtering, which only the projector provides without duplicating
   `deriveFulfillmentState` (Decision 8). Until then a global cursor fills all lanes from the same
   window — accept uneven lane depth.

**Counts endpoint (lightweight):**

Option A (preferred short-term): **`GET /api/orders/queue-counts?fulfillmentScope=true&staff=`**
returning:

```ts
{
  total: number;
  byStage: { pending: number; tested: number };
  byStatus: Record<FulfillmentState, number>;
  truncated: boolean; // true if list hit limit
}
```

Implement with **SQL `COUNT(*)` + conditional aggregates** — do not fetch rows.

Option B (long-term): read from **`orders_unshipped` feed projection** (Phase 5).

**Sidebar decoupling:**

1. Add `unshippedQueueCountsQuery()` factory.
2. **`UnshippedSidebar`** — legend + stage dropdown use counts query; list query can load in parallel.
3. Keep **`placeholderData: (prev) => prev`** on both (already on sidebar list query).

**Files touched:**

- `src/app/api/orders/queue-counts/route.ts` — **new** thin route (or `?countsOnly=true` on orders)
- `src/lib/queries/dashboard-queries.ts` — `unshippedQueueCountsQuery`
- `src/components/unshipped/UnshippedSidebar.tsx` — consume counts query
- `src/components/unshipped/UnshippedTable.tsx` / `UnshippedLaneTable` — load-more handler
- `src/lib/queries/dashboard-warm.ts` — prefetch counts + first page in parallel

**Acceptance:**

- Sidebar legend visible ≤ 200ms after navigation with cached counts.
- Tenant with 2,000+ queue rows: first paint ≤ 200 rows; “Load more” fetches next page without full
  refetch of page 1 (separate cache key per cursor).

---

### Phase 3 — Incremental sync (fetch freshness)

**Goal:** one station scan ≠ refetch entire queue (industry delta pattern).

**Extend existing patch path** in `UnshippedTable` (already patches assignment events):

1. **Centralize** `patchUnshippedOrderCache(queryClient, orderId, patch | 'remove')` in
   `src/lib/queries/dashboard-cache-patch.ts`.
2. **Ably event handlers** (`useRealtimeInvalidation`, `UnshippedTable` channel listeners):
   - On `order.updated` / `order.changed` with payload sufficient for list shape → **patch** matching
     row in all cached `['dashboard-table', 'unshipped', …]` queries.
   - On pack confirm / ship → **remove** row from fulfillment queries.
   - On new order → **prepend** if matches current filters, else invalidate counts only.
3. **Fallback:** keep broad `invalidateQueries` on Ably **reconnect** only (already in
   `useRealtimeInvalidation`).
4. **Counts query:** increment/decrement tallies on patch/remove when cheap; else invalidate counts
   key only (not full list).

**Reuse:** mirror any existing patch helpers in shipped table if present; one module for dashboard
order cache surgery.

**Files touched:**

- `src/lib/queries/dashboard-cache-patch.ts` — **new**
- `src/hooks/useRealtimeInvalidation.ts` — row-level patch first
- `src/components/unshipped/UnshippedTable.tsx` — delegate to shared patch module
- `src/lib/realtime/publish.ts` / event payloads — ensure list-relevant fields on publish (OPEN if
  missing)

**Acceptance:**

- Tech scan on order X: network shows **0** full `/api/orders` refetch on idle dashboard tab; row
  moves lane in UI.
- Reconnect after sleep: one full refetch (safety) — acceptable.

---

### Phase 4 — Bundle & render deferral (display)

**Goal:** reduce initial JS without new UI.

1. **`next/dynamic`** on dashboard (same pattern as `ProductsWorkspace.tsx`):
   - `UnshippedShelfBoard` (and optionally `DashboardShippedTable`) — `ssr: false`, skeleton =
     existing `Loader2` / `SkeletonList`.
   - `ShippedDetailsPanel` — load on first open (details panel already gated by selection).
2. **Do not** dynamic-import `OrdersQueueTableRow` per row — overhead dominates.
3. **Optional:** move static sidebar chrome (legend labels, section headers) toward RSC wrapper in a
   later pass — **OPEN**, not blocking Phases 0–3.

**Files touched:**

- `src/components/dashboard/DashboardOrdersView.tsx`
- `src/components/dashboard/DashboardOrderDetails.tsx`

**Acceptance:**

- `/dashboard` JS chunk reduced measurably (compare `next build` output before/after).
- First interaction (scroll lane) unchanged after lazy chunk resolves.

---

### Phase 5 — Feed projection read model (long-term SaaS)

**Goal:** sub-100ms reads at 10k+ open orders; aligns with universal feed work.

**When to trigger:** p95 list API miss > 500ms at ≥ 2k rows for any production tenant, OR Redis
memory pressure from large `api:orders` payloads.

**Approach** (from `docs/todo/universal-feed-polymorphic-plan.md`):

1. Implement **`projectOrdersUnshippedMemberships`** — **new** function. ⚠️ Path correction: the
   existing projector is `src/lib/receiving/feed-membership-projection.ts` (there is **no**
   `src/lib/orders/feed-membership-projection.ts` — `src/lib/orders/` holds only `invalidation.ts`).
   Either add `src/lib/orders/feed-membership-projection.ts` mirroring the receiving one, or generalize
   the receiving module; decide when building. **The projector runs in Node and calls the TS
   `deriveFulfillmentState` (SoT: `src/lib/order-lifecycle.ts`) directly** to stamp each membership's
   lane/`ustatus` + `deadline_at` into indexed columns — this is the whole point (Decision 8):
   server-side lane filtering and per-lane pagination with the mapping defined exactly once, in TS.
2. Cron: extend `/api/cron/feed-membership-projection` or sibling schedule.
3. List reads: **`getFeedState('orders_unshipped')`** — the key already exists in
   `src/lib/surfaces/registry.ts` and `getFeedState` (`src/lib/assistant/tools/read-tools.ts`) already
   accepts it, but **returns empty until this projector populates it** — don't assume live data
   pre-projector. Use it for counts + paginated entity ids → hydrate list items via thin lookup (or a
   denormalized snapshot on the membership row).
4. Dashboard UI **unchanged** — same components; only `fetchUnshippedOrdersData` source swaps.

**Invalidation:** order writes already call `invalidateOrderViews`; extend to bust feed projection
tags + enqueue incremental projection for touched order ids (preferred over full rebuild).

---

## 5. List projection shape (`OrderQueueListItem`)

Fields required by **`OrdersQueueTableRow`** + lane bucketing (verify against row component props):

| Field | Used for |
|-------|----------|
| `id`, `order_id` | Keys, chips, grouping |
| `product_title`, `sku`, `quantity` | Title column |
| `deadline_at`, `created_at` | Sort, date bands, late tone |
| `account_source`, `tracking_type` | Platform chip |
| `has_tech_scan` (or derive) | Lane + `ustatus` |
| `out_of_stock` | BLOCKED state |
| `tested_by`, `packed_by`, `tester_id`, `packer_id`, `*_name` | Staff columns |
| `shipping_tracking_number`, `tracking_numbers` (minimal) | Tracking chip |
| `shipment_id` | Stage derivation (if still needed client-side) |
| `sale_amount`, `currency` | Optional meta column |

**Omit from list:** replenishment block, full `tracking_number_rows`, enrichment blobs, warranty
fields, manual assignment history — those stay on **`/api/orders/lookup/[orderId]`** (already Redis
cached).

---

## 6. Query key & cache contract (SoT)

After all phases, keys must remain centralized in `dashboard-queries.ts`:

```ts
// List page
['dashboard-table', 'unshipped', {
  searchQuery, staffId, stage, ustatus, cursor, limit, strictSearchScope
}]

// Counts
['dashboard-table', 'unshipped-counts', { staffId }]

// Warm-up (BootGate + useDashboardViewWarmup)
// Must call the same factories with params parsed from window.location.search
```

**Server Redis namespaces:**

| Namespace | TTL | Tags |
|-----------|-----|------|
| `api:orders` (list) | 300s | `orders` (org-scoped v2) |
| `api:orders-queue-counts` | 60s | `orders` |
| `api:order-detail` | 20s | `order-detail` (existing) |

All order mutations → `invalidateOrderViews` → bust `orders` + publish Ably (no change to chokepoint).

---

## 7. Testing & observability

| Check | How |
|-------|-----|
| Virtual scroll | Playwright: scroll lane with 500-row fixture, assert row count in DOM < 100 |
| Cache hit | Assert `x-cache: HIT` on second GET |
| Filter correctness | API test: `stage=tested` ⇒ all rows `has_tech_scan` |
| Patch path | Unit test `patchUnshippedOrderCache` moves row between lane buckets |
| Regression | Existing dashboard E2E specs (if any) + manual pencil select / column config |
| Metrics | Extend `logRouteMetric` details with `rowCount`, `listShape`, `cache`; dashboard tile on
  `/api/admin/cache-stats` for `api:orders` hit rate |

**Seed fixture:** script or test helper inserting N synthetic unshipped orders (reuse patterns from
domain unit tests / `Deps` injection where possible).

---

## 8. Rollout order & effort estimate

| Phase | User-visible win | Risk | Effort |
|-------|------------------|------|--------|
| **0** Virtualize | Scroll jank gone | Low — display only | 2–3 days |
| **1** Thin fetch + server filters | Faster load, smaller JSON | Medium — SQL + cache keys | 3–5 days |
| **2** Pagination + counts | Large tenants usable | Medium | 3–4 days |
| **3** Incremental sync | Floor traffic stable | Medium — realtime correctness | 3–5 days |
| **4** Code split | Faster TTI | Low | 1 day |
| **5** Feed projection | 10k+ scale | High — infra | 1–2 weeks |

**Ship order:** 0 → 1 → 2 → 3 in sequence; 4 can parallel 2; 5 when metrics demand it.

**Feature flags:** `NEXT_PUBLIC_UNSHIPPED_VIRTUAL_LIST` gates Phase 0 — **default ON**; kill-switch is
`=0` (falls back to the all-rows-mounted body). Build-time inlined (NEXT_PUBLIC), so a change needs a
redeploy. Remove the gate after bake-in.

---

## 9. Dependencies & related docs

| Doc | Relationship |
|-----|--------------|
| `docs/unshipped-pending-merge-plan.md` | Historical merge context; queue = fulfillment scope |
| `docs/todo/redis-caching-plan.md` | Redis substrate done; this plan adds queue-specific namespaces |
| `docs/todo/universal-feed-polymorphic-plan.md` | Phase 5 `orders_unshipped` projection |
| `.claude/rules/backend-patterns.md` | Route skeleton, `invalidateOrderViews`, tenant scope |
| `.claude/rules/ui-design-system.md` | No new row anatomy; workbench archetype |

---

## 10. Non-goals

- Replacing `SwimlaneBoard` with a grid or kanban library.
- New mobile-specific unshipped UI (mobile uses `/m/` routes separately).
- Changing Shipped / Warranty / FBA modes (except shared virtualizer extraction).
- Client-side IndexedDB offline queue (out of scope).
- AI search / global entity search integration (see `docs/ai-search-modernization-plan.md`).

---

## 11. Phase 0 checklist (as-built)

- [x] `VirtualQueueSections` uses the same `@tanstack/react-virtual` config as `VirtualShippedSections`
- [x] Shared `QueueGroupRow` renders groups for both paths; zero duplicate row JSX
- [x] `virtualized` prop on `OrdersQueueTable` (reuses selection/column-config) instead of a lane fork
- [x] `UnshippedShelfBoard.renderLaneBody` passes `virtualized={VIRTUAL_LANES}`
- [x] Per-row enter animation gated under virtualization (`disableEnterAnimation`)
- [x] `tsc --noEmit` clean · ESLint clean on all six files · DS-guards 13/13
- [x] Playwright acceptance — `tests/e2e/unshipped-virtual-list.spec.ts`: 500 mocked rows → **26 DOM rows**
  (38 after scroll), asserts `< 150`; mocks `/api/orders`, forces capped 2-up. **PASS.**
- [ ] **Pending:** broader manual QA (lane drag-resize, select mode + bulk bar, open details panel)
- [ ] **Pending (optional):** DevTools frame-time profile (≤16ms/frame) on a real large tenant
