# Station table unification — display, views & realtime plan

> **Status (2026-07-05): PLAN — not started.** Work-on-main. Desktop only (`/tech`, `/packer`,
> `/receiving`, testing-history). Mobile routes (`/m/...`) are **out of scope** for this run.
>
> **Headline:** port the **Unshipped table stack** (row substrate, virtualized list body,
> `SwimlaneBoard` pipeline view, counts + Ably cache patches, `TableOptionsMenu`) to every
> **station / history** table — Tech shipping history, Packer history, Receiving History,
> Receiving Incoming, and Tech testing-history — so staff get a **personalized execution view**
> (signed-in scope) and supervisors get an **all-staff operational view**, with saved filter
> presets and Pipeline / All toggles living in the **table header ⋮ menu**, not the sidebar.
>
> **Reference implementation:** `docs/unshipped-dashboard-performance-plan.md` (Phases 0–3 built).
> This plan **extends** that substrate to station surfaces and adds station-specific UX (staff
> scope, Pipeline boards per domain, per-surface search staying in sidebars).
>
> **Validation (2026-07-05, code-verified):** current-state claims confirmed against:
> - Unshipped: `UnshippedShelfBoard` → virtualized `OrdersQueueTable` → `VirtualQueueSections`
> - Shipped: `?layout=board|all` via `useShippedTableFilters`, `DashboardShippedTable`
> - Tech/Packer: `StationWeekTable` → `TechRecordRow` / `PackerRecordRow` → `StationRecordShell`
>   (all rows mounted, no virtualization, no Pipeline toggle, no bulk select on shipping history)
> - Receiving: `ReceivingLinesTable` → `ReceivingGroupedList` (PO groups, keyboard nav, bulk select)
>   → `ReceivingLineOrderRow` (already uses `dashboardOrderRowShellClass`)
> - Testing history: `TestingHistoryList` flat 500-row fetch, no week bands
> - Saved views today: `SavedViewsControl` in **sidebars** (`UnshippedSidebar`, `ShippedSidebar`)
> - Partial Ably prepend already in `useTechLogs` / `usePackerLogs`; no shared patch module
> - **Known blocker:** 1-up `SwimlaneBoard` + `growToContent` disables virtualization
>   (`unshipped-dashboard-performance-plan.md` §Phase 0 limitation) — **must fix first** (Phase V0).

---

## 0. Decisions (locked unless flagged OPEN)

1. **No new design-system or row anatomy.** Rows stay on `OrdersQueueTableRow`, `ReceivingLineOrderRow`,
   `ChipColumns`, `RowMetaColumns`, `SwimlaneBoard`, etc. New code is glue, query factories, lane
   descriptors, and menu chrome — not bespoke table markup.
2. **Mirror the Unshipped / Shipped lane pattern.** Pipeline view uses `SwimlaneBoard` + per-lane
   `StationListTable` (virtualized body). All view uses the same table component in dense week-banded
   mode. Do not invent a third board mechanic.
3. **Extend existing APIs; do not fork parallel list APIs** unless the handler delegates to the same SQL
   builder (single SoT). Counts routes may be thin siblings (`/counts`).
4. **Query factories stay the SoT.** All prefetch, table, sidebar legend, and counts consumers call
   factories in `src/lib/queries/station-queries.ts` — never ad-hoc `fetch` keys.
5. **Invalidate-on-write stays canonical** for server cache (`invalidateCacheTags`); client Ably/DOM
   patches are the hot path; broad `invalidateQueries` only on reconnect.
6. **Saved views move to the table ⋮ menu** — not sidebars. Sidebars keep search + facet chips + sync
   controls + recent rails only.
7. **Search stays per-surface** — no unified dashboard-style search bar across Tech / Packer / Receiving.
8. **Two staff scopes:** `scope=mine` (signed-in staff, station execution) vs `scope=all` (operational
   oversight). Fine-grain `?staff=` composes when `scope=all` (reuse `useStaffFilter` / `STAFF_FILTER_PARAM`).
9. **Desktop only** — mobile receiving/tech/packer routes unchanged in this run.
10. **Typical volume 10–50 rows/week** per staff — pagination UI is light (hide load-more when
    `total ≤ pageSize`), but counts + patch infrastructure still ships for consistency and floor traffic.
11. **Phase V0 is a blocker** — ancestor-scroll virtualization must work in 1-up stacked lanes before
    surface cutovers.
12. **Lane membership derivation stays in TS SoT** — same rule as Unshipped Decision 8: never re-implement
    fulfillment/receiving/tech lane logic in SQL for display; SQL may filter raw columns only. Count
    endpoints may aggregate by indexed raw fields; lane **labels** come from TS `derive*` helpers.

### Locked product answers (2026-07-05)

| # | Answer |
|---|--------|
| Layout | Pipeline / All toggle on Receiving History, Incoming, Tech shipping history, Packer, Testing history |
| Staff | Signed-in (mine) vs all-staff; station pages default **mine**; receiving history defaults **all** |
| Data stack | Counts endpoints + Ably/cache patch incremental sync (**high priority**) |
| Mobile | Excluded |
| Bulk select | Tech shipping history + Packer (Receiving + testing-history already have it) |
| Keyboard nav | All station tables |
| Saved views | Table header ⋮ menu (remove from sidebars) |
| Search | Separate per surface (sidebar) |
| Copy/export | TSV/clipboard for selected rows |
| Live updates | Very important — patch first, invalidate on reconnect only |
| Deep links | Yes — auto-select + scroll-into-view under virtualization |
| Density | Compact + comfortable toggle |
| First-run empty | Yes — station-specific CTAs |
| Testing history | Week bands (like Tech table) |
| Volume | ~10–50 rows/week typical |
| Virtualization | Fix 1-up ancestor scroll **before** cutover |

---

## 1. Scope & surfaces

### 1.1 In scope (desktop)

| Route / mode | Main table component | Sidebar |
|--------------|----------------------|---------|
| `/tech` · default shipping history | `TechTable` | `TechSidebarPanel` |
| `/tech` · `?view=testing-history` | `TestingHistoryList` | `TestingSidebarPanel` |
| `/packer` | `PackerTable` | Packer sidebar |
| `/receiving?mode=history` | `ReceivingLinesTable` (history) | `ReceivingHistorySearchSection` |
| `/receiving?mode=incoming` | `ReceivingLinesTable` (incoming) | `IncomingSidebarPanel` |

