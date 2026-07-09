# Unified Global Search — Sidebar Removal & Recents Plan

> **Status:** Phase 0 SHIPPED (code-complete, flag-gated OFF) · Created 2026-07-05  
> **Goal:** One search control in the global header. Remove search bars from every master-sidebar panel. Add a recents dropdown on focus and a dedicated `/search` history surface reachable from the search UI itself — no copy/paste to re-run a query.  
> **Related:** `docs/ai-search-modernization-plan.md`, `docs/design-system/master-sidebar-nav-migration-plan.md`, `src/components/layout/GlobalHeaderSearch.tsx`, `src/components/search/SearchWorkspace.tsx`

> **⚠️ Transition constraint (user directive 2026-07-05):** the sidebar search bars **stay in place** throughout this migration — they remain the fallback until the global header search is complete. Phase 0 is therefore purely **additive**: nothing is removed, `migrateLegacyRecents()` is **non-destructive** (legacy keys retained; the sidebars still read them), and the whole recents layer is gated behind `NEXT_PUBLIC_UNIFIED_HEADER_SEARCH` (default OFF → header byte-identical to today). Sidebar removal begins only in the later phases, once the header is signed off.

## Execution status

- **Phase 0 — Foundation: SHIPPED 2026-07-05 (flag OFF by default).** All deliverables code-complete + tsc-clean; unit tests green (`npm run test:ai-search`, +20 → 90). See the Phase 0 checklist below. Not yet exercised in a running app (flag is off) — enable `NEXT_PUBLIC_UNIFIED_HEADER_SEARCH=true` to try the recents loop.
- Phases 1–7 — not started (sidebar migrations; gated on the header being signed off + the flag flip).

---

## 0. Executive summary

Today the app has **two competing search surfaces**:

1. **Global header search** (`GlobalHeaderSearch`) — AI quick-jump preview, Enter → `/search?q=`, optional contextual mode via `usePageHeaderSearch` (only Signals uses this today).
2. **Sidebar header search** — ~30 panels pass a `search` prop into `SidebarShell`, each with its own placeholder, debounce, URL param, and **separate localStorage recents bucket**.

Operators must discover which bar is “active,” sidebar chrome is taller than it needs to be, and recent queries are siloed (`dashboard_search_history`, `inventory_search_history_${tab}`, shipped/unshipped copies, CommandBar `command-bar-recent` for navigation hits — not queries).

**Target state:**

| Surface | Role |
|---|---|
| **Global header search** | The **only** always-visible search input on desktop workbench/monitor pages |
| **Header dropdown** | Live preview hits (existing) + **Recent queries** section when input is empty or focused |
| **`/search` page** | Full results workspace **and** the canonical “all recents” view — linked from the dropdown footer |
| **Sidebar panels** | Lists, filters, mode rails, recents **removed from sidebar** — no `SidebarShell.search` |

This plan sequences the migration without breaking station archetypes (scan-first mobile flows keep their inline inputs).

---

## 1. Problem statement

### 1.1 Fragmentation inventory

**Infrastructure already shipped:**

| Piece | Location | Notes |
|---|---|---|
| Header search pill | `src/components/layout/GlobalHeaderSearch.tsx` | Preview dropdown, AI/classic fallback, ⌘K focus |
| Contextual registration | `usePageHeaderSearch` in `src/hooks/usePageHeader.ts` | Wires page filter state into the same pill |
| Full results page | `src/app/search/page.tsx` + `SearchWorkspace.tsx` | `?q=` / `?type=` URL state, category tabs |
| Sidebar search shell | `SidebarShell` + `SidebarSearchBar` | Guarded by `sidebar-search-bar.guard.test.ts` |
| Per-domain recents | See §1.2 | Not unified |

**Sidebar panels with `SidebarShell search={…}` (must migrate or exempt):**

