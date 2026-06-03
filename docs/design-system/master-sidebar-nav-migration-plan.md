# Master Sidebar Nav — Migration Plan

> Status: **Proposed** · Owner: design-system · Created 2026-06-02
> Prototype: `/design-demo` → section **02 · Segmented tabs** → Bay
> "Master sidebar nav — one dropdown, page + mode"
> (`src/app/design-demo/_gallery/sections.tsx` → `ReceivingModeSwitcherDemo`, ~L241–465)

This plan describes how to take the **single master-nav dropdown** prototyped in
the showroom and roll it across **every route sidebar** in the app, replacing the
current "render a whole different `*SidebarPanel` per route" model.

Related: [[design-2026-component-adoption]], [[sidebar-master-nav-dropdown]],
[[sidebar-gutter-system]], [[feedback_sidebar_reference_pattern]].

---

## 1. The idea in one paragraph

Today the rail header is a **page switcher** (`navOpen` dropdown of every page) and
each page renders its own panel that *also* owns a mode pill-row. There are two
disconnected navigation surfaces. The prototype fuses them into **one trigger**:
tap the header to drop a menu that (a) pins **Recent pages** on top, (b) lists
**All pages** below in canonical order, (c) **hides the page you're on**, and
(d) makes every page a **split row** — tap the left (icon + name) to jump to that
page's default mode; tap the right (count + `⌄`) to expand its modes and land
directly on, e.g., `FBA › Inbound`. The closed header shows **page icon + active
MODE name** (the icon already says which page). An **L2 icon-only mode row** sits
under the header and follows whatever page/mode is selected.

The win: the page→mode hierarchy becomes one coherent, two-tap surface instead of
N hand-rolled pill-rows. Each existing panel keeps its **body** (search, lists,
forms) but stops owning its **chrome** (title band + mode pills).

---

## 2. Current architecture (what we're replacing)

| Layer | Today | File |
|---|---|---|
| L1 page switch | `navOpen` dropdown — flat list grouped Main/Stations/More | `DashboardSidebar.tsx:296–333` (`NavSection`), `:467–536` (shell + trigger) |
| Header title | `getSidebarTitle()` + per-route `headerTitle` override | `DashboardSidebar.tsx:86–110`, `:408–417` |
| Per-route render | `SidebarContextPanel()` switch on `getSidebarRouteKey()` | `DashboardSidebar.tsx:112–294` |
| L2 mode pills | **each panel re-implements** a `HorizontalButtonSlider` | per-panel (see §4) |
| Mode state | URL search params / pathname, read **inside each panel** | per-panel helpers |

Two surfaces already half-merged: the **header title already follows the active
mode** for dashboard (`DASHBOARD_ORDERS_SUBVIEW_LABELS` + `getDashboardOrderViewFromSearch`)
and receiving (`RECEIVING_MODE_LABELS` + `getReceivingModeFromLocation`,
`DashboardSidebar.tsx:56–83`). The prototype generalizes that pattern to all pages
and adds the **mode picker into the dropdown itself**.

### Mode ownership today (the inventory we must centralize)

| Route key | Panel | Modes (default first) | Derivation | Switch |
|---|---|---|---|---|
| `dashboard` | `DashboardManagementPanel` / `ShippedSidebar` / `UnshippedSidebar` | pending, shipped, unshipped (+ search overlay) | `getDashboardOrderViewFromSearch` | `dashboardSearch.setOrderView` (URL) |
| `receiving` | `ReceivingSidebarPanel` | receive, incoming, history, unfound, pickup | `getReceivingModeFromLocation` (`?mode=` + `/receiving/unfound`) | `router.push/replace` |
| `fba` | `FbaSidebar` (`fba/sidebar`) | combine, plan, shipped | `resolveFbaMode(?mode=)` (`lib/fba/fba-modes.ts`) | `router.replace` |
| `inventory` | `InventorySidebarPanel` | inventory(stock), replenish | `?section=replenish` | `router.push` |
| `warehouse` | `WarehouseSidebarPanel` | labels, racks, rooms, bins, map | `?tab=` (+ `?view=` in map) | `router.replace` |
| `products` | `ProductsSidebarPanel` | manuals, labels, pairing, qc | `?view=` (+ `?labelsView=` sub) | `router.replace` |
| `tech` (Testing) | `TechSidebarPanel` | shipping {shipped,pending,history}, testing | `?view=` | `router.replace` |
| `walk-in` / `repair` | `WalkInSidebarPanel` → `RepairSidebarPanel` + Sales | incoming, active, done (repair) | `?tab=` | `router.replace` |
| `admin` | `AdminSidebar` | overview, goals, features, staff, access, roles, connections, integrations, fba, sku_catalog, manuals, reason_codes, locations, repair_issues | `?section=` (`ADMIN_SECTION_OPTIONS`) | `updateSearch` |
| `packer` | `PackerSidebarPanel` | — (single) | — | — |
| `support` | `SupportSidebarPanel` | — (single) | — | — |
| `ai-chat` | `AiChatSidebarPanel` | — (single) | — | — |
| `previous-quarters` | `QuarterSidebar` | — (quarter list) | — | — |
| `audit-log` | `AuditLogSidebarPanel` | — (single) | — | — |
| `settings` | `SettingsSidebarPanel` | — (single) | — | — |
| `manuals-library` | `ManualsLibrarySidebar` | — (single) | — | — |