### 1.2 Out of scope

- Mobile routes: `/m/receiving/history`, `/m/...` station pages
- Receive workspace (`?mode=receive` / default receiving) — **optional follow-up**; history/incoming are primary
- Unshipped / Shipped dashboard tables — **saved-view relocation** to ⋮ menu is in scope when we ship
  `TableOptionsMenu` globally (avoid two entry points)
- New chip styles, kanban libraries, parallel grid renderers

### 1.3 Success criteria (acceptance)

1. **Visual parity** — station rows match Unshipped row anatomy (title, meta, chips, selection ring,
   `bg-blue-50 ring-1 ring-inset ring-blue-400`).
2. **Pipeline / All** — URL-backed `?layout=board|all`; board uses `SwimlaneBoard`; lanes match TS SoT.
3. **Virtualization** — DOM row count ∝ viewport in **both** 1-up and 2-up board layouts (Phase V0).
4. **Staff scope** — `/tech` and `/packer` default to signed-in staff; toggle to all-staff via ⋮ menu.
5. **Saved views** — save/apply/delete from ⋮ menu; URL-applied views are bookmarkable.
6. **Realtime** — single scan on idle tab → **0** full list refetch; row appears in <1s.
7. **Keyboard** — ↑/↓, Enter, shift-range select (select mode).
8. **Deep links** — `?techLogId=`, `?packLogId=`, `?testingLineId=`, existing `?recvId=` / `?lineId=`
   scroll row into view after virtualizer measures.
9. **Copy** — selected rows → clipboard TSV from action bar.
10. **First-run** — zero rows + mine scope → teaching empty state, not blank italic text.

---

## 2. Current-state map

### 2.1 Composition today

| Layer | Tech | Packer | Receiving history | Receiving incoming | Testing history |
|-------|------|--------|-------------------|--------------------|-----------------|
| Orchestrator | `TechTable` | `PackerTable` | `ReceivingLinesTable` | same | `TestingHistoryList` |
| Data hook | `useTechTableController` | `usePackerTableController` | `useReceivingLinesData` | same | inline `useQuery` |
| Week shell | `StationWeekTable` | same | `DateRangeHeader` | `IncomingPaneHeader` | none (flat list) |
| Grouping | day bands | day bands | day → PO groups | day → PO groups | flat |
| Row | `TechRecordRow` → `StationRecordShell` | `PackerRecordRow` | `ReceivingLineOrderRow` | same | same |
| Virtualized | no | no | no | no | no |
| Pipeline board | no | no | no | no | no |
| Bulk select | no (shipping) | no | yes | yes | yes |
| Keyboard nav | no | no | yes | yes | no |
| Column config | `tableId: tech` | `tableId: packer` | `tableId: receiving` | same | inherits receiving |
| Ably | `useTechLogs` prepend | `usePackerLogs` | shipment / line events | same | refetch |
| Saved views | no | no | no | no | no |

### 2.2 Reference stack (Unshipped — target)

| Layer | File | Role |
|-------|------|------|
| Orchestrator | `UnshippedTable.tsx` | Query, Ably patch, filters, load-more |
| Board | `UnshippedShelfBoard.tsx` | `SwimlaneBoard` consumer |
| List body | `OrdersQueueTable.tsx` | `virtualized` prop → `VirtualQueueSections` |
| Group row | `QueueGroupRow.tsx` | Shared singleton + collapsible multi-product |
| Row | `OrdersQueueTableRow.tsx` | Memoized dashboard row |
| Counts | `unshippedQueueCountsQuery` | Sidebar legend without row download |
| Patch | `dashboard-cache-patch.ts` | Prefix-key surgery + counts invalidate |
| Saved views | `SavedViewsControl.tsx` | localStorage + URL apply (**moving to ⋮**) |

### 2.3 Gaps (why unification matters)

1. **Three row substrates** — `OrdersQueueTableRow`, `StationRecordShell`, `ReceivingLineOrderRow` diverge
   on borders, motion, selection, meta slots.
2. **No virtualization** on station tables — acceptable at 10–50 rows today, but breaks parity and blocks
   Pipeline boards at scale.
3. **1-up board bug** — even Unshipped loses virtualization in stacked layout (Phase V0).
4. **No Pipeline view** on station surfaces — supervisors cannot see pending vs recently completed at a glance.
5. **Saved views in sidebars** — wrong real estate; competes with filters.
6. **No staff scope model** on Tech/Packer — always filtered to route `techId`/`packerId`, no all-staff toggle.
7. **Packer full remount** on `usav-refresh-data` (`refreshNonce` in `PackerDashboard`) — should be query patch.
8. **Testing history** — flat 500-row cap, no week bands, no shared navigation hooks.
9. **Ably patch fragmented** — `useTechLogs` has prepend logic; no shared `station-cache-patch.ts`.

---

## 3. Target UX

### 3.1 Table header band (40px workbench)

Every in-scope table shares one header anatomy:

```
┌──────────────────────────────────────────────────────────────────────────┐
│  ◀  Mon 30 Jun – Fri 4 Jul  ·  12 records     [Pipeline│All]  [⋮]      │
└──────────────────────────────────────────────────────────────────────────┘
```

| Slot | Component | Notes |
|------|-----------|-------|
| Left | `DateRangeHeader` or `IncomingPaneHeader` | Week count, prev/next; incoming keeps pagination label |
| Center-right | `ToolbarButton` pills | `Pipeline` / `All` — mirrors `DashboardShippedTable` `SHIPPED_VIEW_ITEMS` |
| Right | `TableOptionsMenu` | ⋮ — see §3.2 |

Incoming mode: `IncomingPaneHeader` gains Pipeline/All + ⋮ on the right; count/pagination stays left.

### 3.2 `TableOptionsMenu` (⋮) — menu sections

New component: `src/components/ui/table-options/TableOptionsMenu.tsx`

