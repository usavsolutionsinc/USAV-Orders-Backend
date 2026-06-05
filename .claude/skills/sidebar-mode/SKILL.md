---
name: sidebar-mode
description: Enforces the canonical sidebar/mode architecture when adding any new feature, view, tab, or search surface to a page. Use BEFORE building a page feature so it becomes a sidebar MODE (HorizontalButtonSlider + ?mode= URL state) rendered through SidebarShell, with search in the sidebar and the right pane kept as visual display — never an ad-hoc one-off panel.
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
---

# Sidebar & Mode — the one true pattern

Every page in this app is a **contextual sidebar + a mostly-visual right pane**. New
functionality is added as a **mode** inside that page's sidebar — NOT as a new
floating panel, a new top-bar tab, a bespoke `useState` view-switcher, or a chunk of
chrome bolted onto the right pane. This skill exists because new features keep getting
wired up "as a different method" instead of plugging into the existing mode system.

When you are adding a feature, view, list, tab, filter, or search to any page, follow
this contract exactly. If a requirement seems to fight the contract, stop and surface
it — do not invent a parallel mechanism.

## The four laws

1. **A new feature display = a new MODE in the sidebar.** Modes are a `XxxMode` string
   union + a `XxxMODE_ITEMS: HorizontalSliderItem[]` array, rendered with
   `HorizontalButtonSlider`, and selected through the URL (`?mode=`). Never a local
   `useState('view')`, never a second router, never a new nav surface.
2. **Search ALWAYS lives in the sidebar**, and is rendered by `SidebarShell` via its
   `search` prop. Never render `<SidebarSearchBar>` yourself, never put a search input
   in the right pane.
3. **The right pane is mainly VISUAL DISPLAY.** It reacts to what the sidebar selects.
   It does not own search, mode switching, or filtering. Selection flows sidebar → pane
   via URL params (`?open=`) or a CustomEvent — not via the right pane reaching back.
4. **The sidebar is contextual per page AND per mode.** Each mode shows its own search
   placeholder, its own filter set, its own result list. Switching modes clears
   mode-scoped URL params.

## Where the pieces live (read these before editing)

| Concern | File | Key symbols |
|---|---|---|
| Layout shell (owns search) | `src/components/layout/SidebarShell.tsx` | `SidebarShell`, `SidebarShellProps` |
| Layout tokens | `src/components/layout/header-shell.ts` | `SIDEBAR_GUTTER`, `sidebarHeaderPillRowClass`, `sidebarHeaderSearchRowClass` |
| Mode/tab switcher | `src/components/ui/HorizontalButtonSlider.tsx` | `HorizontalButtonSlider`, `HorizontalSliderItem` |
| Page → panel registry | `src/components/DashboardSidebar.tsx` | `routeKey === '…'` dispatch, `MASTER_NAV_RAIL_PAGES` |
| Route-key resolver | `src/lib/sidebar-navigation.ts` | `getSidebarRouteKey`, `SidebarRouteKey` |
| Page mount (desktop/mobile) | `src/design-system/components/RouteShell.tsx` | `RouteShell` (`actions` + `history`) |
| Reference: multi-mode panel | `src/components/sidebar/ReceivingSidebarPanel.tsx` + `src/components/sidebar/receiving/receiving-sidebar-shared.ts` | `ReceivingMode`, `RECEIVING_MODE_ITEMS`, `updateMode` |
| Reference: URL-state hook | `src/components/inventory/useInventoryUrlState.ts` | `InventoryMode`, `useInventoryUrlState`, `setSidebarUrl` |
| Reference: search-only panel | `src/components/ShippedSidebar.tsx` | `SidebarShell` `search`/`filter` props |

The preferred reference to model new sidebars on is the dashboard **Orders / Shipping**
sidebar, not FBA/Receiving's older shapes (per house convention).

## Decision: am I adding a MODE or a TAB?

- **Mode** = a distinct feature/data context with its own search + list (e.g. Receiving
  → Incoming / History / Local Pickup). One mode rail at the top of the sidebar. Use
  `headerAbove` (or the master-nav rail — see below).
- **Tab** = a sub-filter *within* one mode that shares the same search (e.g. Inventory
  ledger → bins / units). Use `headerRows` (each becomes a 40px pill band).

If the new thing has its own search semantics or its own result list, it is a **mode**.

## Recipe — add a new mode to an existing page