Sources: `DashboardSidebar.tsx:239–293`; sub-agent panel map (each panel's mode
derivation cited there). **Admin is special** — its 14 "modes" are really a config
list already (`ADMIN_SECTION_OPTIONS`), a clean fit for the dropdown's mode rows.

---

## 3. Target architecture

Three new pieces, one config, then a strangler swap of `DashboardSidebar`.

```
src/lib/sidebar-navigation.ts        # extend with mode metadata (single source of truth)
  └─ SIDEBAR_PAGE_NAV: NavPage[]      # page → modes[], built from §2 table

src/components/sidebar/master-nav/
  ├─ MasterNavDropdown.tsx           # L1+L2 picker (promote ReceivingModeSwitcherDemo)
  ├─ MasterNavHeader.tsx             # closed header: page icon + active MODE name + ⌄
  ├─ ModeRail.tsx                    # L2 icon-only HorizontalButtonSlider (variant=segmented)
  ├─ useActiveSidebarMode.ts         # pathname+search → { page, mode } (one resolver)
  ├─ useSidebarModeNav.ts            # navigate(page, mode) → router push/replace + recents
  └─ useRecentPages.ts              # localStorage-backed recents (pin top 3)
```

### 3.1 The config — `SIDEBAR_PAGE_NAV`

Extend `sidebar-navigation.ts` (already the L1 source via `APP_SIDEBAR_NAV`) so
modes live next to pages instead of being re-declared in 8 panels:

```ts
export interface SidebarModeItem {
  id: string;                 // canonical mode id, e.g. 'incoming'
  label: string;              // header + row label, e.g. 'Incoming'
  icon: SidebarIconComponent;
  /** How this mode maps to a URL. */
  to: (base: string) => { pathname: string; params?: Record<string, string | null> };
}
export interface SidebarPageNav extends SidebarNavItem {
  modes?: SidebarModeItem[];  // omitted = single-surface page (no L2 row)
}
export const SIDEBAR_PAGE_NAV: SidebarPageNav[]  // = APP_SIDEBAR_NAV + modes from §2
```

Each page declares its **own** URL convention in `to()` so the resolver and the
nav action share one mapping (no divergence between read and write paths). This is
the key refactor — it pulls `getReceivingModeFromLocation`, `resolveFbaMode`,
`parseTab`, `parseView`, etc. into one declarative table.

### 3.2 The resolver — `useActiveSidebarMode()`

One hook returns `{ pageId, modeId }` from `usePathname()` + `useSearchParams()`,
replacing every panel's bespoke `get*ModeFromLocation`. Drives both the closed
header label and the L2 rail's active pill.

### 3.3 The nav action — `useSidebarModeNav()`

`navigate(pageId, modeId?)`:
1. Resolve target via `SIDEBAR_PAGE_NAV[page].modes[mode].to()`.
2. `router.push` on **page change**, `router.replace` on **same-page mode flip**
   (preserves history semantics each panel currently chooses individually).
3. Push `pageId` onto recents (dedup, keep 3) — `useRecentPages`.

### 3.4 Header + dropdown + rail

Promote the prototype almost verbatim — it's already token-first (`surface-*`,
`text-*`, `border-soft`) so dark mode is free. Swap the demo's local `useState`
for the three hooks above and the static `NAV_PAGES` for `SIDEBAR_PAGE_NAV`
filtered by permissions (`getSidebarNavItems({ permissions })`).

---

## 4. What each panel loses (and keeps)

For every multi-mode panel the migration is **delete the chrome, keep the body**:

- **Remove**: the panel's own `HorizontalButtonSlider` mode row + its `parse*`/
  `update*Params` mode-switch handlers + any title band.
- **Keep**: the per-mode body (search field, list, form, rail) — now rendered by
  the master shell selecting on the resolver's `modeId`.
- **Rewire**: panels that read `?mode=`/`?tab=`/`?view=` internally keep reading
  it (URL stays the source of truth) — they just stop *writing* it; the master
  nav writes it. Minimal churn inside the bodies.

Single-surface panels (`packer`, `support`, `ai-chat`, `audit-log`, `settings`,
`previous-quarters`, `manuals-library`) get **no L2 rail** — `modes` omitted; the
header shows the page name and the body renders unchanged.

