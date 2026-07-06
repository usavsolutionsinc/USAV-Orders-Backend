# Best-in-Class Global Header Search — Display & Operations Results Plan

> **Status:** Proposed · Created 2026-07-05 · **Detailed build-out** 2026-07-05 (verified against live code)
> **Owner surfaces:** `src/components/layout/GlobalHeaderSearch.tsx` (the one header search) + `/operations?mode=history` (the scoped results destination)
> **Builds on:** `docs/unified-global-search-consolidation-plan.md` (Phase 0 SHIPPED — unified recents SoT + `/search/history`) · `docs/ai-search-modernization-plan.md` (Phases 0–3 shipped — `hybridSearch` engine, `SearchHit`, `/api/ai/retrieve`)
> **Flag:** `NEXT_PUBLIC_UNIFIED_HEADER_SEARCH` (client-safe, default OFF — everything below is byte-identical to today until flipped)
> **Design method:** authored through `/ui-ux-pro-max` — priority order Accessibility → Touch/Interaction → Performance → Style → Layout → Typography/Color → Animation → Forms/Feedback → Navigation. Every visual decision below cites the rule it satisfies.

> **Implementation status (2026-07-05): Phases A–D BUILT behind the flag.** `SearchResultRow` + `search-result-chips` + `search-tabs` (A); `GlobalSearchDropdown` combobox + glass (B); `SearchResultsSurface` + thin `SearchWorkspace` (C); operations `?q=` browse → drill, `usePageHeaderSearch` wiring, sidebar recents, right-pane crossfade (D). `tsc` clean, `eslint` clean, `test:ai-search` = **95 pass** (5 new for `search-tabs`). Flag `NEXT_PUBLIC_UNIFIED_HEADER_SEARCH` default OFF → byte-identical to today. **Not yet done:** Phase E (facet enrich, optional); the e2e spec + component tests (harness is node:test — pure-logic only); live exercise with the flag ON.

---

## 0. What this plan delivers

Two coupled deliverables, one shared spine:

1. **A best-in-class global header search *display*** — the always-on header pill + dropdown. Empty→recent searches; typing→grouped rich preview hits; keyboard-first (WAI-ARIA combobox); glass container; one search bar for the whole app.
2. **A best-in-class *results surface*** for `/operations?mode=history` — orders-first, Shopify/Linear-style **rich result rows** (not a timeline dump, not floating bubbles), with recent searches in the sidebar and the existing per-record journey timeline kept as the click-through drill-down.

Both are powered by **one engine** (`/api/ai/retrieve` → `hybridSearch`), **one result renderer** (a shared rich-row component), and **one recents store** (`src/lib/search/search-recents.ts`, already built and shipped). Nothing is forked.

### 0.1 Industry north star — why rows, not bubbles

Order/shipment search in Shopify admin, Stripe dashboard, Amazon Seller Central, and Linear all converge on the same pattern: **one global search → a filtered *list* of rich rows with status chips → click a row to drill into the record.** Cards/bubbles are for visual catalogs (products/media) where the image *is* the content; for orders, operators scan many rows fast, so rows win. This matches the house style verbatim (`ui-design-system.md`: *"no grids," "one row anatomy: title → meta → chips(right)"*) and the skill's `search-accessible` + `visual-hierarchy` rules. "Glass" applies to the **section container**, never by scattering free-floating cards.

### 0.2 What changed after verifying against live code (read this)

The earlier draft made several assumptions that the code does **not** match. This build-out corrects them; each is called out again at the phase that depends on it.

| Earlier assumption | Verified reality | Consequence |
|---|---|---|
| Motion preset `framerPresence.dropdownOpen` | The presence key is **`framerPresence.dropdownPanel`** (`initial {opacity:0,y:-4}`); the *transition* is `framerTransition.dropdownOpen`. | Use `useMotionPresence(framerPresence.dropdownPanel)` + `useMotionTransition(framerTransition.dropdownOpen)`. |
| `AiQuickJumpResults` rows already have a status dot | They render an **entity icon + lowercase entity-type tag**, **no status dot**. | The order row's status dot is **new** work, not a rename. |
| Operations history is driven by `?q=` | History is driven by **exact-entity focus** — sidebar search writes `?order=/?serial=/?tracking=` via `url.setEntity` (keyed by `?dim=`). `?q=` is read into `filters.q` and forwarded to the journey API but **never written** by History. | Phase D must **add** a browse query (`q`/`setQ`) to the operations URL-state hook, distinct from entity focus. |
| Hook exposes `q/setQ/dimension/setDimension/clear` | Real shape: `dim/setDim/entityValue/setEntity/focused/filters/clearFilters`; `focused = !!entityValue.trim()`. | Wire against the real names. |
| Order row dot = `workflowStageDot(facets.status)` | `workflowStageDot` only knows receiving/testing statuses (`EXPECTED…DONE`); an order status (`shipped/delivered/…`) falls through to the neutral **`bg-border-emphasis` "unknown"** dot. | Order dot/chip tone need a small **order-status tone SoT** (§5.4), not `workflowStageDot`. |
| `SearchTabId` is a shared type | No such type exists; the tab type is the **local** `TabId` in `SearchWorkspace.tsx`, over `CATEGORY_TABS`. | Phase C promotes `CATEGORY_TABS` + `TabId` into a shared module. |
| Any sidebar search can reuse `SidebarSearchBar` | `SidebarSearchBar` may be imported **only** by `SidebarShell` (enforced by `sidebar-search-bar.guard.test.ts`). | The operations sidebar's recents block must not re-import it; use `SearchRecentsDropdown` / `SearchBar` directly. |

---

## 1. Architecture — the narrow waist (input / engine / display)

```
                      ┌──────────────────────────────────────────────┐
   INPUT LAYER        │  GlobalHeaderSearch (the ONE bar)            │
   (one control)      │   · global mode  → dropdown + push→/search   │
                      │   · contextual   → usePageHeaderSearch(?q=)  │  ← operations registers here
                      └───────────────┬──────────────────────────────┘
                                      │ query string
                      ┌───────────────▼──────────────────────────────┐
   ENGINE LAYER       │  POST /api/ai/retrieve → hybridSearch()      │
   (one retrieval)    │   exact bypass → keyword(trgm) → vector → RRF │
                      │   returns SearchHit[] (title/subtitle/chips/  │
                      │   facets/href) — NEVER raw rows              │
                      └───────────────┬──────────────────────────────┘
                                      │ AiSearchHit[] (wire shape)
        ┌─────────────────────────────┼─────────────────────────────┐
        ▼                             ▼                              ▼
  DISPLAY LAYER              DISPLAY LAYER                    DISPLAY LAYER
  GlobalSearchDropdown       <SearchResultsSurface>           ⌘K CommandBar
  (preview + recents)        (/search AND /operations)        (existing, untouched)
        │                             │
        └──────── one renderer: <SearchResultRow variant> ──────────┘
                             │
                   RECENTS STORE (unified, already shipped)
              search-recents.ts + useSearchRecents
        header dropdown · operations sidebar · /search/history
```

**The invariant:** every consumer calls the same engine and renders the same `SearchResultRow`. A new surface = a new *mount*, never a new search/renderer (SoT rule from `source-of-truth.md` → "Cross-entity search (the narrow waist)").

**Wire vs. domain shape:** the client speaks `AiSearchHit` (`src/lib/search/ai-search-client.ts` — loose `chips[].tone: string`); the server produces `SearchHit` (`src/lib/search/search-hit.ts` — strict `tone: 'gray'|'blue'|'emerald'|'amber'|'rose'`). `SearchResultRow` accepts `AiSearchHit` (the client shape) so it works for the header preview, `/search`, and operations without a second adapter.

---

## 2. Guardrails (must not violate)

