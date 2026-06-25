# Workbench display — list → select → detail → update

The pointer-driven master-detail editor. A user **navigates** a set of records that are **not** scan-driven and
**edits** them: catalog authoring, QC checklists, kit-parts ("what's in the box"), pairing, settings. Deliberate,
durable, URL-addressable selection, CRUD. This is the **default archetype** — if a region isn't a scanner Station, a
read-only Monitor, or a node-graph Canvas, it's a Workbench.

**Inherits:** ../ui-design-system.md (linear scaffold, one-row anatomy, eyebrow + chips, `HoverTooltip`, semantic
tokens, icon pairing). This doc only details what's *specific* to the Workbench archetype; never restate the shared
house style.

> Rule of thumb: if the user **picks from a list and edits**, the **sidebar is the map and the right pane is the
> workspace.** Keep the map stable; transition only the workspace.

---

## When to choose Workbench (the fallthrough)

- **Workbench is the default; you arrive here by elimination, not affinity.** Run the discriminator in order:
  scanner → Station, read-only-observe → Monitor, pan/zoom node-graph → Canvas, **everything else → Workbench.** The
  job decides, not the feature area or the route.
- **The signature is durable, URL-addressable selection + CRUD.** If the user picks a record, edits it, and the edit
  persists through a route — and a reload should land them back on the same record — it's a Workbench.
  `ProductsWorkspace.tsx` is the reference: one page, five modes (`?view=labels|pairing|qc|kit`, default Manuals),
  each a list→select→edit surface.
- **Anti-mix guard — never invert the sidebar.** The sidebar is the **master picker** for *every* mode in the page;
  that cross-mode consistency is the whole point. **Do not** flip one mode to put related/similar items where the
  picker belongs (siblings go *below* the picker via progressive disclosure — see that section). Inverting the map
  breaks the user's mental model the moment they switch modes.