| Section | Controls | URL / storage |
|---------|----------|---------------|
| **Layout** | Pipeline / All | `?layout=board\|all` |
| **Staff scope** | My work / All staff | `?scope=mine\|all`; mine locks `staff` to `user.staffId` |
| **Staff filter** | (visible when scope=all) | `?staff=` via `useStaffFilter` |
| **Row density** | Comfortable / Compact | `?density=comfortable\|compact` + localStorage per `tableId` |
| **Columns** | Checkbox list | `TableColumnConfigProvider` / `table-columns.ts` |
| **Saved views** | Apply / save / delete | localStorage v1; core from `SavedViewsControl` |
| **Select mode** | (optional) Arm pencil | Dispatches page selection toggle — or keep header pencil |

**Saved views** capture only **filter/layout params** for that surface — not ephemeral search text
(unless explicitly included in `paramKeys` for a surface).

Refactor: extract `useSavedViews({ storageKey, paramKeys })` from `SavedViewsControl.tsx`; menu and
any legacy callers share the hook.

### 3.3 Staff scope behavior

Hook: `src/hooks/useStationStaffScope.ts`

```ts
type StationScope = 'mine' | 'all';

// Effective staff id passed to queries:
//   scope=mine  → user.staffId (from useAuth), ignore ?staff= unless supervisor override OPEN
//   scope=all   → ?staff= if set, else undefined (all staff)
```

| Surface | Default `scope` | Default effective staff |
|---------|-----------------|-------------------------|
| `/tech` shipping history | `mine` | signed-in `user.staffId` |
| `/packer` | `mine` | signed-in `user.staffId` |
| `/receiving?mode=history` | `all` | none |
| `/receiving?mode=incoming` | `all` | none |
| Testing history | `mine` | route `staffId` / signed-in |

**Query key guard** (mirror Unshipped): when `scope` or effective `staffId` changes, do not
`placeholderData` bleed prior staff's rows.

### 3.4 Pipeline / All layouts

| `layout` | Renders | Scroll owner |
|----------|---------|--------------|
| `all` | `StationListTable` — dense, week-banded, virtualized | table body `scrollRef` |
| `board` | `*ShelfBoard` → `SwimlaneBoard` → per-lane `StationListTable` | board scroll container (Phase V0) |

Default: `all` for history audit; **consider** default `board` for Incoming (OPEN — product preference).

### 3.5 Row density

Provider: `TableDensityProvider` or URL-only with localStorage mirror.

| Density | Row padding | Meta text | Chip gap |
|---------|-------------|-----------|----------|
| `comfortable` | `py-1.5` (current) | default | default |
| `compact` | `py-1` | `text-micro` where safe | tighter `gap-0.5` |

Thread through: `OrdersQueueTableRow`, `ReceivingLineOrderRow`, `QueueGroupRow` summary rows.

### 3.6 First-run empty states

When: `!loading && rows.length === 0 && !hasActiveSearch && !hasActiveFacet && scope=mine`

| Surface | Message / CTA |
|---------|---------------|
| Tech shipping | "Scan a tracking number to log your first test" → focus scan bar |
| Packer | "Scan an order to log your first pack" |
| Receiving history (mine) | "No receiving activity for you this week" |
| Testing history | "Pass or fail a line in Testing to see it here" |

Reuse pattern: `OrdersFirstRunEmptyState` (props for title, subtitle, action).

---

## 4. Lane models (TS SoT — new modules)

Add lane descriptors alongside `FULFILLMENT_BOARD_LANES` in `src/lib/order-lifecycle.ts` or
domain-specific SoT files. Each entry: `id`, `iconKey`, `iconClass`; meta (label, dot, description)
in a `*_STATE_META` map.

### 4.1 Receiving Incoming (`RECEIVING_INCOMING_BOARD_LANES`)

| Lane id | Bucket rule (TS) | Notes |
|---------|------------------|-------|
| `DELIVERED_UNSCANNED` | `delivery_state === 'DELIVERED_UNOPENED'` | Rose tile parity |
| `IN_TRANSIT` | category IN_TRANSIT / OUT_FOR_DELIVERY | |
| `EXPECTED` | `workflow_status === 'EXPECTED'` | Default pipeline |
| `TRACKING_UNAVAILABLE` | `delivery_state === 'TRACKING_UNAVAILABLE'` | Honest USPS-blocked |

`bucket(row)` reads normalized fields from `ReceivingLineRow` (already on row from API).

### 4.2 Receiving History (`RECEIVING_HISTORY_BOARD_LANES`)

| Lane id | Bucket rule (TS) | Notes |
|---------|------------------|-------|
| `PENDING_UNBOX` | `workflow_status === 'EXPECTED'` | Not yet unboxed |
| `RECENTLY_SCANNED` | first scan within 24h PST | **OPEN:** exact field — `scanned_at` vs `receiving_scans` |
| `RECEIVED` | `workflow_status === 'RECEIVED'` | Completed |
| `UNFOUND` | unfound PO / unmatched scope | `historySearchScope=unmatched` narrows |

### 4.3 Tech shipping history (`TECH_HISTORY_BOARD_LANES`)

| Lane id | Bucket rule (TS) | Notes |
|---------|------------------|-------|
| `TODAY` | `created_at` is today PST | Active shift |
| `THIS_WEEK` | in week range, not today | |
| `FBA` | `isFbaTechRecord(record)` | Existing helper |
| `WITH_SERIAL` | has serial, non-FBA | Optional lane — **OPEN** keep or fold into THIS_WEEK |

**OPEN:** "In-progress" lane for active order from `useStationTestingController` — may need cross-read
from scan station state, not history table rows.

### 4.4 Packer history (`PACKER_HISTORY_BOARD_LANES`)

| Lane id | Bucket rule (TS) | Notes |
|---------|------------------|-------|
| `TODAY` | packed today PST | |
| `THIS_WEEK` | in week, not today | |
| `FBA` | `isFbaPackerRecord(record)` | Existing helper |
| `EXCEPTION` | `row_source === 'exception'` | |

### 4.5 Testing history (`TESTING_HISTORY_BOARD_LANES`)

| Lane id | Bucket rule (TS) | Notes |
|---------|------------------|-------|
| `PASS` | verdict pass | Field from `ReceivingLineRow` testing fields |
| `FAIL` | verdict fail | |
| `RETEST` | re-test / test-again | **OPEN:** exact predicate on row |

---

## 5. Architecture

### 5.1 Component reuse matrix