Work in the page's existing `*SidebarPanel.tsx` + its shared module. Do NOT create a new
top-level panel or a new route unless the mode is genuinely a separate page.

1. **Extend the mode union + items** in the page's shared module (the analog of
   `receiving-sidebar-shared.ts`):
   ```ts
   export type XxxMode = 'default' | 'existing' | 'newmode';
   export const XXX_MODE_ITEMS: HorizontalSliderItem[] = [
     // …existing…
     { id: 'newmode', label: 'New View', icon: SomeIcon },
   ];
   ```
2. **Thread it through the URL-state hook** (the analog of `useInventoryUrlState`):
   read `?mode=`, default mode omitted from the URL, and on a mode change **clear the
   mode-scoped params** (`q`, `field`, `filter`, `open`). Expose a single
   `setSidebarUrl({ mode })` / `updateMode(next)` setter that calls
   `router.replace`/`push`. Never mutate `window.location` or hold mode in `useState`.
3. **Render the mode pills once** at the top of the panel:
   ```tsx
   <HorizontalButtonSlider items={XXX_MODE_ITEMS} value={mode}
     onChange={(id) => updateMode(id as XxxMode)} variant="nav" dense className="w-full" />
   ```
   If the page is in `MASTER_NAV_RAIL_PAGES` (see `DashboardSidebar.tsx`), gate this row
   on `useMasterNavEnabled()` so the master-nav L2 rail isn't doubled.
4. **Build the mode's body as a `SidebarShell`** (or a child component that returns one):
   ```tsx
   <SidebarShell
     search={{ value, onChange, placeholder: 'Search …', isSearching }}
     filter={{ label: 'Filters', refinements, onClearAll, renderDropdown }}
     headerRows={[ /* optional in-mode tab pills */ ]}
   >
     {/* scrollable result list — the shell handles gutter + overflow */}
   </SidebarShell>
   ```
5. **Switch on mode** in the panel: `{mode === 'newmode' && <NewModeBody />}`.
6. **Keep the right pane visual.** The new mode's selection writes `?open=<key>` (or
   dispatches the page's existing select CustomEvent); the right pane reads it and
   renders the detail/visual. Do not add search/mode controls to the right pane.

## Recipe — a brand-new page's sidebar

1. Add the route key to `SidebarRouteKey` + a branch in `getSidebarRouteKey`
   (`src/lib/sidebar-navigation.ts`).
2. Create `src/components/sidebar/XxxSidebarPanel.tsx` returning a `SidebarShell`.
3. Register it in `DashboardSidebar.tsx`: `if (routeKey === 'xxx') return <XxxSidebarPanel />;`.
4. Mount the page via `RouteShell` (`actions={<XxxSidebarPanel/>}` for mobile,
   `history={<MainVisualPane/>}`). Desktop sidebar comes from `DashboardSidebar`.

## Hard "never" list (these are the "different method" anti-patterns)

- ❌ `const [view, setView] = useState(...)` to switch feature displays → use `?mode=`.
- ❌ Importing or rendering `<SidebarSearchBar>` directly → pass `search` to `SidebarShell`.
  (A guard test, `src/components/ui/sidebar-search-bar.guard.test.ts`, fails the build if
  anything but `SidebarShell` imports it.)
- ❌ A search input, mode pills, or filter bar inside the right/main pane.
- ❌ Hand-positioning the search band (`py-2`, `mt-4`, `-mx-1.5`, nesting it in a scroll
  body) — the shell owns the 40px band and the gutter.
- ❌ Hardcoded left padding instead of `SIDEBAR_GUTTER` / `sidebarHeaderPillRowClass`.
- ❌ A new top-bar nav entry or floating panel for something that is a per-page mode.
- ❌ Mode state held anywhere but the URL.

## Verify before you finish

1. `npm run lint`
2. `npx tsc --noEmit` — the `XxxMode` union must be exhaustive everywhere it's switched.
3. Run the guard test if you touched any search wiring (it asserts `SidebarSearchBar`
   stays shell-only).
4. Manual check: deep-link to `?mode=newmode` loads the mode directly; switching modes
   clears stale `q`/`filter`/`open`; refresh preserves the mode; the right pane shows
   only visual detail for the current selection.

If any of the four laws can't be satisfied for a genuine reason, say so explicitly and
propose the smallest deviation — don't silently fork a parallel pattern.