---

## 5. Phased rollout (one PR per phase, all on `main`)

> Strangler approach per [[design-2026-component-adoption]]: build behind the
> existing structure, migrate page-by-page, never a big-bang swap.

**P0 · Foundations (no UI change). ✅ DONE 2026-06-02.**
Added `SidebarModeItem`/`SidebarPageNav`/`ModeNavTarget` types + `SIDEBAR_PAGE_NAV`
(modes for dashboard, receiving, fba, inventory, warehouse, products, tech,
walk-in) + `applyModeTarget()`/`resolveSidebarMode()`/`getSidebarPageNav()` to
`sidebar-navigation.ts`. Each mode owns its `to()` (write) and the page owns
`resolveMode()` (read), mirroring the live panels' derivations. 7 new round-trip
tests in `sidebar-navigation.test.ts` enforce `resolveMode(apply(to(mode)))===mode`
for every mode, param-preservation, uniqueness, default resolution, and parity on
known deep-links (receiving/unfound, fba=combine, dashboard presence params,
tech view=testing). `npx tsx --test` green (10 tests), `tsc --noEmit` clean.
Admin's 14 sections deferred to P4 (derive from `ADMIN_SECTION_OPTIONS`). No
component touched. *Acceptance met: types compile, tests green, zero visual diff.*

**P1 · Build the shell (dark, behind a flag). ✅ DONE 2026-06-02.**
Created `src/components/sidebar/master-nav/`: presentational `MasterNavHeader`
(icon = page, label = active mode), `ModeRail` (wraps the shared
`HorizontalButtonSlider` `segmented` variant — flush full-bleed grey strip, no
bubble), `MasterNavDropdown` (recents-on-top / all-pages / split rows with mode
accordion), `MasterNavView` (the state-driven composite), the router-wired
container `MasterNav`, and the three hooks `useActiveSidebarMode` /
`useSidebarModeNav` (push-on-page-change, replace-on-mode-flip, params preserved)
/ `useRecentPages` (localStorage `sidebar.recentPages`, top 3). Barrel `index.ts`.
The `/design-demo` showroom Bay now drives the REAL `MasterNavView` against the
REAL `SIDEBAR_PAGE_NAV` on local state (no navigation) — the bespoke demo
`NAV_PAGES` is deleted. Token-first (dark works free), `tsc --noEmit` clean, lib
tests still green. **Not** wired into `DashboardSidebar` yet — that's P2.
*Acceptance met: dropdown switches page+mode against real config, light/dark,
keyboard (native buttons), reduced-motion (via the segmented slider).*

**P2 · Cut over the simple multi-mode pages. 🟡 IN PROGRESS (flagged) 2026-06-02.**
Wired `MasterNav` into `DashboardSidebar` behind **`?masterNav=1`** (default off —
zero change for current users until verified in-browser, then flip the default).
When on, the legacy pinned-trigger + flat page list is replaced by the master nav.
The menu is a true **dropdown overlay** anchored in the header band — it floats
over the workspace body (`renderContext` = the existing `SidebarContextPanel`,
rendered unchanged), it does NOT take the panel over. It stays within the panel's
width/height, so the sidebar's `overflow-hidden` doesn't clip it. Permission +
mobile filtering passed through.
- The dropdown keeps **Recent pinned on top**, then groups the rest **Main /
  Stations / More** off each page's `kind` (mirrors the legacy nav).
- New `MasterNavContext` (`useMasterNavEnabled`) lets panels hide their OWN
  pill-row so the L2 rail isn't doubled — gated, not deleted, so legacy stays
  intact. `MasterNavView` renders header + overlay dropdown + rail + optional
  context body (`showModeRail`/`renderContext`); `MasterNav` gained a
  `railPageIds` allowlist.
- Rail + pill-row suppression live for **inventory, warehouse, products,
  walk-in/repair** (`MASTER_NAV_RAIL_PAGES`). **tech deferred** — its sub-switcher
  is shared with the standalone `/tech` station (`StationTesting`), so it needs
  care; dashboard/receiving/fba stay on their own switchers (P3). tsc + tests
  green.
- **Remaining for P2-final:** browser-verify the flagged flow (panel-mode menu,
  rail nav, deep-links), migrate **tech**, then flip the default and DELETE the
  gated pill-rows + legacy `navOpen`/`NavSection`/`getSidebarTitle`.
*Acceptance (partial): flagged modes reachable from the dropdown + old `?param=`
deep-links still resolve (round-trip tests). Full acceptance pending browser QA.*

**P3 · Cut over the heavy stations.**
**receiving** (pathname + `?mode=`, `/receiving/unfound`), **fba**
(`resolveFbaMode`), **dashboard** (orders subview + the search overlay quirk).
These own the most events/recents/rails — migrate last, one at a time, with manual
QA of the scan/rail flows. *Acceptance: receiving scan + unfound, fba combine/plan,
dashboard pending/shipped/awaiting all intact.*