| Need | Reuse | Adapter (allowed) |
|------|-------|-------------------|
| Lane board | `SwimlaneBoard` | Thin `*ShelfBoard` per surface (like `UnshippedShelfBoard`) |
| Virtual scroll | `VirtualQueueSections` → **`VirtualGroupedSections<T>`** | Parameterize item kinds |
| List shell | **`StationListTable<T>`** (new) | Generalize `OrdersQueueTable` |
| Order groups | `QueueGroupRow`, `CollapsibleGroupRow` | PO groups map to `group` items |
| Queue rows | `OrdersQueueTableRow` | `queueMode: 'tech' \| 'packer'` |
| Receiving rows | `ReceivingLineOrderRow` | Keep; wire through shared list shell |
| Week header | `DateRangeHeader`, `IncomingPaneHeader` | Add ⋮ slot |
| Selection | `useTableSelectMode`, `ContextualSelectionBar` | New scopes §5.4 |
| Copy actions | `useReceivingLineBulkSelection` pattern | `useStationLogBulkSelection` for tech/packer |
| Column config | `TableColumnConfigProvider`, `table-columns.ts` | No key changes |
| Saved views | `useSavedViews` hook (extracted) | Trigger only from ⋮ menu |
| Staff filter | `useStaffFilter`, `STAFF_FILTER_PARAM` | Composed in `useStationStaffScope` |
| Patch | **`station-cache-patch.ts`** | Mirror `dashboard-cache-patch.ts` |
| Queries | **`station-queries.ts`** | Factories + counts siblings |

**Explicit non-goals:** `StationWeekTable`, `StationRecordShell`, `TechRecordRow`, `PackerRecordRow`
(removed after cutover), second virtualizer implementation, sidebar saved-view buttons.

### 5.2 `StationListTable<TRecord>` (new)

Generalized from `OrdersQueueTable`:

```ts
interface StationListTableProps<TRecord, TGroupKey> {
  records: TRecord[];
  loading: boolean;
  isRefreshing: boolean;
  // Week controls (optional — testing history + tech/packer + receiving history)
  weekRange?: WeekRange;
  weekOffset?: number;
  onPrevWeek?: () => void;
  onNextWeek?: () => void;
  showWeekControls?: boolean;
  // Grouping: flat day sections OR pre-built orderGroupsByDate
  orderGroupsByDate?: [string, RowGroup<TRecord>[]][];
  daySections?: [string, TRecord[]][];  // simpler surfaces
  // Rendering
  renderRow: (record: TRecord, stripeIndex: number) => ReactNode;
  // Embed mode (lane body)
  hideHeader?: boolean;
  inheritColumnConfig?: boolean;
  virtualized?: boolean;
  autoHeight?: boolean;
  maxBodyHeightPx?: number;
  growToContent?: boolean;
  // Selection
  selectMode?: boolean;
  selectionScope?: string;
  // Empty / search
  emptyMessage: string;
  firstRunEmpty?: ReactNode;
  searchEmptyTitle?: string;
  onClearSearch?: () => void;
  // Header slots
  headerEndSlot?: ReactNode;  // Pipeline toggle + ⋮ menu
  footer?: ReactNode;
}
```

Body branch (same as Unshipped):

- `virtualized && scrollParent` → `VirtualGroupedSections`
- else → `daySections.map` → `QueueDateSection` pattern or `QueueGroupRow`

### 5.3 `VirtualGroupedSections<T>` (generalize)

Rename/evolve `VirtualQueueSections.tsx`:

```ts
type FlatItem<T> =
  | { kind: 'header'; key: string; date: string; count: number }
  | { kind: 'group'; key: string; group: RowGroup<T>; baseStripeIndex: number }
  | { kind: 'row'; key: string; record: T; stripeIndex: number };  // flat lists (testing)

```

Sticky header pin + `measureElement` unchanged. `getItemKey` stable across re-sorts.

### 5.4 Selection scopes (new constants)

Add `src/lib/selection/station-scopes.ts`:

| Constant | Surface |
|----------|---------|
| `TECH_HISTORY_SELECTION_SCOPE` | Tech shipping history bulk select |
| `PACKER_HISTORY_SELECTION_SCOPE` | Packer bulk select |
| `TESTING_SELECTION_SCOPE` | already `'testing'` |
| `RECEIVING_SELECTION_SCOPE` | already `'receiving'` |

Tech/Packer bulk actions (minimum v1):

- **Copy** (TSV via `formatTechCopyRow` / `formatPackerCopyRow`)
- **Open detail** (single select)

Receiving keeps full set: Copy, Print, Create ticket, Send to staff/phone (`useReceivingLineBulkSelection`).

### 5.5 Row mappers (new)

`src/lib/station/record-to-queue-row.ts`:

- `techRecordToQueueRow(record: TechRecord): QueueRowRecord`
- `packerRecordToQueueRow(record: PackerRecord): QueueRowRecord`

Map: `product_title`, `order_id`, `sku`, `quantity`, `condition`, `shipping_tracking_number`,
`account_source`, `serial_number` (tech), `scan_ref` (packer), staff ids, `created_at` for sorting.

`OrdersQueueTableRow` extensions in `helpers.ts`:

- `queueMode: 'fulfillment' | 'labels' | 'staged' | 'tech' | 'packer'`
- Tech: serial chip column, tester = signed-in staff
- Packer: no serial column; FBA FNSKU in tracking slot (preserve `PackerRecordRow` behavior)

---

## 6. URL contract (SoT)

New module: `src/lib/station/table-url-params.ts`

### 6.1 Shared params (all station tables)

| Param | Values | Default |
|-------|--------|---------|
| `layout` | `board` \| `all` | `all` |
| `scope` | `mine` \| `all` | surface-specific §3.3 |
| `density` | `comfortable` \| `compact` | `comfortable` |
| `staff` | positive int | absent = all (when scope=all) |

### 6.2 Deep-link params

| Param | Surface |
|-------|---------|
| `techLogId` | Tech — numeric id or composite `sourceKind:sourceRowId` **OPEN** |
| `packLogId` | Packer — `packer_log_id` or SAL id |
| `testingLineId` | Testing history — `receiving_lines.id` |
| `recvId`, `lineId` | Receiving — existing (`useReceivingDeepLink`) |

### 6.3 Per-surface saved-view `paramKeys`