| Panel / file | Search behavior today | URL / state hook |
|---|---|---|
| `DashboardManagementPanel` | Pending orders filter + recents in body | `?search=` |
| `ShippedSidebar` | Shipped lookup + field scope + recents | `useShippedSearch` / `?search=` |
| `UnshippedSidebar` | Queue filter + recents | `?search=` |
| `ProductsSidebarPanel` | Manuals/pairing/qc filter; labels history = scan lookup | `?q=` |
| `WarehouseSidebarPanel` | Room finder **or** SKU/bin lookup (mode-dependent) | `roomFinderContext` / SKU hook |
| `ReceivingSidebarPanel` (+ sub-panels) | Incoming PO filter, history search | `?search=` / mode helpers |
| `RepairSidebarPanel` | Repair queue filter | URL tab + search |
| `OperationsSidebarPanel` | Live activity filter (`?q=`) | Signals sub-view uses header already |
| `InventorySidebar` (+ pulse/triage/graph) | Per-tab entity search + field pills + recents | `?q=` + `?field=` |
| `ReplenishSidebarPanel` | Replenishment need filter | local/URL |
| `PhotoLibrarySidebarPanel` | Media library filter | URL |
| `ManualsLibrarySidebar` | File tree filter | local |
| `SourcingSidebarPanel` | Scout/queue filter (two modes) | URL |
| `GoalsSidebarPanel` | Goals list filter | URL |
| `AuditLogSidebarPanel` | Audit row filter; trace mode = serial input | URL |
| `LabelsModeBody` / `ScanOutModeBody` | Outbound queue filter | URL |
| `WarrantyLoggerSidebar` | Warranty log filter | URL |
| `FbaSidebar` | FBA plan/shipment filter | URL |
| Admin: `LogsSidebarPanel`, `FbaCatalogSidebarPanel`, `StaffScheduleSidebarPanel`, sourcing admin panels, `OperationsSidebarPanel` (workflow), etc. | Config list filters | `?search=` / admin URL helpers |

**Inline / non-sidebar-header search (different contract — see §5 exemptions):**

- `TechRailSearchBar`, `TriageCartonSearchBar` — bottom-anchored compact bars
- Mobile `ScanInput`, `ScanSurface`, packer station flows
- Workspace/modal pickers (`ClaimTicketPicker`, `FnskuSearchModal`, table toolbars)
- `SearchWorkspace` duplicate `SearchField` on `/search` (becomes read-only mirror of header)

### 1.2 Recent-search storage today (must consolidate)

| Key / hook | Scope | Stored shape |
|---|---|---|
| `command-bar-recent` | CommandBar navigation | `{ id, label, href }` — **selected hits**, not typed queries |
| `dashboard_search_history` | Unshipped + dashboard pending | `{ query, timestamp }` |
| Shipped sidebar | Shipped view | Similar localStorage (via shipped search hook) |
| `inventory_search_history_${tab}` | Inventory per tab | `{ query, field, timestamp, resultCount? }` |
| `useInventoryRecentSearches` | Renders `RecentSearchesList` in sidebar body | — |
| `RecentSearchesList` component | Shared UI only | No storage |

**Gap:** There is no **global query history** and no **single page** to browse/re-run all past searches without retyping.

---

## 2. Target UX

### 2.1 Global header search — one control

```
┌────────────────────────────────────────────────────────────── GlobalHeader ──┐
│  [Page context zone …]     │  🔍 Search…  ⌘K  ✨  │  📋 🔔 👤              │
└────────────────────────────────────────────────────────────────────────────┘
                                      │
                    focus or ⌘K       ▼
              ┌─────────────────────────────────────┐
              │ Recent searches                     │
              │  · PO-44102          Dashboard · 2h   │
              │  · X1D-C900          Inventory · 1d   │
              │  · samsung galaxy    Global · 3d      │
              │  View all recent searches →           │  ← links to /search/history
              ├─────────────────────────────────────┤
              │ (when typing ≥2 chars)              │
              │  See all results for "…" →          │  ← links to /search?q=
              │  · Order #1234 …                    │
              │  · SKU X1D-C900 …                   │
              └─────────────────────────────────────┘
```

**Interaction rules:**