**P4 · Admin + polish.**
Map `ADMIN_SECTION_OPTIONS` → modes (14 rows — validates the dropdown at scale;
consider grouped mode rows by `group`). Remove `getSidebarTitle`/`headerTitle`
override block and the old `navOpen` `NavSection` once every route is on master
nav. Migrate `sidebar-master-nav-dropdown` memory's "Still TODO" line to done.
*Acceptance: no route renders the legacy flat nav; `getSidebarTitle` deleted.*

---

## 6. Per-component checklist

| Page | Phase | Modes to wire | Remove from panel | Notes |
|---|---|---|---|---|
| inventory | P2 | stock, replenish | `SECTION_ITEMS` slider + `?section` writer | 2-mode, easiest |
| warehouse | P2 | labels, racks, rooms, bins, map | `tabItems` slider + `parseTab` writer | keep `?view=` map sub-state in body |
| products | P2 | manuals, labels, pairing, qc | view slider + `updateParams` | labels sub-tabs (`?labelsView=`) stay in body |
| repair / walk-in | P2 | incoming, active, done | `REPAIR_TAB_ITEMS` slider | walk-in embeds repair + sales |
| tech | P2 | shipping{shipped,pending,history}, testing | 2× nav sliders | nested sub-modes → flat mode list or grouped rows |
| receiving | P3 | receive, incoming, history, unfound, pickup | `RECEIVING_MODE_ITEMS` slider | pathname `/receiving/unfound`; preserve scan events |
| fba | P3 | combine, plan, shipped | `modeItems` slider | badge counts (PLANNED/PACKED) → mode-row count? |
| dashboard | P3 | pending, shipped, unshipped | `DASHBOARD_ORDERS_SUBVIEW_ITEMS` slider | search is an overlay, not a mode — keep as-is |
| admin | P4 | 14 sections | `AdminSidebar` section nav | grouped rows; permission-gated modes |
| packer/support/ai-chat/audit-log/settings/quarters/manuals-library | P2–P4 | — | — | single-surface, no L2 rail |

---

## 7. Decisions to lock before P2

- **D1 · URL vs local state for modes.** Keep **URL as source of truth** (matches
  every panel today; deep-links + back-button keep working). Master nav writes the
  URL; bodies read it. *Recommended: yes.*
- **D2 · push vs replace.** Page change = `push`; same-page mode flip = `replace`.
  Encode per-mode in `to()` or as a flag on the nav action. Confirm this matches
  receiving/fba expectations (they currently `replace` mode flips).
- **D3 · Nested modes (tech).** Flatten `shipping{shipped,pending,history}` +
  `testing` into one mode list, or render grouped mode rows? Prototype currently
  shows a flat list — start flat, revisit if tech feels cramped.
- **D4 · Recents scope.** Per-user localStorage key (e.g. `sidebar.recentPages`),
  pin top 3, dedup. Survives reload; cleared on sign-out alongside other keys.
- **D5 · Mobile.** Preserve `isMobileStationLockdown` (receiving/packer collapse to
  Home + station, `DashboardSidebar.tsx:436–457`) and the in-drawer "forced open"
  behavior. Master nav must honor the same mobile-restricted filtering.
- **D6 · Permissions.** Modes must inherit page permission gating
  (`getSidebarNavItems({ permissions })`) and per-mode `requires` (admin sections
  already have `requires`).

---

## 8. Risks

- **Receiving/FBA event + rail coupling** — the highest-churn bodies. Mitigate by
  migrating chrome only, leaving the `SidebarRailShell`-backed bodies untouched.
- **Dashboard "search" isn't a mode** — it's a focus overlay
  (`DASHBOARD_SHIPPED_FOCUS_SEARCH_PARAM`). Don't model it as a 4th pill.
- **Deep-link parity** — every old `?mode=/?tab=/?view=/?section=` URL must still
  land correctly. P0 round-trip tests are the guardrail; add e2e for receiving +
  fba in P3.
- **Gutter alignment** — the L2 rail must sit in the 40px band on `SIDEBAR_GUTTER`
  (see [[sidebar-gutter-system]]); reuse `SidebarSection band`.

---

## 9. Acceptance (whole initiative)

1. Every route's modes are reachable in ≤2 taps from the header dropdown.
2. The page you're on is hidden from the menu; recents pin on top.
3. Closed header shows page icon + active **mode** name everywhere.
4. All legacy deep-links resolve unchanged (round-trip tests + manual QA).
5. `getSidebarTitle`, the flat `navOpen` `NavSection`, and all per-panel mode
   pill-rows are deleted.
6. Light/dark, keyboard, reduced-motion, mobile lockdown all intact.
</content>
</invoke>