**Tech shipping** (`tech_history_saved_views`):

`layout`, `scope`, `density`, `staff`, `weekOffset` (or `techWeekOffset` if namespaced)

**Packer** (`packer_history_saved_views`):

`layout`, `scope`, `density`, `staff`, `weekOffset`

**Receiving history** (`receiving_history_saved_views`):

`layout`, `scope`, `density`, `staff`, `sort`, `field`, `scope` (history search scope), `mode`

Note: `q` (search text) **excluded** by default — user decision #8 (search separate).

**Receiving incoming** (`receiving_incoming_saved_views`):

`layout`, `density`, `incomingState`, `sort`, `incomingPoFrom`, `incomingPoTo`, `incomingFacet`

**Testing history** (`testing_history_saved_views`):

`layout`, `scope`, `density`, `staff`, `weekOffset`, `view`

### 6.4 Week offset naming

**OPEN:** unify on `?weekOffset=` across Tech, Packer, Testing, Receiving history or keep local state
for receiving (today: `useState` in `ReceivingLinesTable`). Recommendation: URL-back `weekOffset` for
shareable week links on all surfaces.

---

## 7. Data layer

### 7.1 Query factories (`src/lib/queries/station-queries.ts`)

```ts
// Tech
['station-table', 'tech', { staffId, weekOffset, scope, layout, ... }]
['station-table', 'tech-counts', { weekOffset, scope, staffId }]

// Packer
['station-table', 'packer', { staffId, weekOffset, scope, ... }]
['station-table', 'packer-counts', { ... }]

// Receiving (mode in key)
['station-table', 'receiving', { mode: 'history'|'incoming', ...ctx }]
['station-table', 'receiving-counts', { mode, ... }]

// Testing history
['station-table', 'testing-history', { staffId, weekOffset, scope, ... }]
['station-table', 'testing-history-counts', { ... }]
```

Migrate `useTechLogs` / `usePackerLogs` query keys to align OR wrap factories that call same fetchers.

`placeholderData: (prev, prevQuery) =>` — staff/scope guard (copy Unshipped `UnshippedTable` pattern).

### 7.2 API routes

| Route | Status | Phase |
|-------|--------|-------|
| `GET /api/tech/logs` | exists (`api:tech-logs-v3` Redis) | extend `?countsOnly` or sibling |
| `GET /api/packerlogs` | exists | sibling counts |
| `GET /api/receiving-lines` | exists | sibling counts |
| `GET /api/tech/logs/counts` | **new** | Phase 5 |
| `GET /api/packerlogs/counts` | **new** | Phase 5 |
| `GET /api/receiving-lines/counts` | **new** | Phase 5 |

Counts response shape (uniform):

```ts
{
  total: number;
  byLane: Record<LaneId, number>;  // client may re-derive from TS if needed
  byDay?: Record<string, number>;
  truncated: boolean;
}
```

At 10–50 rows: `truncated: false` always; `limit` default 500 still fine for v1.

### 7.3 `station-cache-patch.ts` (new)

Mirror `dashboard-cache-patch.ts` API:

```ts
patchTechLogCache(queryClient, rowId, patch)
removeTechLogFromCache(queryClient, rowId)
prependTechLogCache(queryClient, record)
invalidateTechCounts(queryClient)

patchPackerLogCache(...)
prependPackerLogCache(...)
invalidatePackerCounts(...)

patchReceivingLineCache(queryClient, lineId, patch)
removeReceivingLineFromCache(...)
invalidateReceivingCounts(queryClient, mode)
```

Prefix-key updates so all query variants update at once.

### 7.4 Ably / DOM event map

| Event | Source | Patch action |
|-------|--------|--------------|
| Tech scan committed | Ably station channel / `useTechLogs` | `prependTechLogCache` + `invalidateTechCounts` |
| `tech-log-removed` | DOM (`TechTable`) | `removeTechLogFromCache` |
| Pack scan committed | Ably / `usePackerLogs` | `prependPackerLogCache` |
| `order.tested` | orders channel | patch unshipped + may affect tech lanes |
| `shipment.changed` | shipping | `patchReceivingLineCache` delivery fields |
| `line.updated` / `dispatchLineUpdated` | receiving | patch line row |
| Reconnect | Ably | broad invalidate station-table prefix only |

**Priority:** wire pack/tech prepend through shared module; delete duplicate prepend in hooks after.

### 7.5 Server cache tags (existing)

Invalidate on write (unchanged chokepoints):

- `tech-logs` — `/api/tech/scan`, `delete`, `serial`
- `packing-logs` — pack routes
- `receiving-lines` — line mutations

Client patch is optimistic; server tag bust ensures other tabs converge.

---

## 8. Phased implementation

### Phase V0 — Ancestor-scroll virtualization fix (BLOCKER)

**Goal:** Virtualization works in **1-up stacked** `SwimlaneBoard` layout, not only 2-up capped lanes.

**Root cause:** `growToContent=true` → lane body has no scroll container → `VirtualGroupedSections`
mounts all rows (`unshipped-dashboard-performance-plan.md` §Phase 0 limitation).

**Approach:**

1. **`SwimlaneBoard`** — introduce `boardScrollRef` on the board's main body wrapper:
   - `flex-1 min-h-0 overflow-y-auto` on the column that holds lanes (stacked + grid).
   - Stacked lanes: `growToContent=false`, `autoHeight=true`, `maxBodyHeightClass` = unset or
     `max-h-none`; lane body participates in board scroll.
   - Grid (2-up/3-up): keep internal lane scroll + capped height (current behavior).

2. **`VirtualGroupedSections`** — `getScrollElement` returns `boardScrollRef` when embedded in board;
   pass `scrollMargin` if lane header offset requires it (`useVirtualizer` option).

3. **`OrdersQueueTable` / `StationListTable`** — prop `scrollParentRef?: RefObject<HTMLElement>`;
   when set, virtualizer uses it instead of body `scrollRef`.

4. **Sticky `DateGroupHeader`** — verify pin with board-level scroll (existing `activeStickyIndexRef`
   logic in `VirtualQueueSections`).

5. **Unshipped first** — fix on `UnshippedShelfBoard` before station cutover proves the path.

**Files:**