1. **Empty + focused** → show Recent searches (max 6 in dropdown) + footer link.
2. **Typing ≥2 chars** → show preview hits (current AI/classic behavior) + “See all results” + recents collapse or move below a divider (design choice: recents hidden while typing).
3. **Enter** →
   - **Global mode** (no contextual registration): push query to unified recents → navigate `/search?q=`.
   - **Contextual mode** (page registered `usePageHeaderSearch`): push recents with `scope: pathname+mode` → call `onSearch` / debounced `onChange` as today.
4. **⌘K** → focus header search (already wired via `GLOBAL_SEARCH_FOCUS_EVENT`).
5. **Escape** → clear query if non-empty, else blur (already implemented).

### 2.2 `/search` — results + history hub

Two logical views on one route family:

| Route | Purpose |
|---|---|
| `/search?q=&type=` | **Results** (existing `SearchWorkspace`) — cross-entity AI/keyword retrieval |
| `/search/history` | **Recents archive** — full list, grouped by day, re-run / pin / clear |

`/search/history` is **not** a sidebar page — it renders in the main content column only (workbench body), same as today's `/search`. Access paths:

- Dropdown footer: “View all recent searches”
- `/search` empty state CTA when `?q=` absent
- Optional keyboard: ⌘K → ↑ to recents section (future polish)

**Re-run behavior:** clicking a recent row sets header query + navigates appropriately:

- `scope: 'global'` → `/search?q=…`
- `scope: '/dashboard?unshipped'` → `/dashboard?unshipped&search=…` (contextual filter, no full retrieval unless user chooses “Search everywhere”)

### 2.3 Sidebar after migration

```
┌─ Master nav header ─────────────────┐
│  📦 Receiving · Incoming        ⌄   │
├─ Mode rail (L2 icons) ─────────────┤
│  (no search row)                    │
├─ Filter refinement (optional) ──────┤
│  pills / status legend              │
├─ scroll body ───────────────────────┤
│  lists, KPIs, handoff cards         │
│  (no RecentSearchesList)            │
└─────────────────────────────────────┘
```

Sidebar vertical space reclaimed: **40px search band + recents section** (~80–120px typical).

---

## 3. Architecture

### 3.1 Search modes (formal contract)

Every page declares exactly one mode to the header subsystem:

```ts
type HeaderSearchMode =
  | { kind: 'global' }                                    // default — /search retrieval
  | { kind: 'contextual'; control: HeaderSearchControl } // filters active list via URL
  | { kind: 'none' };                                     // header search still global
```

| Mode | Header placeholder | Enter behavior | Recents `scope` |
|---|---|---|---|
| `global` | `Search…` | `/search?q=` | `global` |
| `contextual` | Page-specific | Updates page URL params | `pathname` + stable mode key |
| `none` | `Search…` (global) | `/search?q=` | `global` |

**Important:** `contextual` is for **list refinement on the current page**, not a second global search. Cross-entity lookup always goes to `/search`.

Registration pattern (replace sidebar search state):

```tsx
// Example: Unshipped sidebar panel body — no SidebarShell.search
usePageHeaderSearch(
  {
    value: searchQuery,
    onChange: setSearchQuery,
    onSearch: (q) => updateUrl({ search: q }),
    onClear: () => updateUrl({ search: '' }),
    placeholder: 'Filter unshipped orders…',
    debounceMs: 320,
    isSearching: isFetching,
  },
  [searchQuery, isFetching],
);
```

### 3.2 Unified recents module (new SoT)

**New module:** `src/lib/search/search-recents.ts`

```ts
export interface SearchRecentEntry {
  id: string;              // stable uuid or hash
  query: string;
  scope: 'global' | string; // 'global' or canonical scope key e.g. 'dashboard:unshipped'
  scopeLabel: string;       // "Unshipped", "Inventory · SKUs", …
  timestamp: string;        // ISO
  resultCount?: number;
  topHit?: { title: string; href: string; entityType: string }; // optional, from last run
}

// API
pushSearchRecent(entry: Omit<SearchRecentEntry, 'id' | 'timestamp'>): void
listSearchRecents(filter?: { scope?: string; limit?: number }): SearchRecentEntry[]
clearSearchRecents(scope?: string): void
migrateLegacyRecents(): void  // one-time import from old keys
```