- **Archetype split (`contextual-display.md`).** `/operations?mode=history` becomes a **two-region** surface: (a) a **results region** (Monitor-with-detail — observe a filtered list, click to drill) and (b) the **record-journey timeline** (the drill detail; a Workbench right-pane). Each region obeys one archetype; never blend them. The crossfade target is the **right pane only** (`framerPresence.workbenchPane`), never the sidebar/list.
- **One search input.** Removing the operations `SidebarShell.search` and driving from the header is the whole point. Sidebar bars on *other* pages **stay** (user directive — they're the fallback until the header is complete; consolidation-plan Phases 1–7 remove them later).
- **Color / z-index / motion from tokens only.** Glass = `bg-surface-card/80 backdrop-blur-md` + `border-border-soft` (alpha modifiers work via the theme's `color-mix` `themed()` helper); chips = the 3-layer `CHIP_TONE_CLASSES` families already in `AiQuickJumpResults`; z-index via `AnchoredLayer`'s named-scale `level` (default `dropdown`=50, applied inline); motion routed through `useMotionPresence`/`useMotionTransition` so reduced-motion is automatic. **No hex, no `z-[NNN]`.**
- **Station untouched.** Mobile `/m/*` scan flows and any focus-locked scan bar are exempt (Station archetype, D6). This is desktop Workbench/Monitor only.
- **Flag-gated + non-destructive.** All new behavior rides `NEXT_PUBLIC_UNIFIED_HEADER_SEARCH` (`isUnifiedHeaderSearchEnabled()`). Off = today's header + today's operations history, byte-identical. Legacy recents buckets stay until consolidation-plan Phase 6.

---

## 3. Design intelligence — `/ui-ux-pro-max` rules applied

The skill's priority ladder, mapped to concrete decisions in this plan. These are acceptance criteria, not aspirations.

### 3.1 Accessibility (CRITICAL) → the combobox contract
- `keyboard-nav` / *Search·Keyboard Navigation* ("tab order matches visual order; full keyboard support"): the dropdown is a **WAI-ARIA combobox** (§6.3). ↓/↑ move a virtual `activeIndex` via `aria-activedescendant` (focus never leaves the input), Enter navigates, Esc collapses. Every row is a real `<Link>` so Tab/Enter/middle-click/new-tab all work.
- `aria-labels`: the status dot pairs with a `HoverTooltip` label (dot alone is color-only otherwise → violates `color-not-only`); the recents remove button already has `aria-label="Remove recent search "…""`.
- `color-contrast` (4.5:1): chip text tones (`text-blue-700` on `bg-blue-50`, etc.) and `text-text-muted`/`text-text-soft` metas all clear AA on `surface-card` in light and dark (theme-registry values); glass container keeps `bg-surface-card/80` (not lower) so text contrast is preserved over any page.
- `reduced-motion`: every animated surface consumes presets through `useMotionPresence`/`useMotionTransition`, which collapse transforms to a pure opacity fade under `prefers-reduced-motion`.
- `focus-states`: the input keeps a visible focus ring; keyboard-highlighted rows use `bg-blue-50 ring-1 ring-inset ring-blue-400` (the repo-wide selection idiom).

### 3.2 Touch & Interaction (CRITICAL) → feedback + click affordance
- *Search·Autocomplete* ("show predictions as user types," "Debounced fetch + dropdown," don't "require full type and enter"): the preview is live at ≥2 chars via `useAiQuickJump` (250 ms debounce, abort-on-retype). Enter is a shortcut to the full `/search`, not a requirement.
- `loading-buttons` / `progressive-loading`: >300 ms loads show **skeleton rows** (rail-shaped pulse), never a blocking spinner over content; the `SearchField` trailing slot already shows a spinner/pending dot.
- `cursor-pointer` / `hover-vs-tap`: rows are links (pointer cursor, real navigation), not hover-only reveals; the chevron is a hover *affordance*, not the control.

### 3.3 Performance (HIGH)
- `debounce-throttle`: one query-embedding call per keystroke *max* (250 ms debounce + 2-char gate + abort). Hybrid-always / LLM-never-inline is a locked decision — no LLM on the keystroke path.
- `content-jumping` (CLS): the dropdown is a portaled fixed layer (`AnchoredLayer`), so it never reflows the header; skeleton rows reserve the preview's height so results don't jump in.
- `virtualize-lists`: not needed — preview caps at ~8 rows, `/search` at 50, operations at 50. No 50+-row list is unbounded.

### 3.4 Style / Layout / Typography / Animation / Forms / Navigation
- Style `consistency` + `no-emoji-icons`: icons from `@/components/Icons`, one family; glass = `surface-card/80 backdrop-blur-md` (house style, not the generic skill palette).
- Layout `visual-hierarchy` + house "one row anatomy": title → meta eyebrow → chips(right); selection = background+ring only, **never a size shift**.
- Typography: `text-caption font-bold` title, `text-eyebrow font-semibold uppercase tracking-widest` meta — the existing `AiQuickJumpResults` scale, unchanged.
- Animation `duration-timing` (150–300 ms) + `transform-performance` (opacity/transform only): dropdown open `framerTransition.dropdownOpen` (0.18 s, `easeOut`); crossfade the operations right pane at `framerTransition.workbenchPaneMount` (0.18 s). Group reveal staggers **only on first open**, never per keystroke (`fade-crossfade` — content replacement in the same container).
- Forms `empty-states` + *Search·No Results* ("show 'No results' with suggestions," never a blank screen): typed empty/first-use/no-results/error states with a partial-serial/last-8-tracking teaching hint.
- Navigation `search-accessible` + `deep-linking` + `state-preservation`: one reachable header search; every view URL-addressable (`?q=`, `?type=`, `?order=`); reload/back restores the exact view.

---

## 4. Component inventory

### 4.1 Reuse as-is (shipped)
| Module | Role here |
|---|---|
| `POST /api/ai/retrieve` + `hybridSearch` (`src/lib/search/hybrid-retrieval.ts`) | The only retrieval path. `entityTypes` is a HARD filter; when set, the exact-identifier bypass is skipped (so scoped searches always hit the doc arm → facets present). |
| `src/lib/search/search-hit.ts` | `SearchHit` shape, `searchHitHref`, `searchScopeHref/Label`, `facetChips`, `looksLikeIdentifier`, DB↔UI entity maps. |
| `src/lib/search/ai-search-client.ts` | `postAiRetrieve(query, opts)`, `fetchAiSearchEnabled()` (per-session memoized probe), `AiSearchHit` wire type. Re-throws `AbortError`, returns `null` on other errors. |
| `src/hooks/useAiQuickJump.ts` | 250 ms-debounced, aborted, 2-char-gated retrieval → `{ aiEnabled, hits, searching }`. Header preview + operations preview both use it. |
| `src/lib/search/search-recents.ts` **(shipped)** | Unified recents SoT: `pushSearchRecent`, `listSearchRecents`, `removeSearchRecent`, `clearSearchRecents`, `recentRerunHref`, `formatRelativeTime`, `groupRecentsByDay`, `migrateLegacyRecents`. |
| `src/hooks/useSearchRecents.ts` **(shipped)** | React binding: `{ recents, push, remove, clear, refresh }`; cross-tab + in-tab sync; `migrateLegacy` gated on the flag. |
| `src/components/search/SearchRecentsDropdown.tsx` **(shipped)** | Presentational recents section (header + rows + clear). Rows are `<Link href={recentRerunHref(entry)}>`. |
| `src/lib/search/unified-header-search.ts` **(shipped)** | `isUnifiedHeaderSearchEnabled()` (client-safe flag). |
| `src/lib/search/search-scope-labels.ts` **(shipped)** | `resolveSearchScopeLabel(scope)` — never inline a scope label. |
| `usePageHeaderSearch` (`src/hooks/usePageHeader.ts`) + `HeaderContext` | Contextual header wiring: register `HeaderSearchControl`, auto-clears on unmount. |
| `useOperationsTimelineUrlState` (`…/operations/useOperationsTimelineUrlState.ts`) | `dim/setDim/entityValue/setEntity/focused/filters/clearFilters` — needs a `q/setQ` addition (Phase D). |
| `EventTimeline` / `TimelineSection` | The record-journey drill detail (unchanged). |
| `AnchoredLayer` (`src/design-system/primitives/AnchoredLayer.tsx`) + `Popover` | Portaled dropdown host; `level` names the z-index band. `Popover` is the canonical glass wrapper (`framerPresence.dropdownPanel`). |

### 4.2 New
| Module | Role |
|---|---|
| `src/components/search/SearchResultRow.tsx` | **The one rich row renderer.** Variant per entity: `order` = status dot · title · order#/sku/platform meta · status+condition+platform chips · relative date; `generic` = today's `AiQuickJumpResults` row (icon · title · subtitle · ≤2 chips · type tag · chevron). Row is `<Link>`; keyboard-active = `bg-blue-50 ring-1 ring-inset ring-blue-400`, no size shift. |
| `src/components/search/search-result-chips.ts` | Extracted `CHIP_TONE_CLASSES` (from `AiQuickJumpResults`) + `orderStatusTone(status)` order-status→tone SoT (§5.4). One import for every renderer. |
| `src/components/search/GlobalSearchDropdown.tsx` | Extracted header dropdown body (recents ⇄ preview ⇄ footer states) — testable, keyboard-navigable combobox. |
| `src/components/search/SearchResultsSurface.tsx` | Extracted from `SearchWorkspace` — the shared results body: facet tabs, grouped Overview, scoped list, typed states. Props drive scope + row-click behavior. |
| `src/components/search/search-tabs.ts` | Promoted `CATEGORY_TABS` + `TabId` + `CATEGORY_LABELS` + `orderedTabsForScope(scope)` (orders-first for operations). |
| `src/components/operations/OperationsResultsView.tsx` | Operations-history results region: mounts `<SearchResultsSurface scope="operations">`, intercepts row-click → `url.setEntity()` drill. |

### 4.3 Modify
| Module | Change |
|---|---|
| `src/components/layout/GlobalHeaderSearch.tsx` | Swap the two inline dropdown branches for `<GlobalSearchDropdown>`; add combobox keyboard nav + aria; keep the shipped flag-gated recents wiring. |
| `src/components/search/AiQuickJumpResults.tsx` | Becomes a thin `map` over `<SearchResultRow variant="generic">` (byte-identical output verified). |
| `src/components/search/SearchWorkspace.tsx` | Becomes a thin wrapper over `<SearchResultsSurface scope="global">` (dedupe the results body); imports tabs from `search-tabs.ts`. |
| `src/features/operations/workspace/OperationsHistoryView.tsx` | Add the results region: render `<OperationsResultsView>` when `!focused && q`, timeline when `focused`; crossfade the right pane on `focused` change. |
| `…/operations/useOperationsTimelineUrlState.ts` | Expose `q` + `setQ(next)` (writes `?q=`, clears entity focus). |
| `src/components/sidebar/OperationsSidebarPanel.tsx` → `HistorySidebar` | Remove `SidebarShell.search`; register `usePageHeaderSearch` (drives `?q=`); render `SearchRecentsDropdown` (scope `operations:history`); keep the dimension toggle. |
| (Phase E) `src/lib/search/build-search-text.ts` + a migration + `hybrid-retrieval.ts` select list | Optional: surface `tracking_number` + `carrier` on the ORDER doc facets for a Shopify-grade row. |

### 4.4 Untouched (explicitly)
All other sidebar search bars; `hybridSearch` internals; the `CommandBar` ⌘K contract; the `/api/ai/retrieve` route; mobile `/m/*` scan flows; the recents store SoT.

---

## 5. The rich result row (`SearchResultRow`) — the load-bearing new component

One component, variant-switched by `entityType`. Orders get the richest treatment (the deliverable focus); every other entity uses the clean generic row that already ships in `AiQuickJumpResults`.

### 5.1 Props

```ts
// src/components/search/SearchResultRow.tsx
export interface SearchResultRowProps {
  hit: AiSearchHit;                 // client wire shape (ai-search-client.ts)
  active?: boolean;                 // keyboard-highlighted (combobox activedescendant)
  optionId?: string;               // stable id for role="option" / aria-activedescendant
  onNavigate?: (hit: AiSearchHit) => void;   // record recent + optional intercept
  density?: 'preview' | 'full';     // preview trims meta; full = /search + operations
}
```

The variant is chosen internally: `hit.entityType === 'order'` → order variant; else generic. No caller passes a variant flag (SoT: the renderer owns the mapping).

### 5.2 Order variant — fields available today

From `buildOrderDoc` (`build-search-text.ts`) → `docRowToHit` (`hybrid-retrieval.ts`), an ORDER `AiSearchHit` carries:

| Slot | Source | Example |
|---|---|---|
| Status dot | `facets.status` → `orderStatusTone()` (§5.4) | ● blue = shipped |
| Title | `hit.title` (`product_title`, fallback `Order #<id>`) | "Galaxy S21 128GB" |
| Meta (eyebrow) | `hit.subtitle` (`order_id · serials · sku · account_source`) | "#1234 · SN…91 · SKU-77 · eBay" |
| Chips (right) | `hit.chips` = `facetChips({status, conditionGrade, sourcePlatform})` | `shipped` `Grade B` `eBay` |
| Date | `facets.happened_at` → `formatRelativeTime` | "2d" |
| Href | `searchHitHref('ORDER', id)` → `/dashboard?openOrderId=` | click → drill |

That is already a strong Shopify-grade row. **Two known gaps:** (a) tracking # + carrier are in `searchText` but not on the row → §11 Phase E enrich; (b) **exact-identifier hits carry no facets** (`exactResultToHit` sets `chips: []`, no `facets`) — so in the *global* preview an exact id renders the *generic* row. In **operations** scope (`entityTypes:['ORDER']`) the exact bypass is skipped, so operations rows always have facets → always render the rich order variant. State this in the row's doc comment so no one "fixes" the missing dot on an exact global hit.

### 5.3 Order row anatomy (house one-row rule)

```
● <title, truncate, text-caption font-bold>          <chips right>   <2d>
  <meta eyebrow: #1234 · SKU-77 · eBay, uppercase tracking-widest>
```

- Container: `<Link href={hit.href}>` with `group flex items-center gap-3 px-3 py-1.5 text-left hover:bg-surface-hover` (matches `AiQuickJumpResults`).
- Keyboard-active (`active`): add `bg-blue-50 ring-1 ring-inset ring-blue-400` — **no height change** (`no size shift` house rule; `state-clarity` skill rule).
- Status dot: `<HoverTooltip label={statusLabel} focusable={false}><span className={cn('h-2 w-2 shrink-0 rounded-full', orderStatusTone(status).dot)} /></HoverTooltip>` — pairs the dot with a label (`color-not-only`).
- Chips: `hit.chips.slice(0, 3)` through `CHIP_TONE_CLASSES` (order rows show up to 3; generic shows 2). `hidden md:inline-flex` so narrow widths don't wrap.
- Date: `formatRelativeTime(facets.happened_at)` in `text-eyebrow text-text-faint tabular-nums` (`number-tabular` — no layout shift as "2d"→"12d").
- No chevron on the order variant (the whole row is the target; chevron is generic-variant chrome).

### 5.4 `orderStatusTone` — the order-status dot/chip SoT (correction)

The search doc carries only the raw `orders.status` string. `workflowStageDot` is the **wrong** vocabulary (it knows `EXPECTED…DONE`, so every order status returns the neutral `bg-border-emphasis`), and `deriveOutboundState` needs pack/ship/carrier signals that are **not** on the search doc. So introduce one tiny SoT and use it for *both* the dot and the status chip so they can never disagree:

```ts
// src/components/search/search-result-chips.ts
type Tone = 'gray' | 'blue' | 'emerald' | 'amber' | 'rose';
const ORDER_STATUS_TONE: Record<string, Tone> = {
  delivered: 'emerald', shipped: 'blue', packed: 'blue', listed: 'gray',
  pending: 'amber', awaiting: 'amber', cancelled: 'rose', refunded: 'rose',
};
export function orderStatusTone(status: string | null | undefined): { tone: Tone; dot: string } {
  const key = String(status ?? '').trim().toLowerCase();
  const tone = ORDER_STATUS_TONE[key] ?? 'gray';
  return { tone, dot: DOT_BY_TONE[tone] }; // DOT_BY_TONE: blue→bg-blue-500, emerald→bg-emerald-500, …
}
```

Confirm the exact raw `orders.status` vocabulary against the loader (`search-outbox-worker.ts:88 FROM orders o` / `global-entity-search.ts:46`) before finalizing the map; unknown → `gray`. If a lifecycle-accurate dot is later wanted, enrich the doc with the derived `OutboundState` in Phase E and switch the map input — the row API doesn't change. **Do not** thread `deriveOutboundState` into the row (it would need signals the doc lacks).

### 5.5 Generic variant (units, receiving, sku, repair, fba)

Exactly today's `AiQuickJumpResults` row, moved verbatim into `SearchResultRow`'s generic branch: entity icon (`ENTITY_ICONS`) · title (`text-caption font-bold`) · subtitle (`text-eyebrow uppercase tracking-widest text-text-soft`) · ≤2 chips (`CHIP_TONE_CLASSES`, `hidden md:inline-flex`) · lowercase entity-type tag (`bg-surface-sunken`) · hover chevron. `AiQuickJumpResults` then becomes:

```tsx
<ul className="divide-y divide-border-hairline">
  {hits.map((hit) => (
    <li key={`${hit.entityType}:${hit.id}`}>
      <SearchResultRow hit={hit} onNavigate={onNavigate} density="full" />
    </li>
  ))}
</ul>
```

So there is exactly **one** renderer and the existing `[&>p]:hidden` host-className trick still hides the eyebrow.

---

## 6. The header search DISPLAY (deliverable #1)

A combobox pattern (WAI-ARIA), three dropdown states, glass container. Global mode only — contextual mode (operations) shows **no** dropdown (results live in the page pane; recents live in the page sidebar).

### 6.1 Anatomy

```
Header pill (inside GlobalHeaderActions' 420px rail, search capped max-w-[17.5rem]):
  ┌──────────────────────────────────────────────┐
  │ 🔍  Search orders, serials, cartons…      ⌘K │   ← ⌘K kbd only when !focused && empty
  └──────────────────────────────────────────────┘

Dropdown (AnchoredLayer level="dropdown", matchWidth, glass, portaled fixed z=50):
┌──────────────────────────────────────────────┐
│  STATE A — empty + focused (recents exist)    │
│  ⏱ Recent searches                    Clear   │
│   🔍 PO-44102        Everywhere · 2h       →  │
│   🔍 X1D-C900        Inventory · SKUs · 1d →  │
│  ───────────────────────────────────────────  │
│  ⧉ View all recent searches →   (→ /search/history)
├──────────────────────────────────────────────┤
│  STATE B — typing (≥2 chars, has hits)        │
│  → See all results for "samsung"  (→ /search) │
│  ORDERS                                        │
│   ● Galaxy S21 · #1234 · eBay      2d shipped │
│   ● Galaxy S22 · #1240 · eBay     5d delivered│
│  UNITS                                         │
│   ▣ SN…8891 · Galaxy S21 · tested             │
│  … grouped, ≤2 per group, ≤8 total            │
├──────────────────────────────────────────────┤
│  STATE C — loading  → 3 skeleton rows         │
│  STATE — no results → teaching line + tips    │
└──────────────────────────────────────────────┘
```

### 6.2 State machine (verified against current derived booleans)

| State | Condition (current variable names) | Body |
|---|---|---|
| **A — Recents** | `unifiedOn && isGlobal && focused && trimmed.length === 0 && recents.length > 0` (`showRecents`) | `SearchRecentsDropdown` + footer link → `/search/history` |
| **First-use** | same but `recents.length === 0` | quiet hint line: "Search orders, serials, cartons, SKUs…" (no empty box) |
| **B — Preview** | `isGlobal && focused && trimmed.length >= 2` (`showPreview`) with hits | "See all results for …" row + grouped `SearchResultRow`s (≤2/group, ≤8 total) |
| **C — Loading** | `showPreview && previewSearching` | 3 skeleton rows (rail-shaped pulse) |
| **Empty** | `showPreview && !previewSearching && previewHits.length === 0` | "No matches for '…' — try a partial serial or the last 8 of a tracking #" |
| **Contextual** | `contextualSearch != null` (`isGlobal === false`) | **no dropdown** — plain scoped filter input; results render in the page pane, recents in the page sidebar |

`previewHits`/`previewSearching` already switch on `aiQuickJump.aiEnabled` (AI preview vs the `/api/global-search` classic fallback). `GlobalSearchDropdown` receives the resolved arrays; it does not know which engine produced them.

### 6.3 Keyboard (WAI-ARIA combobox — `keyboard-nav`, `search-accessible`)

- Input: `role="combobox"`, `aria-expanded={dropdownOpen}`, `aria-controls={listboxId}`, `aria-activedescendant={activeOptionId}`, `aria-autocomplete="list"`.
- Dropdown: `role="listbox" id={listboxId}`; each row `role="option" id={optionId} aria-selected={active}`.
- **↓/↑** move `activeIndex` across the *flattened* visible rows (recents in State A, preview rows in State B); wraps at the ends. **Enter** on a highlighted row → navigate it (records nothing extra — the record open is the intent). **Enter** with no highlight → push `{query, scope:'global', scopeLabel:'Everywhere'}` recent + `router.push('/search?q=…')`. **Esc** → clear query if non-empty else blur (already implemented on the input). **⌘K** → `dispatchGlobalSearchFocus()` (already wired via `GLOBAL_SEARCH_FOCUS_EVENT` + `CommandBar`).
- `aria-activedescendant` moves the *virtual* highlight so a screen reader announces the active option without DOM focus leaving the input (the reason a combobox beats roving `tabindex` here).
- Group headers (`ORDERS`, `UNITS`) are `role="presentation"` and are **skipped** by ↓/↑ (only options are focusable in the virtual list).

### 6.4 Glass + motion spec

- Container (upgrade from today's solid `bg-surface-card`): `rounded-xl border border-border-soft bg-surface-card/80 backdrop-blur-md shadow-xl` — mirrors the header bar's own `bg-surface-card/90 backdrop-blur-md`; alpha works via the `themed()` `color-mix`. Keep `/80` (not lower) so text stays ≥4.5:1 over any page (`color-contrast`).
- Open/close: `useMotionPresence(framerPresence.dropdownPanel)` (`initial {opacity:0,y:-4} → animate {y:0} → exit {opacity:0,y:-6}`) + `useMotionTransition(framerTransition.dropdownOpen)` (0.18 s `easeOut`), inside `<AnimatePresence>` with the conditional *inside* it (so exit plays). This is exactly the `Popover.tsx` recipe.
- Row hover: `hover:bg-surface-hover`; keyboard-active adds ring — **never a size shift**.
- Group reveal: optional 0.03 s stagger via a reduced-motion-aware container variant, applied **only on first open**, not on every re-query (`fade-crossfade`; a per-keystroke stagger is a Monitor-list anti-pattern → flicker).
- `⌘K` affordance: the existing inline `<kbd>` (shown via `trailingPrefix` only when `!focused && !trimmedQuery`) is untouched.

---

## 7. `<SearchResultsSurface>` — the shared results body (deliverable spine)

Extract the body of `SearchWorkspace` so `/search` and `/operations?mode=history` render identically.

```ts
// src/components/search/SearchResultsSurface.tsx
export interface SearchResultsSurfaceProps {
  query: string;                       // the page owns ?q=; surface is controlled
  scope: 'global' | 'operations';      // drives default tab order + pageContext
  activeTab: TabId;                    // from ?type= (search-tabs.ts)
  onTabChange: (t: TabId) => void;
  onSelectHit?: (hit: AiSearchHit) => void; // operations intercepts → drill to timeline
  className?: string;
}
```

- **Tab source:** `search-tabs.ts` exports `CATEGORY_TABS` (Overview · Orders · Units · Receiving · SKUs · Repairs · FBA), `TabId`, and `orderedTabsForScope(scope)`. For `scope='operations'` the order is **`Orders* · Units · Receiving · SKU · Repair · FBA`** (Overview still last-resort available) and the default active tab is `order`; the default request `entityTypes: ['ORDER']`.
- **Fetch:** one `POST /api/ai/retrieve` per `(query, activeTab)` — the exact existing `SearchWorkspace` effect (`limit: 50`, `pageContext` = `/search` or `/operations`, `entityTypes` = the tab's DB type or `undefined` for Overview), keyed on `${query}::${tab}`, aborting the prior request. `403 → 'forbidden'`, non-OK → `'error'` (skips `AbortError`).
- **States (reused verbatim):** first-use empty ("Search everything, from anywhere"), loading (`Loader2` + "Searching…"), forbidden (rose card — grant `ai.search`), error (rose card — "Search failed"), no-matches (the tracking-number hint). Overview groups by `entityType` in `CATEGORY_TABS` order; scoped tab lists up to 50.
- **Row-click injection:** `/search` lets each `SearchResultRow`'s `<Link>` navigate. Operations passes `onSelectHit`; `SearchResultRow.onNavigate` calls `onSelectHit?.(hit)` (which `preventDefault`s the link and drills) — otherwise the link navigates normally.

`SearchWorkspace` shrinks to: read `?q=`/`?type=`, own its own `SearchField` (the `/search` page has a visible field; operations does not), render `<SearchResultsSurface scope="global">`.

---

## 8. Operations `/operations?mode=history` refactor (deliverable #2)

### 8.1 The two-region flow (adds a browse query to the existing focus model)

```
        header search (contextual) → url.setQ(v)  writes ?q=
                                │
             ?q= present, !focused │            row click → url.setEntity(orderId)
                                ▼            writes ?order=/?serial=/?tracking=
      ┌─ RESULTS REGION ────────────┐   ─────────────▶  ┌─ DRILL REGION ─────────┐
      │ <OperationsResultsView>      │                   │ record-journey          │
      │  <SearchResultsSurface       │   ◀── "Clear" ─── │ TimelineSection over    │
      │    scope="operations"        │  url.setEntity('')│ /api/operations/journey │
      │    orders-first rows>        │  (keeps ?q=)      │ (today's view, kept)    │
      └──────────────────────────────┘                   └─────────────────────────┘
```

**Render rule (in `OperationsHistoryView`):**
- `focused` (i.e. `url.entityValue` non-empty) → the existing timeline (unchanged).
- `!focused && url.q` → `<OperationsResultsView query={url.q} />` (new results region).
- `!focused && !url.q` → the empty state, reworded: "Search shipped orders, serials, or tracking above" + a recent-search hint (was "Paste a record number…").

Focus wins over browse, so pasting an exact id and clicking a row both land on the timeline; clearing returns to the `?q=` list.

### 8.2 URL-state hook change — add a browse query (correction)

`useOperationsTimelineUrlState` already reads `?q=` into `filters.q` but exposes no setter. Add exactly two members, matching the existing `replaceParams` pattern (which force-sets `mode=history`, deletes `cursor`, `router.replace(..., {scroll:false})`):

```ts
// return additions
q: string;                                    // = searchParams.get('q') ?? ''  (already read)
setQ: (next: string) => void;                 // NEW
// impl
const setQ = (next: string) => replaceParams((p) => {
  const v = next.trim();
  if (v) p.set('q', v); else p.delete('q');
  // browsing resets any focused entity so the two views are mutually exclusive
  p.delete('order'); p.delete('serial'); p.delete('tracking');
});
```

`setEntity` already deletes the other dimensions and does **not** touch `?q=`, so a row-click preserves `?q=` and "Clear" (`setEntity('')`) returns to the list. `q` is already in `OPERATIONS_MODE_SCOPED_PARAMS`, so switching modes clears the browse query correctly.

### 8.3 Contextual header wiring (`HistorySidebar` registers it)

```ts
// inside HistorySidebar (mounts only under mode==='history' → auto-clears on unmount)
usePageHeaderSearch(
  {
    value: url.q,
    onChange: (v) => url.setQ(v),                       // type → browse
    onSearch: (v) => {                                  // Enter
      const t = v.trim();
      if (!t) return;
      if (looksLikeIdentifier(t)) { url.setEntity(t); return; } // fast path: exact id → instant drill under current dim
      if (unifiedOn) pushSearchRecent({
        query: t, scope: 'operations:history',
        scopeLabel: 'Operations · History',
        scopeHref: `/operations?mode=history&q=${encodeURIComponent(t)}`,
      });
      url.setQ(t);
    },
    onClear: () => url.setQ(''),
    placeholder: 'Search shipped orders, serials, tracking…',
    debounceMs: 300,
    isSearching: /* results-surface loading, lifted or via a shared signal */ false,
  },
  [url.q, url.dim],
);
```

- **Fast path preserved:** `looksLikeIdentifier(t)` (from `search-hit.ts`) → `setEntity` jumps straight to the timeline under the current `dim` (dimension toggle still chooses order/serial/tracking). Typing a fuzzy term browses. This keeps today's "paste a number → jump" muscle memory while adding browse.
- The header pill is in contextual mode here → **no dropdown**. Recents show in the sidebar (below).

### 8.4 Sidebar (`HistorySidebar`) changes

- **Remove** `SidebarShell.search` (the object at panel L453-459). With `search` omitted, the shell renders `headerAbove`/`headerRows`/`children`/`footer` unchanged.
- **Keep** the dimension toggle (`SidebarNavOverlaySlider` over `JOURNEY_DIMENSION_ITEMS`, driven by `url.dim`/`url.setDim`) — it scopes the Enter fast-path and lets a user paste an exact number.
- **Add** a recents block in the sidebar body (not `SidebarSearchBar` — guard): `<SearchRecentsDropdown recents={recents} onSelect={(e) => url.setQ(e.query)} onRemove={remove} onClearAll={() => clear('operations:history')} />` from `useSearchRecents({ scope: 'operations:history' })`. Selecting a recent sets `?q=` and re-runs. This is the "recently searched" the user asked for.

### 8.5 Right-pane crossfade

Crossfade the right pane on `focused` change via `useMotionPresence(framerPresence.workbenchPane)` + `useMotionTransition(framerTransition.workbenchPaneMount)`, `<AnimatePresence mode="wait">` keyed on `` `${focused}:${url.entityValue}` ``. The **sidebar and results list stay mounted and still** — only the right pane (results ⇄ timeline) transitions (`contextual-display.md` Workbench/Monitor rule). Never crossfade the list.

### 8.6 Recents recording & cross-surface re-run

`recentRerunHref` prefers `scopeHref`, so a `operations:history` recent stored with `scopeHref: /operations?mode=history&q=…` re-runs *back into operations* from `/search/history` — cross-surface recents "just work." Global header Enter still records `scope:'global'` → `/search?q=`.

---

## 9. Recents integration (already-built store, no new storage)

- **Scopes in play:** `global` (header Enter → `/search`), `operations:history` (operations browse), plus legacy-migrated `dashboard` / `shipped` / `inventory:*` (seeded once, non-destructively, gated on the flag).
- **Three render points, one store:** header dropdown (State A), operations sidebar (`SearchRecentsDropdown` scoped to `operations:history`), `/search/history` (full archive, day-grouped via `groupRecentsByDay`).
- **No changes to `search-recents.ts`.** Everything goes through `pushSearchRecent` / `useSearchRecents`; labels via `resolveSearchScopeLabel` (never inline). Legacy buckets untouched until consolidation-plan Phase 6.

---

## 10. Accessibility & performance (acceptance-level)

**A11y** (`ui-ux-pro-max` §1): combobox/listbox roles + `aria-activedescendant` (§6.3); every row a real `<Link>`; chips carry text (never color-only); status dot paired with `HoverTooltip` (`focusable={false}` because it sits inside the row link); reduced-motion honored everywhere via the hooks; forbidden/error states are readable, not silent. Contrast: chip tones + metas ≥4.5:1 on `surface-card/80` in both themes (verify dark independently — `color-dark-mode`).

**Perf** (`ui-ux-pro-max` §3): header preview = 250 ms debounce + abort-on-retype + 2-char gate (`useAiQuickJump`); one query-embedding call per keystroke *max* (hybrid-always, LLM-never-inline). The `fetchAiSearchEnabled` probe is memoized per session. Operations results = one fetch per `(q, tab)`, aborted on change. No per-row fetch, no N+1. The dropdown is portaled (`AnchoredLayer`, `position:fixed`) → zero header CLS; skeleton rows reserve preview height.

---

## 11. Phased rollout (all behind `NEXT_PUBLIC_UNIFIED_HEADER_SEARCH`)

> Phase 0 (unified recents + `/search/history`) is **already shipped**. This plan is Phases A–E. Each phase is independently reviewable, flag-gated, and non-destructive. Ship A→B→C→D in order; E is optional and last.

---

### Phase A — One row renderer (`SearchResultRow`)

**Objective.** Collapse row rendering to a single component and add the order variant with a status dot, without changing any existing output.

**Preconditions.** None (pure refactor + additive order variant).

**Steps.**
1. **Create `src/components/search/search-result-chips.ts`.** Move `CHIP_TONE_CLASSES` verbatim out of `AiQuickJumpResults.tsx` (`gray/blue/emerald/amber/rose` → the 3-layer classes). Add `orderStatusTone(status)` + `DOT_BY_TONE` (§5.4). Confirm the raw `orders.status` vocabulary against `search-outbox-worker.ts:88` / `global-entity-search.ts:46` and finalize `ORDER_STATUS_TONE` (unknown → `gray`). Export `ENTITY_ICONS` here too (moved from `AiQuickJumpResults`).
2. **Create `src/components/search/SearchResultRow.tsx`** with the props in §5.1. Internal branch on `hit.entityType === 'order'`:
   - **Generic branch:** paste today's `AiQuickJumpResults` `<Link>` row *verbatim* (icon · title · subtitle · `hit.chips?.slice(0,2)` · type tag · hover chevron). Same class strings.
   - **Order branch:** status dot (`HoverTooltip` + `orderStatusTone(facets.status).dot`) · title · subtitle meta · `hit.chips?.slice(0,3)` · `formatRelativeTime(facets.happened_at)` (tabular) · no type tag, no chevron.
   - Add `active` ring (`bg-blue-50 ring-1 ring-inset ring-blue-400`) and `role="option"`/`id={optionId}`/`aria-selected` passthrough (used by Phase B; harmless elsewhere).
   - `onClick` → `onNavigate?.(hit)`; if `onNavigate` calls `preventDefault` on the event the link is intercepted (operations drill), else it navigates.
3. **Refactor `AiQuickJumpResults.tsx`** to `map` over `<SearchResultRow density="full" />` (§5.5). Keep the eyebrow `<p>` header and the `[&>p]:hidden` host trick; keep the `hits.length===0 && !searching` early return.
4. **Doc comment** on `SearchResultRow`: exact-identifier global hits carry no facets → render generic; operations (scoped) always carries facets → order variant. Don't "fix" a missing dot on an exact global hit.

**Design rules applied.** House one-row anatomy; `state-clarity` (active ring, no size shift); `color-not-only` (dot + tooltip); `number-tabular` (relative date); `no-emoji-icons` (Icons only).

**Acceptance.**
- `/search`, ⌘K preview, and every sidebar quick-jump render through the one row; **no visual diff** on generic entities (snapshot).
- An ORDER hit with `facets.status='shipped'` shows a blue dot + `shipped` chip; `delivered` → emerald; an unknown status → gray dot (not a crash, not the receiving "unknown" grey).
- Flag state is irrelevant to Phase A (it ships to everyone; it's output-identical for generic rows and only *adds* the dot for order rows, which today appear via `AiQuickJumpResults` in Overview/scoped lists).

**Tests.** `SearchResultRow.test.tsx`: order variant field mapping (facets→dot tone, chips, tabular date), generic variant parity with the old markup; `orderStatusTone` unit table (each known status + unknown→gray). Snapshot `AiQuickJumpResults` before/after to prove byte-identical generic output.

**Rollback.** Revert the three files; `CHIP_TONE_CLASSES` returns inline. No data, no flag, no migration.

**Est. diff.** ~1 new file (~180 LOC), 1 new small file (~40 LOC), `AiQuickJumpResults` shrinks ~60 LOC. Net small.

---

### Phase B — Best-in-class header dropdown (`GlobalSearchDropdown`)

**Objective.** Replace the two inline dropdown branches in `GlobalHeaderSearch` with one testable, keyboard-navigable combobox; add glass + reduced-motion; keep the shipped recents wiring.

**Preconditions.** Phase A (uses `SearchResultRow` for the preview list).

**Steps.**
1. **Extract `src/components/search/GlobalSearchDropdown.tsx`.** Props:
   ```ts
   interface GlobalSearchDropdownProps {
     open: boolean; anchorRef: RefObject<HTMLElement | null>;
     query: string;
     state: 'recents' | 'preview' | 'loading' | 'empty' | 'first-use';
     recents: SearchRecentEntry[];
     previewHits: AiSearchHit[];
     activeIndex: number;                 // -1 = none highlighted
     onActiveIndexChange: (i: number) => void;
     onClose: () => void;
     onSelectRecent: (e: SearchRecentEntry) => void;
     onRemoveRecent: (id: string) => void;
     onClearRecents: () => void;
     listboxId: string;
   }
   ```
   Render inside `AnchoredLayer` (`level="dropdown"`, `matchWidth`, `placement="bottom-stretch"`) → a `motion.div` with the glass classes (§6.4) + `useMotionPresence(framerPresence.dropdownPanel)` / `useMotionTransition(framerTransition.dropdownOpen)`. Body by `state`:
   - `recents` → `<SearchRecentsDropdown>` (already keyboard-highlightable via the flattened index) + footer link → `/search/history`.
   - `first-use` → one quiet hint line (no dashed box — the header is not a page).
   - `preview` → "See all results for '{query}' →" row (index 0 of the virtual list) + grouped `SearchResultRow`s (`orderedTabsForScope('global')` grouping, ≤2/group, ≤8 total), each with its `optionId`/`active`.
   - `loading` → 3 skeleton rows (rail-shaped `animate-pulse` bars at row height).
   - `empty` → teaching line + tips (partial serial / last-8 tracking).
2. **Combobox controller in `GlobalHeaderSearch`.** Compute the flattened option list (recents *or* [see-all, ...preview rows]); own `activeIndex`; add `onKeyDown` to the input for ↓/↑ (move+wrap, `role=presentation` group headers skipped), Enter (navigate active OR push recent + `/search?q=`), Esc (existing). Set `role="combobox"`, `aria-expanded`, `aria-controls={listboxId}`, `aria-activedescendant`, `aria-autocomplete="list"`. Reset `activeIndex=-1` on query change and on open.
3. **Glass upgrade.** Change the dropdown surface from `bg-surface-card` to `bg-surface-card/80 backdrop-blur-md` (keep `rounded-xl border-border-soft shadow-xl`).
4. **Keep** the existing flag gating (`unifiedOn`), `useSearchRecents({ migrateLegacy: unifiedOn, limit: 6 })`, and the classic `/api/global-search` fallback when `!aiEnabled`. Unify the recents `onSelect` path to go through `handleChange` (the audit flagged it currently calls `setGlobalQuery` directly — fine today, but unify while here).

**Design rules applied.** `keyboard-nav`, `search-accessible`, `aria-labels`, `focus-states` (§3.1); `Autocomplete` predictions + `progressive-loading` skeleton (§3.2); `duration-timing`/`transform-performance`/`reduced-motion` (§3.4); glass `blur-purpose` (indicates an overlay, not decoration) and `color-contrast` (`/80` floor).

**Acceptance (flag ON).**
- Focus empty → recents (State A); type ≥2 → grouped rich preview (State B); loading → skeletons; 0 hits → teaching line.
- ↓/↑ highlight-and-wrap across the virtual list (group headers skipped); Enter on a highlight opens that record; Enter with no highlight → `/search?q=` and records a `global` recent; Esc clears then blurs; ⌘K focuses.
- Screen reader announces the active option (via `aria-activedescendant`) without losing the input caret.
- **Flag OFF → byte-identical to today** (no glass, no combobox roles, no recents) — verify.

**Tests.** `GlobalSearchDropdown.test.tsx`: empty/recents, typing/preview grouping (≤2/group, ≤8), loading skeleton, no-results copy, keyboard nav (index math + wrap + header-skip), Enter/Esc branches, `aria-*` attributes present. Manual: reduced-motion collapses open to a pure fade.

**Rollback.** Revert `GlobalHeaderSearch` to the inline branches; delete `GlobalSearchDropdown`. Flag already gates it, so rollback is also "flip the flag off."

**Est. diff.** 1 new file (~220 LOC), `GlobalHeaderSearch` net roughly flat (inline branches → controller + child).

---

### Phase C — Shared results surface (`SearchResultsSurface`)

**Objective.** Dedupe the `/search` results body into a reusable surface so operations can mount it identically. Pure refactor — `/search` behaves exactly as today.

**Preconditions.** Phase A (rows). Independent of B.

**Steps.**
1. **Create `src/components/search/search-tabs.ts`.** Move `CATEGORY_TABS`, `TabId`, `CATEGORY_LABELS` out of `SearchWorkspace`. Add `orderedTabsForScope(scope: 'global'|'operations'): typeof CATEGORY_TABS` — global returns the current order (Overview first); operations returns Orders-first (Overview last), default active `order`.
2. **Create `src/components/search/SearchResultsSurface.tsx`** (§7 props). Lift the `SearchWorkspace` body verbatim: the `(q, tab)` fetch effect (`FetchState`, abort, 403/error mapping), the Overview grouping `useMemo`, the `HorizontalButtonSlider` tab rail (fed by `orderedTabsForScope(scope)`), the result-count line, and all five typed states. Row rendering goes through `AiQuickJumpResults`/`SearchResultRow`. `pageContext` = `scope==='operations' ? '/operations' : '/search'`. `entityTypes` default: operations Overview requests `['ORDER']` (orders-first) unless a non-order tab is active.
3. **`SearchWorkspace` becomes a thin wrapper:** owns `?q=`/`?type=` URL state + its visible `SearchField`, renders `<SearchResultsSurface scope="global" query={q} activeTab={tab} onTabChange={…} />`. No behavior change on `/search`.
4. **Row-click injection:** thread `onSelectHit` into `SearchResultRow.onNavigate` so operations can intercept (unused by `/search`).

**Design rules applied.** SoT "one surface" (`source-of-truth.md`); `empty-states`/`error-clarity` typed states preserved; `deep-linking` (URL-as-state kept on the page, not the surface).

**Acceptance.**
- `/search` is a **regression pass** — same tabs, same grouping, same states, same 50-cap "50+" line, same forbidden/error copy. Diff the rendered DOM before/after.
- `SearchResultsSurface` mounts standalone with a `scope` and a controlled `query`/`activeTab`.

**Tests.** Regression snapshot of `/search` (Overview + each scoped tab + empty + forbidden + error). Unit: `orderedTabsForScope('operations')` puts `order` first and defaults active to `order`.

**Rollback.** Re-inline the body into `SearchWorkspace`; delete the two new files. No flag dependency (this refactor can ship to everyone; it's output-identical).

**Est. diff.** 2 new files (~40 + ~240 LOC), `SearchWorkspace` shrinks to ~80 LOC.

---

### Phase D — Operations history results (the integration)

**Objective.** Turn `/operations?mode=history` into the two-region browse→drill surface, driven by the global header, with recents in the sidebar. This is the flag's flagship behavior.

**Preconditions.** Phases A + C (rows + surface). Phase B recommended (so the global header elsewhere already feels best-in-class), but not required — operations uses the *contextual* header (no dropdown), so it's independent of the dropdown work.

**Steps.**
1. **URL-state:** add `q` + `setQ` to `useOperationsTimelineUrlState` (§8.2). Unit-test that `setQ('x')` writes `?q=x` and deletes `order/serial/tracking`, and `setEntity('1')` preserves `?q=`.
2. **Create `src/components/operations/OperationsResultsView.tsx`:**
   ```tsx
   export function OperationsResultsView({ url }: { url: OperationsTimelineUrlState }) {
     const [tab, setTab] = useState<TabId>('order');
     return (
       <SearchResultsSurface
         scope="operations"
         query={url.q}
         activeTab={tab}
         onTabChange={setTab}
         onSelectHit={(hit) => { if (hit.entityType === 'order') url.setEntity(String(hit.id)); }}
       />
     );
   }
   ```
   (Non-order hits keep their normal `<Link>` deep-link; only order rows drill into the journey. Optionally map unit/receiving hits to their own `dim` + `setEntity` later.)
3. **`OperationsHistoryView` render rule (§8.1):** wrap the right pane in `<AnimatePresence mode="wait">` keyed on `` `${focused}:${url.entityValue}` `` with `framerPresence.workbenchPane`. Branch: `focused` → existing timeline; `!focused && url.q` → `<OperationsResultsView url={url} />`; else the reworded empty state ("Search shipped orders, serials, or tracking above" + recent hint).
4. **`HistorySidebar` (in `OperationsSidebarPanel.tsx`):**
   - Remove the `search={{…}}` prop from `<SidebarShell>`.
   - Add `usePageHeaderSearch(...)` (§8.3) — value `url.q`, `onChange: url.setQ`, `onSearch` with the `looksLikeIdentifier` fast path + `pushSearchRecent('operations:history')`, `onClear: () => url.setQ('')`. Deps `[url.q, url.dim]`.
   - Keep the dimension toggle.
   - Add the recents block (§8.4) from `useSearchRecents({ scope: 'operations:history' })`.
   - **Flag gate:** when `!unifiedOn`, keep today's `SidebarShell.search` (entity-focus) exactly as-is and skip `usePageHeaderSearch` + recents. So flag OFF = today's paste-a-number lookup, byte-identical.
5. **`isSearching` wiring:** surface the results-loading boolean up to the header's `HeaderSearchControl.isSearching` (lift a small shared signal, or a lightweight context/store) so the header pill's trailing spinner reflects operations fetch state — matches the `SearchField` pending/loading contract.

**Design rules applied.** Archetype split (Monitor results + Workbench timeline drill); crossfade the right pane only (`contextual-display.md`); `state-preservation` + `deep-linking` (`?q=` and `?order=` both hydrate on reload/back); `back-behavior` (Clear returns to the list, keeps `?q=`); `empty-states` teaching copy.

**Acceptance (flag ON).**
- No sidebar search bar on operations history; the **global header** drives orders-first results.
- Typing a fuzzy term → orders-first rich rows; clicking an order row → the journey timeline (right-pane crossfade); "Clear" → back to the results list (`?q=` intact); the dimension toggle + an exact-id Enter still jump straight to the timeline.
- Recents render in the sidebar (scope `operations:history`); selecting one re-runs; the same recent re-runs from `/search/history` back into operations (`scopeHref`).
- Deep links hydrate: `?q=samsung` → results on reload; `?order=1234` → timeline on reload; browser Back restores the prior region.
- **Flag OFF → today's paste-a-record-number lookup, byte-identical.**

**Tests.** `tests/e2e/operations-history-search.spec.ts`: type in header → orders-first rows → click → journey timeline → Clear → results → sidebar recents present; `?q=` and `?order=` deep-link hydration; reduced-motion (crossfade → fade). Unit: `setQ`/`setEntity` param interplay; `OperationsResultsView` intercepts order hits, lets others link out.

**Rollback.** Flip the flag off (restores entity-focus sidebar + paste-a-number). Code rollback: revert `OperationsHistoryView`/`HistorySidebar`/hook additions; delete `OperationsResultsView`.

**Est. diff.** 1 new file (~40 LOC), hook +~10 LOC, `OperationsHistoryView` +~40 LOC, `HistorySidebar` ~net flat (search prop → header registration + recents), 1 e2e spec.

---

### Phase E — (Optional) Shopify-grade order row: facet enrichment

**Objective.** Put **tracking + carrier** on the order row — the last 10% of "best-in-class." Optional; sequence **after** A–D validate live.

**Preconditions.** A–D shipped and embeddings backfilled (facets are display columns, not embedded — no re-embed needed).

**Steps.**
1. **Migration** (`src/lib/migrations/`, per `polymorphic-tables.md`): add `tracking_number TEXT`, `carrier TEXT` (nullable) to `entity_search_docs`; extend the ORDER-branch trigger `UPDATE OF` column list and the `docRowToHit` SELECT list; keep the two column lists in sync (the 2026-07-03d header rule). Idempotent DDL, org-led, no new discriminator.
2. **`buildOrderDoc`** (`build-search-text.ts`): add `trackingNumber` (already loaded as `tracking_number`) + `carrier` to `facets` (extend `SearchDocFacets`). The order loader already selects `tracking_number` (stn raw); confirm a `carrier` join or drop carrier if unavailable on the order source.
3. **`hybrid-retrieval.ts` `docRowToHit`:** pass `tracking_number`/`carrier` through into the serialized `facets` (already `Record<string,string|null>`).
4. **`SearchResultRow` order variant:** render carrier + last-4 tracking as a `TrackingChip` (`src/components/ui/CopyChip.tsx`, `getLast4` — **never re-derive last-4**; the copy-chip SoT owns it). Place it as a trailing chip before the date.
5. **Backfill enqueue** to refresh existing docs (no re-embed); verify chips render; regenerate `tenancy:coverage` if the migration touches RLS.

**Design rules applied.** Copy-chip SoT (`source-of-truth.md`); `truncation-strategy` (last-4 preview + copy full); `polymorphic-tables.md` contract.

**Acceptance.** ORDER rows show a carrier + last-4-tracking chip that copies the full number; keyword search on a partial tracking # still ranks the order (already in `searchText`); no re-embed required.

**Rollback.** The column adds are additive/nullable; drop the row chip (facets simply unused). Migration is forward-only but inert if the row doesn't read the facets.

**Est. diff.** 1 migration, ~15 LOC across `build-search-text`/`hybrid-retrieval`/`SearchResultRow`.

---

## 12. Sequencing & dependency graph

```
Phase 0 (shipped) ──┐
                    ├─ Phase A (SearchResultRow)  ──┬─ Phase B (GlobalSearchDropdown)   ← global header display
                    │                               └─ Phase C (SearchResultsSurface)  ──┐
                    └───────────────────────────────────────────────────────────────────┴─ Phase D (Operations)  ← integration
                                                                                             └─ Phase E (facet enrich, optional)
```

- **A is the root** (both B and C need the row).
- **B and C are parallelizable** after A.
- **D needs A + C** (and reads best paired with B for the rest of the app).
- **E is optional and last.**

**First PR (minimal vertical slice):** Phase A + B behind the flag — proves the best-in-class header display end-to-end (recents → preview → keyboard) without touching operations. Reviewable in isolation, zero risk to `/operations` until Phase D.

---

## 13. File touch list

**New**
- `src/components/search/search-result-chips.ts` (CHIP_TONE_CLASSES + `orderStatusTone` + ENTITY_ICONS)
- `src/components/search/SearchResultRow.tsx`
- `src/components/search/search-tabs.ts` (CATEGORY_TABS + TabId + `orderedTabsForScope`)
- `src/components/search/SearchResultsSurface.tsx`
- `src/components/search/GlobalSearchDropdown.tsx`
- `src/components/operations/OperationsResultsView.tsx`
- `src/components/search/SearchResultRow.test.tsx` · `GlobalSearchDropdown.test.tsx`
- `tests/e2e/operations-history-search.spec.ts`

**Modify**
- `src/components/layout/GlobalHeaderSearch.tsx`
- `src/components/search/AiQuickJumpResults.tsx`
- `src/components/search/SearchWorkspace.tsx`
- `src/features/operations/workspace/OperationsHistoryView.tsx`
- `src/components/sidebar/operations/useOperationsTimelineUrlState.ts` (add `q`/`setQ`)
- `src/components/sidebar/OperationsSidebarPanel.tsx` (`HistorySidebar`)
- (Phase E) `src/lib/search/build-search-text.ts` + a new migration + `src/lib/search/hybrid-retrieval.ts` select list

**Untouched (explicitly):** all other sidebar search bars; `hybridSearch` internals; the `CommandBar` ⌘K contract; `/api/ai/retrieve`; mobile scan flows; `search-recents.ts`.

---

## 14. Testing matrix

| Layer | Coverage |
|---|---|
| Unit (existing) | `search-recents` / `search-scope-labels` (**done**, 20 tests) |
| Unit (new) | `orderStatusTone` table; `SearchResultRow` field mapping (facets→dot/chips/date); `orderedTabsForScope`; `setQ`/`setEntity` param interplay |
| Component | `GlobalSearchDropdown` — empty/recents, typing/preview grouping, loading skeleton, no-results, keyboard nav (index/wrap/header-skip), Enter/Esc, aria-*; `SearchResultRow` order vs generic |
| Regression | `/search` DOM-identical after `SearchResultsSurface` extraction; `AiQuickJumpResults` output byte-identical after `SearchResultRow` refactor |
| E2E (`tests/e2e/`) | operations history: header type → orders-first rows → click → journey timeline → Clear → recents in sidebar; `?q=` and `?order=` deep-link hydration; exact-id Enter fast-path |
| Manual | reduced-motion (dropdown open + right-pane crossfade collapse to fade); flag OFF byte-identical (header + operations); keyboard-only full loop; dark-mode contrast of chips + glass |

---

## 15. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Two search surfaces confuse users during rollout | Flag-gated; operations bar removed only under the flag; sidebar bars elsewhere stay until the header is signed off |
| Order status dot uses the wrong SoT (`workflowStageDot`) → every order grey | Explicit `orderStatusTone` SoT (§5.4); dot + chip share it; unit-tested vocabulary |
| Order row lacks tracking/carrier | Ship the strong row from existing facets; enrich in Phase E (optional) |
| Operations loses the "paste a number → jump" fast path | `looksLikeIdentifier` Enter fast-path in `usePageHeaderSearch.onSearch` → `setEntity` (instant drill); dimension toggle retained |
| Contextual header + dropdown collision | Contextual mode renders **no** dropdown (verified: dropdown is `{isGlobal && …}`); results in the page pane, recents in the page sidebar |
| Crossfading the list by mistake | Crossfade the right pane only (`framerPresence.workbenchPane`), list/sidebar mounted + still |
| Keystroke cost | 250 ms debounce + abort + 2-char gate + session-memoized enabled probe; one embed call/keystroke max |
| `SearchWorkspace` regression on extraction | Phase C is a pure refactor gated behind a DOM regression pass before operations consumes it |
| Re-import of `SidebarSearchBar` in the operations recents block | Guard test forbids it; use `SearchRecentsDropdown` (already compliant) |
| Motion preset name drift (`dropdownOpen` vs `dropdownPanel`) | §0.2 correction; use `framerPresence.dropdownPanel` + `framerTransition.dropdownOpen` |

---

## 16. Locked decisions

| # | Decision | Rationale |
|---|---|---|
| L1 | **Rows, not bubbles** for results | Industry standard for order search + house "no grids / one-row" rule |
| L2 | **Orders-first** default scope for operations results | User directive ("shipped order search"); other entities behind tabs |
| L3 | **One renderer** (`SearchResultRow`), **one surface** (`SearchResultsSurface`), **one engine**, **one recents store** | SoT "never build a per-surface search"; upgrade once → everywhere |
| L4 | **Two-region operations history** (results + journey-timeline drill) | Keep the differentiated per-record timeline; add browse/search on top |
| L5 | **Global header is the only search input**; operations uses `usePageHeaderSearch` + a new `?q=` browse param | User directive; retires the duplicate operations sidebar bar; browse is distinct from entity focus |
| L6 | **Everything flag-gated** `NEXT_PUBLIC_UNIFIED_HEADER_SEARCH`, non-destructive | Safe incremental rollout; OFF = byte-identical |
| L7 | **Glass = tokens** (`surface-card/80 backdrop-blur`), motion via hooks (`dropdownPanel`/`workbenchPane`) | House color/motion SoT; no hex; reduced-motion free |
| L8 | **Order dot/chip tone = `orderStatusTone` SoT**, not `workflowStageDot`/`deriveOutboundState` | Search doc carries only the raw status string; those two SoTs are the wrong vocabulary / need absent signals |

---

## 17. Open questions

- **`isSearching` plumbing for the contextual header** (Phase D step 5): lift a shared boolean from `SearchResultsSurface` to `HeaderSearchControl.isSearching`, or accept that the operations header pill doesn't show a spinner (the results pane already shows "Searching…")? Recommend a minimal shared signal so the pill's pending/loading indicator stays honest.
- **Auto-drill on a single exact operations match:** if the header query `looksLikeIdentifier` and results return exactly one exact hit, auto-`setEntity` instead of showing a one-row list? Nice touch; defer until D is validated (risk: surprising navigation).
- **Non-order operations drill:** map unit/receiving/tracking hits to their `dim` + `setEntity` (so clicking a unit row also drills the journey), or keep them as normal deep-links out of operations? Start with order-only drill (§8.1 step 2), expand if operators ask.
- **Global preview grouping order:** mirror `orderedTabsForScope('global')` (Overview order) — confirm ORDERS leads the preview groups even in global scope (recommended for the "order search" north star).