- `src/components/board/SwimlaneBoard.tsx`
- `src/components/dashboard/orders-queue/VirtualQueueSections.tsx`
- `src/components/dashboard/OrdersQueueTable.tsx`
- `src/components/unshipped/UnshippedShelfBoard.tsx`
- `tests/e2e/unshipped-virtual-list.spec.ts` — **add 1-up stacked case**

**Acceptance:**

- 500 mocked rows, **1-up default layout**, DOM rows < 150
- 2-up case still passes existing spec (~26 rows)
- Lane drag-resize, collapse "Show more", column config unchanged

**Effort:** 2–3 days

---

### Phase 0 — Generic list substrate

**Goal:** `StationListTable` + `VirtualGroupedSections<T>` + density + row mappers.

**Work:**

1. Generalize `VirtualQueueSections` → `VirtualGroupedSections<T>`.
2. Create `StationListTable.tsx` (extract from `OrdersQueueTable` without breaking importers).
3. Add `queueMode: 'tech' | 'packer'` + mappers in `record-to-queue-row.ts`.
4. `TableDensityProvider` + `?density=` URL sync.
5. `useTableDensity(tableId)` hook.

**Files:**

- NEW `src/components/station/StationListTable.tsx`
- NEW `src/lib/station/record-to-queue-row.ts`
- NEW `src/components/ui/table-density/TableDensityProvider.tsx`
- MODIFY `VirtualQueueSections.tsx`, `OrdersQueueTable.tsx`, `orders-queue/helpers.ts`,
  `OrdersQueueTableRow.tsx`

**Acceptance:**

- `OrdersQueueTable` behavior unchanged (regression E2E).
- Storybook/manual: tech mapper row renders identical chips to current `TechRecordRow`.

**Effort:** 3–4 days (after V0)

---

### Phase 1 — `TableOptionsMenu` + saved views relocation

**Goal:** ⋮ menu owns views, density, scope, columns; sidebars shed saved views.

**Work:**

1. NEW `TableOptionsMenu.tsx` + `useSavedViews.ts` (extract from `SavedViewsControl`).
2. NEW `useStationStaffScope.ts`.
3. Wire menu into `DateRangeHeader` `columns` slot or new `headerEndSlot`.
4. Remove `SavedViewsControl` from `UnshippedSidebar.tsx`, `ShippedSidebar.tsx` (same PR).
5. Add `TableOptionsMenu` to Shipped/Unshipped table headers for parity.

**Files:**

- NEW `src/components/ui/table-options/TableOptionsMenu.tsx`
- NEW `src/hooks/useSavedViews.ts`
- NEW `src/hooks/useStationStaffScope.ts`
- NEW `src/lib/station/table-url-params.ts`
- MODIFY `SavedViewsControl.tsx` (thin wrapper or deprecate)
- MODIFY `UnshippedSidebar.tsx`, `ShippedSidebar.tsx`, `DateRangeHeader.tsx`

**Acceptance:**

- Save view from ⋮ → appears in list → apply updates URL
- Sidebar has no star/views button
- `scope=mine` on `/tech` filters to signed-in staff without `?staff=` in URL

**Effort:** 2–3 days

---

### Phase 2 — Tech + Packer cutover

**Goal:** Replace `StationWeekTable` stack; add bulk select, keyboard nav, deep links, first-run empty.

**Tech (`TechTable.tsx`):**

```ts
// Before
StationWeekTable → TechRecordRow → StationRecordShell

// After
StationListTable → VirtualGroupedSections → OrdersQueueTableRow (queueMode: tech)
  headerEndSlot: Pipeline toggle + TableOptionsMenu
  useStationStaffScope({ defaultScope: 'mine' })
  useStationTableNavigation (new)
  useTableSelectMode + ContextualSelectionBar (TECH_HISTORY_SELECTION_SCOPE)
```

**Packer (`PackerTable.tsx`):** same pattern.

**Remove:** `PackerDashboard` `refreshNonce` remount — `queryClient.invalidateQueries` on
`usav-refresh-data`.

**Deep links:**

- NEW `useStationDeepLink` — resolves id from URL, finds index in `orderedRecords`, calls
  `virtualizer.scrollToIndex` after measure.

**Files:**

- MODIFY `TechTable.tsx`, `PackerTable.tsx`, `PackerDashboard.tsx`
- NEW `src/hooks/station/useStationTableNavigation.ts` (generalize receiving)
- NEW `src/hooks/station/useStationDeepLink.ts`
- NEW `src/lib/station/format-tech-copy-row.ts`, `format-packer-copy-row.ts`
- NEW `src/components/tech/TechHistoryBulkBar.tsx` (or inline in dashboard)
- DELETE (end of phase): `StationWeekTable.tsx`, `TechRecordRow.tsx`, `PackerRecordRow.tsx`,
  `StationRecordShell.tsx` when no importers remain

**Acceptance:**

- Week nav, detail panel, FBA/FNSKU rows unchanged
- Bulk copy 3 rows → valid TSV
- `?techLogId=` opens detail + scrolls row visible
- Keyboard ↑/↓ moves selection

**Effort:** 3–4 days

---

### Phase 3 — Receiving History + Incoming + Testing history

**Goal:** Virtualize receiving lists; week bands on testing history; ⋮ menu on all modes.

**Receiving (`ReceivingLinesTable.tsx`):**

- Replace `ReceivingGroupedList` direct map with `VirtualGroupedSections` + `QueueGroupRow` for PO groups.
- `layout=board` → `ReceivingHistoryShelfBoard` / `ReceivingIncomingShelfBoard`.
- Keep: `useReceivingTableNavigation`, `useReceivingDeepLink`, `useReceivingAutoWeek`, mode registry.
- `IncomingPaneHeader` + history `DateRangeHeader` gain `headerEndSlot`.

**Testing history (`TestingHistoryList.tsx`):**

- Add `useTestingHistoryController` — week offset, grouping, `techLogsQuery`-style factory.
- `StationListTable` + week bands + virtualization.
- Pipeline lanes by verdict.

**Files:**

- MODIFY `ReceivingLinesTable.tsx`, `ReceivingGroupedList.tsx`
- NEW `ReceivingHistoryShelfBoard.tsx`, `ReceivingIncomingShelfBoard.tsx`
- NEW `src/lib/receiving/receiving-board-lanes.ts` (lane SoT)
- MODIFY `TestingHistoryList.tsx`
- NEW `src/hooks/station/useTestingHistoryController.ts`