**Storage:** `localStorage` key `usav_search_recents_v1` (single array, max 100 entries, MRU dedupe by `scope+query` case-insensitive).

**React hook:** `src/hooks/useSearchRecents.ts` — subscribes to storage events for cross-tab sync.

**Migration on first load:** import & merge legacy buckets (§1.2), then delete old keys after successful import (logged once).

### 3.3 Header dropdown composition

Extend `GlobalHeaderSearch` dropdown sections:

| Section | Condition | Component |
|---|---|---|
| Recents | `focused && !trimmedQuery` | New `SearchRecentsDropdown` |
| Preview hits | `focused && trimmedQuery.length >= 2` | Existing `AiQuickJumpResults` |
| Footer | always when open | Link row(s) to `/search/history` and/or `/search?q=` |

Extract dropdown body to `src/components/search/GlobalSearchDropdown.tsx` for testability.

### 3.4 Search history page

**New files:**

- `src/app/search/history/page.tsx` — shell + suspense
- `src/components/search/SearchHistoryWorkspace.tsx` — grouped list, clear actions, re-run

**Layout:** reuse `PageHeader` pattern from `SearchWorkspace`. No duplicate search field — page title “Recent searches” with subtitle explaining header re-run. Rows use the same row anatomy as `RecentSearchesList` but full-page with day grouping.

**Deep link from header:** `/search/history?scope=global` optional filter.

### 3.5 Remove sidebar search infrastructure (end state)

| Item | Action |
|---|---|
| `SidebarShell.search` prop | Deprecate → remove after migration |
| `SidebarSearchBar` | Keep temporarily; only shell uses it until prop removed |
| `sidebar-search-bar.guard.test.ts` | Update: allow zero sidebar search imports; eventually delete guard |
| `sidebarHeaderSearchRowClass` | Remove from sidebar layout tokens when unused |
| `RecentSearchesList` in sidebar bodies | Remove call sites; keep component for history page OR fold into history workspace |
| Per-domain history hooks | Thin wrappers calling unified recents with scope key, then delete |

### 3.6 CommandBar relationship

`CommandBar.tsx` already delegates ⌘K to `dispatchGlobalSearchFocus()`. Plan:

1. **Phase 1:** CommandBar palette becomes navigation + actions only when opened from quick-access menu; ⌘K focuses header (current behavior).
2. **Phase 2:** Merge CommandBar search results UI into header dropdown (avoid two preview implementations). CommandBar retains nav/actions/Ask-AI entry; remove duplicate `/api/global-search` fetch from CommandBar if header owns preview.
3. Recents: **`command-bar-recent` migrates to unified store** as `scope: 'navigation'` entries OR stays separate for “recently opened records” — see Decision D4.

---

## 4. Locked decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | **One visible search input** on desktop master-layout pages | User request; matches AI search modernization direction |
| D2 | **Contextual filter vs global retrieval** stay distinct | Inventory “filter bins list” ≠ “find any entity”; wrong to force both through `/search` |
| D3 | **Unified recents SoT** in `search-recents.ts` | Eliminates 5+ localStorage keys; single history page |
| D4 | **Navigation recents ≠ query recents** | CommandBar stores last *opened records*; unified recents stores last *typed queries*. Both appear in dropdown under separate headings (“Recent searches” / “Recently opened”) — optional Phase 2 |
| D5 | **`/search/history` is main-column only** | User asked for a page separate from sidebars; no new sidebar panel |
| D6 | **Station/mobile scan inputs exempt** | `.claude/rules/contextual-display.md` station archetype — scan → display must stay inline |
| D7 | **Migrate with feature flag** `NEXT_PUBLIC_UNIFIED_HEADER_SEARCH` | Per-panel rollout; sidebar search remains fallback until flag on globally |
| D8 | **Master sidebar nav migration** | This plan **supersedes** master-sidebar plan §3 note “panels keep search in body” — panels keep lists/filters only |

---

## 5. Exemptions (do NOT remove)

These are **not** “master sidebar search bars” and stay inline:

| Surface | Reason |
|---|---|
| Mobile immersive routes (`/m/...`) | Station archetype |
| `TechRailSearchBar` / `TriageCartonSearchBar` | Bottom-anchored contextual filter, not header band |
| Modal/workspace pickers | Local scoped UI |
| Table-internal compact search | Workbench sub-region |
| `FilterRefinementBar` | Filter chips ≠ search |
| NAS/browser embedded search | Third-party chrome |
| Packer station scan-first UI | Station |

**Special contextual behaviors to preserve:**

| Behavior | Today | After |
|---|---|---|
| Labels unit history scan | Sidebar Enter → `unit-history:lookup` event | Header contextual `onSearch` dispatches same event |
| Audit trace serial | Sidebar Enter → trace picker | Header contextual mode on audit trace sub-mode |
| Warehouse room finder | Sidebar filters rooms | Header contextual; placeholder switches via `usePageHeaderSearch` deps |

---

## 6. Phased implementation

### Phase 0 — Foundation (1–2 days)

**Deliverables:** _(all SHIPPED 2026-07-05)_

- [x] `src/lib/search/search-recents.ts` + unit tests (dedupe, cap, scope filter, remove, clear) — `search-recents.test.ts`
- [x] `src/hooks/useSearchRecents.ts` (in-tab `SEARCH_RECENTS_EVENT` + cross-tab `storage` sync)
- [x] `migrateLegacyRecents()` + idempotent migration test — **non-destructive** (marker-gated, legacy keys retained per the transition constraint; `deleteLegacy` param defers deletion to Phase 6)
- [x] `SearchRecentsDropdown` component
- [x] Wire recents into `GlobalHeaderSearch` when query empty + focused (flag-gated)
- [x] Footer link → `/search/history`
- [x] Feature flag `NEXT_PUBLIC_UNIFIED_HEADER_SEARCH` (default off) — **client-safe** module `src/lib/search/unified-header-search.ts` (NOT `feature-flags.ts`, which imports the DB pool and is server-only)
- [x] **Extra:** `src/lib/search/search-scope-labels.ts` (`resolveSearchScopeLabel`, §8) + tests
- [x] **Extra:** `/search/history` page + `SearchHistoryWorkspace` (day-grouped, re-run/remove/clear, scope filter) — §3.4/§9.2

> **Deferred (needs manual step):** `.env.example` could not be edited (a hook blocks `*.env.*` paths). Add `NEXT_PUBLIC_UNIFIED_HEADER_SEARCH=` there manually.

**Acceptance:**

- Focus header → see migrated legacy dashboard/inventory recents
- Selecting a recent re-runs correctly per scope
- `/search/history` renders full list with clear / re-run

### Phase 1 — Pilot contextual migration (2–3 days)

Migrate **3 representative panels** to prove the pattern:

1. **`UnshippedSidebar`** — list filter + remove body `RecentSearchesList`
2. **`SignalsWorkspace`** — already on header; add recents push on Enter
3. **`OperationsSidebarPanel` live activity** — move `?q=` filter to header; remove sidebar search

**Acceptance:**

- With flag ON, pilot pages have no sidebar search band
- URL state unchanged (deep links still work)
- Recents recorded with correct `scopeLabel`

### Phase 2 — Dashboard + shipped cluster (3–4 days)

- [ ] `DashboardManagementPanel`
- [ ] `ShippedSidebar` — migrate shipped search + remove field pills from sidebar search group (field scope moves to `FilterRefinementBar` or filters popover per AI search plan)
- [ ] Remove `useDashboardSearchHistory` localStorage in favor of unified recents
- [ ] Redirect `dashboard-focus-search` event → `dispatchGlobalSearchFocus()`

### Phase 3 — Inventory + warehouse + products (4–5 days)

- [ ] `InventorySidebar` (+ pulse/triage/graph variants)
- [ ] `WarehouseSidebarPanel` — dual placeholder behavior via contextual control
- [ ] `ProductsSidebarPanel` — including labels history scan mode
- [ ] `ReplenishSidebarPanel`