- A page may **host** a Workbench beside another archetype (a scan bench with an inspector that's a mini-workbench),
  but each *region* obeys exactly one archetype — never blend two in one region.

---

## Anatomy

Three structural slots, always in this order:

| Slot | Owns | Reference |
|---|---|---|
| **Sidebar picker** (the stable map) | searchable master list + mode rail; the navigator for the whole page | `ProductsSidebarPanel.tsx` via `src/components/layout/SidebarShell.tsx` |
| **Mode rail** | `?view=`/`?mode=` switcher pinned in the sidebar header | `HorizontalButtonSlider` `variant="nav"` `dense` |
| **Right pane** (the workspace) | the selected record's detail/editor; crossfades on selection change | `QcChecklistWorkspace.tsx`, `KitPartsWorkspace.tsx` |

- **Compose `src/components/layout/SidebarShell.tsx`; never hand-position search.** It owns the outer
  `flex h-full flex-col overflow-hidden` column, renders `<SidebarSearchBar>` itself from the `search` prop (the
  `sidebar-search-bar.guard.test.ts` guard keeps `SidebarSearchBar` out of other components — migration in progress),
  and stacks `headerAbove` (mode rail) → search →
  `headerRows[]` (sub-tabs) → `children` (the single `flex-1 overflow-y-auto` body). The panel supplies slots, not
  layout — that's what kept the 40px search band from drifting per page.
- **The mode rail lives in the sidebar header**, not the right pane. `ProductsSidebarPanel.tsx` passes the view slider
  as `headerAbove` and conditional sub-tab/sort rows (`labelsView`, `pairingSort`) as `headerRows`. Each is a
  `HorizontalButtonSlider` `variant="nav" dense` (32px pill in a 40px band).
- **Responsive fallback is list-OR-detail, not both.** On a narrow viewport, show the picker *or* the detail, never a
  cramped two-up. This is the M3 *list-detail* canonical layout's pane-collapse rule and WinUI's *List/Details*
  pattern — selection drives which pane is visible. (M3: https://m3.material.io/foundations/layout/canonical-layouts ·
  WinUI: https://learn.microsoft.com/en-us/windows/apps/design/controls/list-details)

---

## Compose the rail, never fork it

- **The picker wraps shared infrastructure; it never re-implements list mechanics.** Two reuse tiers exist:
  - **`src/components/layout/SidebarShell.tsx`** — the layout shell (header/search/rows/scroll-body). Every Workbench sidebar uses it.
  - **`SidebarRailShell.tsx`** — the *recent-activity rail* engine (`useSidebarRail`): fetch + `queryKey`, optimistic
    `updateEvent`/`deleteEvent`/`deleteGroupEvent` patching, query invalidation, top-N + pinned selection, package
    grouping, keyboard nav, hover-preview popover positioning, stagger reveal. The domain wrapper supplies only
    renderers.
- **`RecentActivityRailBase.tsx` is the reference wrapper** — it passes `renderRowMain`, `renderPopover`,
  `getStatusDot`, `getStatusDotLabel`, and hoists its callbacks (`getRowId`, `getRowActivityAt`) to module scope so
  the shell's listener effect subscribes once instead of tearing down on every parent re-render.
- **A simple catalog picker may be a plain list** (e.g. `QcSidebarPicker`/`KitPartsPicker` inside
  `ProductsSidebarPanel.tsx` render a `divide-y` `<ul>` over `useSkuCatalogSearch`) — but it still **composes
  `SidebarShell`** for the header/search band, and it still obeys the one-row anatomy and `bg-blue-50` selection rule.
  Fork the *rows*, never the *shell*.

> Rule of thumb: new picker → wrap `SidebarShell` (+ `SidebarRailShell` if it's an activity rail) and supply
> renderers. If you're writing fetch/selection/keyboard-nav code, you've forked something you should have composed.

---

## URL-as-state

- **Selection and mode live in `searchParams`, not React state.** That's what makes every view deep-linkable and
  reload-safe. The picker writes selection with `router.replace` (`?skuId=` in QC/Kit, `?sku=` in Pairing, `?id=` in
  Manuals, `?historyId=` in Labels) and the right-pane workspace reads the *same* params — so no prop-drilling, no
  context: `ProductsSidebarPanel` and `ProductsWorkspace` are coupled only through the URL. This is the nuqs
  "search params as state" model (https://github.com/47ng/nuqs).
- **Mode is a param too; the default mode drops out of the URL.** `parseView`/`handleViewChange` in
  `ProductsSidebarPanel.tsx` set `?view=qc` but `updateParams({ view: null })` for the default (Manuals), keeping deep
  links clean. Sub-views follow the same rule (`labelsView`, `pairingSort` drop their defaults).
- **Mode-scoped params clear on mode change.** Switching the Labels sub-tab clears the stale unit selection
  (`updateParams({ labelsView: …, historyId: null })`); `useReceivingMode.ts` `updateMode`/`updateUnboxView` clears
  History params and fires `receiving-clear-line` so a new list starts at its own empty state instead of carrying a
  dead selection. **A selection from mode A must never bleed into mode B.**
- **Gap to close: filters/sort/search are only *partially* in the URL.** Today `?q=` and `?sort=` are URL-backed in
  Products, but most filter/field state still lives in component `useState`. Push **all** durable filter/sort/search
  state into `searchParams` so a shared link reproduces the exact view. (This is the cross-cutting "URL is the state
  SoT for durable views" rule.)

---

## Selection lifecycle

The list is the stable map; only the detail moves.

1. **Row click → `router.replace`.** The picker writes the selection id to the URL. `QcSidebarPicker`/`KitPartsPicker`
   set `?view=…&skuId=…`; the active row stays highlighted (`bg-blue-50 text-blue-700`, trailing `Check`).
2. **URL change → id-gated re-fetch.** The detail hook reads the id and gates on validity:
   `useSkuQcChecks(skuId)` / `useSkuKitParts(skuId)` set `enabled: typeof skuCatalogId === 'number' && skuCatalogId > 0`,
   so an empty/`null` selection never fires a request — it renders the teaching empty state instead.
3. **Crossfade the right pane**, keyed on the selection id (see Right-pane crossfade).
4. **The list never animates.** Selection is `bg-blue-50 ring-1 ring-inset ring-blue-400` background+ring only — never
   a size/height shift, never a list crossfade. Stable navigation; the map stays put.

---

## Teaching empty + typed states

- **Branch the empty/error copy by *type*, not one generic "Nothing here."** Four distinct states, each with its own
  copy and CTA (NN/g empty-state guidance: https://www.nngroup.com/articles/empty-state-interface-design/):
  - **No selection (first-use prompt)** — teach the next action. `QcChecklistWorkspace` with no `skuId` renders a
    centered icon tile + "Select a product from the sidebar to view and manage its QC checklist." `KitPartsWorkspace`
    mirrors it.
  - **Loaded-but-empty (no results)** — distinguish *no data yet* from *no matches*: `QcSidebarPicker` shows
    `trimmedQuery ? 'No matches with a QC checklist.' : 'No products have a QC checklist yet.'` A no-results state with
    an active filter should offer a **Clear filters** action; a first-use empty should offer the primary create action
    inline, never a bare line.
  - **Loading** — spinner + text: `<Loader2 className="h-4 w-4 animate-spin" /> Loading…` (the shared async rule).
  - **Errored** — a **distinct, retryable** state, visually separate from empty (rose, not gray).
- **The right pane's empty state is keyed to the mode.** `ReceivingRightPane.tsx`'s `RECEIVING_EMPTY_STATE` map keys
  copy by `?mode=` so triage's "pick from the Unfound/Prioritize list" prompt never shows in Unbox — empty copy is
  structurally tied to the mode that owns it.

---

## Degrade-not-fail (per-sub-resource isolation)

- **Each right-pane sub-resource fetches in its own `try/catch` + error boundary; a failing sub-fetch renders empty,
  it never 500s the whole record.** The SoT to mirror is `src/app/api/get-title-by-sku/route.ts`, which wraps the QC
  and kit-parts lookups in independent `try/catch` blocks (the QC fetch failing returns empty checks, the title still
  resolves) — a sub-resource is allowed to fail without taking down the record.
- **On the client, the same law: a sibling fetch error degrades to empty, not a thrown pane.** `QcChecklistWorkspace`
  loads its sibling kit-parts count via `useSkuKitParts(skuId)` but only renders `kit?.parts.length ?? 0` — if that
  sibling query errors, the QC pane still fully renders; the cross-link chip just shows `0`. The *primary* resource
  errors to the retryable error state; *secondary* resources degrade silently.
- This is graceful degradation / mitigating interaction failure (AWS Well-Architected REL:
  https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_mitigate_interaction_failure_graceful_degradation.html).

---

## Right-pane crossfade

- **Crossfade the right pane on selection change; keep the list mounted and still.** `AnimatePresence mode="wait"`
  keyed on the selection id, **opacity + small-y only**, `prefers-reduced-motion` honored. `ReceivingRightPane.tsx` is
  the reference: the focused workspace is a `motion.div key={`workspace-${workspace.row.id}`}` with
  `initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, y: 6 }}` →
  `animate={{ opacity: 1, y: 0 }}` → `exit … { opacity: 0, y: 4 }`, `transition={{ duration: 0.18, ease: motionBezier.easeOut }}`.
- **Keep the table/list mounted, `display:none`, to preserve its cache + scroll.** `ReceivingRightPane.tsx` holds
  `ReceivingLinesTable` `style={{ display: isTableOnlyMode ? 'block' : 'none' }}` (not unmounted) so its react-query
  cache, in-flight search, and scroll position survive a tab flip — and so first-mount auto-select effects don't
  re-fire on every close.
- **Route motion through the reduced-motion wrappers.** Prefer `useMotionTransition` / `useMotionPresence`
  (`src/design-system/foundations/motion-framer-hooks.ts`) so reduced motion automatically collapses y→0 and shrinks
  the duration to ~0 — that's the "replace slides with crossfades" accessibility default, not "no motion." Pull
  easings from `motionBezier` / `framerTransition` in `motion-framer.ts`; never hardcode a cubic-bezier. **Never
  animate width/height/padding** — for height use `grid-template-rows`.

---

## Optimistic CRUD

- **Edits persist through the house CRUD route pattern** (../backend-patterns.md): `withAuth(handler, { permission })`
  → validate → domain helper → map 404/409/200 → `recordAudit()` → `after()` side-effects. The
  `/api/sku-catalog/[id]/qc-checks` and `/api/sku-catalog/[id]/kit-parts` routes are the reference; the view stays
  thin and dumb.
- **Optimistic update, then reconcile.** The TanStack Query contract is `onMutate` (snapshot + apply) → `onError`
  (rollback to snapshot) → `onSettled` (`invalidateQueries`) — https://tanstack.com/query/v4/docs/react/guides/optimistic-updates.
  Thread a `clientEventId` so a retry on a flaky network is an idempotent no-op
  (`UNIQUE(client_event_id)`, ../backend-patterns.md).
- **Deletes are confirm-then-commit, never optimistic.** A removed row that resurrects on rollback is worse than a
  half-second confirm.
- **Gap to close: today's CRUD sections are refresh-after-mutation, not truly optimistic.** `QcChecklistSection`
  (`handleRemove` / `togglePublish` / save) and `KitPartsSection` `await fetch(...)` then call `onRefresh()` (which
  `invalidateQueries(['sku-qc-checks', skuId])`). Correct and safe, but it shows a spinner gap instead of an instant
  edit. Migrating these to `onMutate`/rollback is the improvement; keep `onSettled → invalidate` either way.

---

## Progressive disclosure of related / similar

- **Siblings appear *below* the picker once a record is selected — they augment the map, never replace it.** Surface
  related/similar (e.g. `/api/sku-catalog/[id]/similar`) as a "Similar" group that materializes under the picker on
  selection, or a slim footer rail under the editor. This is textbook progressive disclosure
  (https://www.interaction-design.org/literature/topics/progressive-disclosure) — the picker stays the primary
  navigator; siblings are secondary, revealed only when there's a record to be similar *to*.
- **Cross-links are inline, not a replacement.** `QcChecklistWorkspace` ↔ `KitPartsWorkspace` link to each other with
  a header chip (`router.replace('/products?view=kit&skuId=…')`) showing the sibling's count — a contextual jump, not
  an inverted sidebar.

---

## Gap notes (to close)

- **Add a cmd-K launcher** that fuzzy-jumps to `?skuId=` and fires CRUD actions (command-palette pattern:
  https://uxpatterns.dev/patterns/advanced/command-palette). **It must not collide with the F2 scan hotkey**
  (`src/lib/scan-hotkey/store.ts`, default F2, claimed by the last-registered scan target) — bind cmd-K / ctrl-K only,
  and never grab a function key the Station archetype owns.
- **Push filters/sort/search fully into the URL** (see URL-as-state) so deep links survive a reload.
- **Migrate CRUD sections from refresh-after to optimistic `onMutate`/rollback** (see Optimistic CRUD).

---

## Do / Don't

| Do | Don't |
|---|---|
| Compose `SidebarShell` / `SidebarRailShell`; supply only renderers | Fork a new list component or hand-position the search band |
| Write selection + mode to `searchParams` (`router.replace`) | Hold selection in local `useState` (breaks deep-link + reload) |
| Crossfade the right pane keyed on selection id (opacity + small-y) | Crossfade the list/map — keep it mounted and still |
| Keep the table mounted `display:none` to preserve cache + scroll | Unmount the list on selection (loses scroll + re-fires effects) |
| Branch empty copy by type (first-use / no-results / loading / error) | Ship a bare "Nothing here" empty state |
| Isolate each sub-resource in its own try/catch; degrade to empty | Let a failing sibling fetch 500 the whole record |
| Surface similar/related *below* the picker on selection | Invert the sidebar to put related items where the picker belongs |
| Confirm-then-commit deletes; optimistic for add/edit | Optimistically delete a row (resurrects on rollback) |
| Route motion through `useMotionTransition`/`useMotionPresence` | Hardcode a cubic-bezier or animate width/height/padding |

---

Indexed by ../contextual-display.md