**Acceptance:**

- PO multi-line collapse works under virtualization (height re-measure on expand).
- Incoming delivered-unscanned facet unchanged.
- Testing history shows week header; 500-row flat fetch removed.

**Effort:** 5–7 days

---

### Phase 4 — Pipeline boards (full)

**Goal:** All `*ShelfBoard` consumers complete; lane counts in bubble headers.

**Work:**

1. Implement lane SoT modules (§4).
2. Wire `SwimlaneBoard` `bucket` fns per surface.
3. `prefsKey`: `techHistoryBoard`, `packerHistoryBoard`, `receivingHistoryBoard`,
   `receivingIncomingBoard`, `testingHistoryBoard`.
4. Board toolbar: `ColumnConfigButton` + `BoardSelectToggle` when page arms select mode.

**Effort:** 8–12 days total (can parallelize per surface after Phase 0–3)

---

### Phase 5 — Counts endpoints

**Goal:** Lane bubble counts + sidebar tiles without full row download.

**Routes (new):**

- `src/app/api/tech/logs/counts/route.ts`
- `src/app/api/packerlogs/counts/route.ts`
- `src/app/api/receiving-lines/counts/route.ts`

Implement SQL `COUNT(*)` + conditional aggregates; **lane labels** from TS mapping on aggregate keys
or pre-bucketed SQL on raw columns only (Decision 12).

**Client:** `station-queries.ts` counts factories; sidebar + lane headers consume counts query in parallel.

**Route auth:** add manifest entries per `new-route` skill.

**Effort:** 3–4 days

---

### Phase 6 — Ably / incremental sync (HIGH PRIORITY — start with Phase 2)

**Goal:** Floor scan → 0 full list refetch on idle tab.

**Work:**

1. Implement `station-cache-patch.ts` (§7.3).
2. Refactor `useTechLogs` / `usePackerLogs` to use patch module (remove inline prepend duplication).
3. Subscribe on `TechTable` / `PackerTable` / `ReceivingLinesTable` pages (mirror `UnshippedTable`).
4. Unit tests: patch/remove/prepend + counts invalidate (target 6+ cases like dashboard-cache-patch).

**Files:**

- NEW `src/lib/queries/station-cache-patch.ts`
- NEW `src/lib/queries/station-cache-patch.test.ts`
- MODIFY `useTechLogs.ts`, `usePackerLogs.ts`, station table components
- MODIFY `useRealtimeInvalidation.ts` if needed for reconnect-only broad invalidate

**Acceptance:**

- Tech scan on idle `/tech` tab: network shows 0 `GET /api/tech/logs` full refetch
- Row appears at top of correct day band
- Counts query invalidated, not full list

**Effort:** 4–5 days

---

### Phase 7 — QoL polish

| Item | Work |
|------|------|
| Keyboard nav | `useStationTableNavigation` on Tech, Packer, Testing |
| Bulk select | Tech + Packer `ContextualSelectionBar` |
| Copy TSV | `formatTechCopyRow`, `formatPackerCopyRow` |
| Deep links | `useStationDeepLink` all surfaces |
| First-run empty | per-surface `firstRunEmpty` slot |
| Select mode toggle | `BoardSelectToggle` or header pencil + menu |

**Effort:** 4–5 days (overlap with Phases 2–3)

---

## 9. Testing & observability

| Check | How |
|-------|-----|
| 1-up virtual scroll | `tests/e2e/station-virtual-list.spec.ts` — tech + receiving, 1-up board |
| 2-up virtual scroll | extend `unshipped-virtual-list.spec.ts` |
| Pipeline toggle | `layout=board` renders lanes; `all` renders dense table |
| Saved views ⋮ | save → reload → apply → URL match |
| Staff scope | `/tech` defaults mine; toggle all changes data |
| Ably patch | mock Ably message → assert no full GET |
| Deep link | `?packLogId=` scrolls into view |
| Copy TSV | selection bar copies 3 rows |
| Keyboard E2E | ↑/↓ changes `aria-selected` / detail open |
| Column + density | hide `tracking` + compact → no layout shift |
| PO expand | multi-line PO expand remeasures virtual row |
| Regression | `tsc`, ESLint, DS-guards, route-auth manifest |

**Metrics (optional):** extend `logRouteMetric` on new counts routes with `rowCount`, `cache`.

---

## 10. Rollout order & effort

| Phase | User-visible win | Risk | Effort |
|-------|------------------|------|--------|
| **V0** 1-up virtual fix | Unshipped + all boards scroll correctly | Medium | 2–3 d |
| **0** Substrate | Shared list table | Medium | 3–4 d |
| **1** ⋮ menu + scope | Saved views + staff scope | Low | 2–3 d |
| **2** Tech + Packer | Row parity + bulk + keyboard | Medium | 3–4 d |
| **3** Receiving + Testing | Virtualize + week bands | Medium–High | 5–7 d |
| **4** Pipeline boards | Workflow lanes | Medium | 8–12 d |
| **5** Counts | Fast legends | Low–Med | 3–4 d |
| **6** Ably patches | Live floor | Medium | 4–5 d |
| **7** QoL | Polish | Low | 4–5 d |

**Recommended sequence:**

```
V0 → 0 → 1 → 2 + 6 (parallel) → 3 → 4 → 5 → 7
```

**Feature flags:**

| Flag | Default | Purpose |
|------|---------|---------|
| `NEXT_PUBLIC_UNSHIPPED_VIRTUAL_LIST` | ON | existing |
| `NEXT_PUBLIC_STATION_VIRTUAL_LIST` | OFF → ON after V0 bake-in | station tables |
| `NEXT_PUBLIC_STATION_PIPELINE_BOARDS` | OFF until Phase 4 QA | board layout |

---

## 11. Migration & cleanup checklist

- [ ] Phase V0 merged + 1-up E2E green
- [ ] `StationWeekTable` deleted — zero importers
- [ ] `StationRecordShell`, `TechRecordRow`, `PackerRecordRow` deleted
- [ ] `SavedViewsControl` removed from sidebars; only ⋮ entry
- [ ] `PackerDashboard` `refreshNonce` removed
- [ ] `TestingHistoryList` flat 500 fetch removed
- [ ] Query keys documented in `station-queries.ts`
- [ ] `docs/security/route-permissions.json` updated for counts routes
- [ ] `table-columns.ts` unchanged keys (verify density orthogonal)