**Inventory note:** per-tab recents become `scope: inventory:${tab}` in unified store; field metadata preserved in entry optional fields.

### Phase 4 — Receiving + outbound + repair (3–4 days)

- [ ] `ReceivingSidebarPanel` + `IncomingSidebarPanel` + `ReceivingHistorySearchSection`
- [ ] `RepairSidebarPanel`
- [ ] `LabelsModeBody`, `ScanOutModeBody`
- [ ] `FbaSidebar`

### Phase 5 — Remaining sidebars + admin (3–4 days)

- [ ] Operations (non-signals modes), Goals, Audit, Sourcing, Photo library, Manuals, Warranty
- [ ] Admin sidebar panels via `AdminSidebarShell` — single hook at shell level reading admin URL `search` param

### Phase 6 — Deletion & guard updates (1–2 days)

- [ ] Remove `search` prop from `SidebarShell`; delete `SidebarSearchBar` if unused
- [ ] Update `sidebar-search-bar.guard.test.ts` → `sidebar-shell-no-search.guard.test.ts`
- [ ] Remove duplicate `SearchField` from `SearchWorkspace` (header is SoT; page reads `?q=` from URL only)
- [ ] Delete legacy hooks: `useDashboardSearchHistory`, `useInventoryRecentSearches` storage fns
- [ ] Update `docs/design-system/master-sidebar-nav-migration-plan.md` cross-reference
- [ ] Flip `NEXT_PUBLIC_UNIFIED_HEADER_SEARCH` default **ON**

### Phase 7 — CommandBar consolidation (optional, 2 days)

- [ ] Dedupe preview fetch paths
- [ ] Add “Recently opened” section from `command-bar-recent` alongside query recents
- [ ] Document in `docs/ai-search-modernization-plan.md` Phase 3 tail

---

## 7. Per-panel migration checklist (template)

For each sidebar panel:

1. **Identify search kind:** global vs contextual vs scan-action vs exempt.
2. **Extract state** — URL param / hook already owning the query string.
3. **Register** `usePageHeaderSearch({ … })` in panel root or workspace child — match old placeholder/debounce/isSearching.
4. **Push recents** on `onSearch` (Enter) and optionally after debounced commit with result count.
5. **Remove** `search={…}` from `SidebarShell`.
6. **Remove** `RecentSearchesList` / inline recents from sidebar body.
7. **Update** focus events (`*-focus-search`) → `dispatchGlobalSearchFocus()`.
8. **Verify** deep links: `?search=`, `?q=`, etc. still hydrate header value on load.
9. **Add** scope key to `search-recents` registry (`src/lib/search/search-scope-labels.ts`).
10. **Test** keyboard: ⌘K focus, Escape clear, Enter navigate/filter.

---

## 8. Scope label registry (new SoT)

**New file:** `src/lib/search/search-scope-labels.ts`

Maps canonical scope keys to human labels for recents UI:

```ts
export function resolveSearchScopeLabel(scope: string): string {
  // 'global' → 'Everywhere'
  // 'dashboard:unshipped' → 'Unshipped'
  // 'inventory:skus' → 'Inventory · SKUs'
  // …
}
```

Built from existing mode metadata in `sidebar-navigation.ts`, `inventory-search.ts` tab labels, admin section options — **do not duplicate** label strings inline at call sites.

---

## 9. `/search` page updates

### 9.1 Results view (`SearchWorkspace`)

- Remove embedded `SearchField` — query display becomes read-only breadcrumb (“Results for **{q}**”) with “Edit in header” hint, or mirror URL into header on mount via existing sync effect.
- Add empty-state link: “Browse recent searches →”
- On successful retrieval, optionally update latest recent entry with `resultCount` + `topHit`.

### 9.2 History view (new)

- Group by calendar day (`Today`, `Yesterday`, …)
- Row: query, scope chip, relative time, optional result count
- Actions: Re-run, Copy query, Remove one, Clear all (global or per-scope)
- No sidebar; full-width workbench body; `PageHeader title="Recent searches"`

---

## 10. Testing plan