---

## 12. Dependencies & related docs

| Doc | Relationship |
|-----|--------------|
| `docs/unshipped-dashboard-performance-plan.md` | Reference stack; Phase V0 fixes shared blocker |
| `docs/receiving-history-improvement-plan.md` | Carrier/delivery correctness (incoming lanes consume) |
| `docs/unshipped-pending-merge-plan.md` | Historical queue context |
| `.claude/rules/ui-design-system.md` | Workbench archetype, row anatomy |
| `.claude/rules/backend-patterns.md` | Route skeleton, `invalidateCacheTags`, tenant scope |
| `.claude/skills/new-route.md` | Counts API routes |

---

## 13. Non-goals

- Mobile station/history UI
- Unified cross-surface search
- Server-backed saved views v1 (localStorage only; media/operations server views are separate products)
- Receive workspace mode (`?mode=receive`) unless explicitly scheduled after history/incoming
- Replacing `ReceivingLineOrderRow` with `OrdersQueueTableRow` (receiving domain too different)
- IndexedDB offline queues
- Pagination load-more UI at 10–50 rows (infra yes, UI hidden)

---

## 14. Open questions (resolve during build)

| ID | Question | Proposal |
|----|----------|----------|
| O1 | Receiving History `RECENTLY_SCANNED` lane predicate | `scanned_at` within 24h PST OR first `receiving_scans` timestamp |
| O2 | Tech "in-progress" lane vs history rows | Defer lane; only `TODAY` / `THIS_WEEK` / `FBA` v1 |
| O3 | Testing `RETEST` verdict field | Use existing testing verdict enum on `ReceivingLineRow` |
| O4 | Incoming default layout | `board` (supervisor-friendly) vs `all` — **confirm with ops** |
| O5 | `techLogId` deep link format | `?techLogId=123` OR `?sourceKind=tech_serial&sourceRowId=456` |
| O6 | Week offset URL | Single `?weekOffset=` for all surfaces |
| O7 | Saved views server sync | Follow-up ticket; localStorage for v1 |
| O8 | Receive workspace in scope | Out unless requested |

---

## 15. Phase V0 implementation notes (for implementer)

### SwimlaneBoard scroll ownership (sketch)

```tsx
// SwimlaneBoard inner body
const boardScrollRef = useRef<HTMLDivElement>(null);
const stacked = colCount === 1;

return (
  <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
  <header band ... />
  <div
    ref={boardScrollRef}
    className={stacked ? 'flex-1 min-h-0 overflow-y-auto' : 'flex flex-1 gap-3 ...'}
  >
    {lanes.map(... renderLaneBody({ scrollParentRef: stacked ? boardScrollRef : undefined }))}
  </div>
  </div>
);
```

### Lane body when `scrollParentRef` set

```tsx
<StationListTable
  virtualized
  scrollParentRef={scrollParentRef}
  growToContent={!scrollParentRef}
  autoHeight={Boolean(scrollParentRef) || !growToContent}
  ...
/>
```

### Virtualizer

```ts
useVirtualizer({
  getScrollElement: () => scrollParentRef?.current ?? bodyScrollRef.current,
  scrollMargin: scrollParentRef ? laneHeaderOffset : 0,
  ...
});
```

---

## 16. Appendix — key file references

### Current (pre-migration)

| Area | Path |
|------|------|
| Tech table | `src/components/TechTable.tsx` |
| Packer table | `src/components/PackerTable.tsx` |
| Station week shell | `src/components/station/StationWeekTable.tsx` |
| Tech row | `src/components/station/TechRecordRow.tsx` |
| Packer row | `src/components/station/PackerRecordRow.tsx` |
| Row shell (legacy) | `src/components/station/StationRecordShell.tsx` |
| Receiving table | `src/components/station/ReceivingLinesTable.tsx` |
| Receiving list | `src/components/station/ReceivingGroupedList.tsx` |
| Receiving row | `src/components/station/ReceivingLineOrderRow.tsx` |
| Testing history | `src/components/tech/TestingHistoryList.tsx` |
| Receiving modes SoT | `src/lib/receiving/receiving-modes.ts` |
| Keyboard nav | `src/components/station/useReceivingTableNavigation.ts` |
| Bulk selection | `src/hooks/useReceivingLineBulkSelection.tsx` |
| Saved views (legacy) | `src/components/sidebar/SavedViewsControl.tsx` |
| Shipped layout toggle | `src/components/shipped/dashboard-table/useShippedTableFilters.ts` |
| Unshipped board | `src/components/unshipped/UnshippedShelfBoard.tsx` |
| Virtual queue | `src/components/dashboard/orders-queue/VirtualQueueSections.tsx` |
| Dashboard patch | `src/lib/queries/dashboard-cache-patch.ts` |
| Tech logs hook | `src/hooks/useTechLogs.ts` |
| Packer logs hook | `src/hooks/usePackerLogs.ts` |
| Column registry | `src/lib/tables/table-columns.ts` |
| Staff filter | `src/hooks/useStaffFilter.ts` |

### Target (post-migration)

| Area | Path |
|------|------|
| List shell | `src/components/station/StationListTable.tsx` |
| Virtual body | `src/components/dashboard/orders-queue/VirtualGroupedSections.tsx` |
| Table ⋮ menu | `src/components/ui/table-options/TableOptionsMenu.tsx` |
| Staff scope | `src/hooks/useStationStaffScope.ts` |
| Saved views hook | `src/hooks/useSavedViews.ts` |
| Station queries | `src/lib/queries/station-queries.ts` |
| Station patch | `src/lib/queries/station-cache-patch.ts` |
| URL SoT | `src/lib/station/table-url-params.ts` |
| Lane SoT | `src/lib/receiving/receiving-board-lanes.ts`, `src/lib/station/tech-board-lanes.ts`, ... |
| Shelf boards | `src/components/receiving/ReceivingIncomingShelfBoard.tsx`, etc. |

---

*Last updated: 2026-07-05. Owner: TBD. Next action: Phase V0 (1-up virtualization fix on `SwimlaneBoard`).*