| Layer | Coverage |
|---|---|
| Unit | `search-recents.ts` — push/dedupe/cap/migrate |
| Unit | `resolveSearchScopeLabel` |
| Component | `SearchRecentsDropdown` — empty, populated, select |
| Guard | No `SidebarShell search=` after Phase 6 (eslint rule or codemod guard) |
| E2E | `tests/e2e/global-search-recents.spec.ts` — type query → see in dropdown → `/search/history` → re-run |
| E2E | Pilot pages — unshipped filter via header updates table |
| Manual | Warehouse room vs SKU placeholder switch |
| Manual | Labels history scan Enter still fires lookup |
| Manual | Mobile `/m/*` unchanged |

---

## 11. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Users muscle-memory sidebar click target | Flag rollout; empty sidebar band removed gradually; ⌘K unchanged |
| Contextual vs global confusion | Scope chip on every recent row; contextual Enter never silently jumps to `/search` |
| Lost per-tab inventory recents | Preserve `scope` granularity in unified store |
| Header too narrow for long placeholders | Truncate placeholder; full text in tooltip |
| Dual search during migration | Flag gates sidebar removal per route group |
| Scan/station flows broken | Explicit exemption list (§5); QA on receiving labels history |
| `SearchWorkspace` without visible input on `/search` | Page shows query headline; header pre-filled from URL |

---

## 12. Success metrics

- **0** `SidebarShell` instances with `search=` prop (post Phase 6)
- **1** localStorage recents key for queries
- **≤2** preview fetch implementations (header only after Phase 7)
- Sidebar header height reduced by 40px on migrated pages
- E2E recents re-run path green

---

## 13. File touch list (expected)

**New**

- `src/lib/search/search-recents.ts`
- `src/lib/search/search-recents.test.ts`
- `src/lib/search/search-scope-labels.ts`
- `src/hooks/useSearchRecents.ts`
- `src/components/search/SearchRecentsDropdown.tsx`
- `src/components/search/SearchHistoryWorkspace.tsx`
- `src/app/search/history/page.tsx`
- `tests/e2e/global-search-recents.spec.ts`

**Modified heavily**

- `src/components/layout/GlobalHeaderSearch.tsx`
- `src/components/search/SearchWorkspace.tsx`
- Every file in §1.1 inventory table
- `src/components/layout/SidebarShell.tsx` (Phase 6)
- `src/lib/feature-flags.ts`

**Deleted (Phase 6)**

- `src/components/ui/SidebarSearchBar.tsx` (if fully unused)
- `src/components/sidebar/dashboard-management/useDashboardSearchHistory.ts`
- Per-domain recent storage in `useInventoryRecentSearches.ts` (keep push API as scoped wrapper initially)

---

## 14. Open questions

| # | Question | Default if unanswered |
|---|---|---|
| Q1 | Should contextual recents appear in `/search/history` or only global? | **Show all**, filterable by scope chip |
| Q2 | Max recents in dropdown vs history page? | **6** dropdown, **100** stored |
| Q3 | Persist recents per-user server-side for cross-device? | **No** — localStorage v1; server sync is future work |
| Q4 | Admin pages: global or contextual default? | **Contextual** — admin lists are filter-first |
| Q5 | Remove CommandBar search UI entirely? | **Phase 7 optional** — header owns search first |

---

## 15. Relationship to other initiatives

- **AI search modernization** — this plan **implements** the “remove narrow search bars” tail of Phase 3; retrieval/API unchanged.
- **Master sidebar nav** — removing sidebar search reduces header chrome before mode-rail migration; update master-sidebar plan §1 paragraph accordingly.
- **Unshipped performance plan** — sidebar body gains vertical space; no query/API changes.

---

## 16. Suggested first PR (minimal vertical slice)

1. Add `search-recents.ts` + migration from `dashboard_search_history`.
2. Add recents section to `GlobalHeaderSearch` dropdown.
3. Add `/search/history` page.
4. Migrate **UnshippedSidebar** only behind flag.

This proves the full loop — record → dropdown → history page → re-run — before touching the long tail of admin/inventory panels.
