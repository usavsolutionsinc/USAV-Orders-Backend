# Dashboard (/dashboard) — Full UX & Design Critique + Improvement Plan

**Date:** 2026-07-06  
**Surface:** `/dashboard` (Orders / Shipping hub) — the primary operator + manager daily surface.  
**Scope:** Entire experience: GlobalHeader + DashboardSidebar (MasterNav + context) + main content (4 sub-views) + details panels + supporting cards, search, realtime, bulk, loading/empty states.  
**Method:** Project house rules (Claude.md, ui-design-system.md, contextual-display.md, source-of-truth.md, motion rules) + standard UX lenses (IA, visual hierarchy, interaction design, consistency, feedback, accessibility, performance). Cross-checked against existing components (SwimlaneBoard, HorizontalButtonSlider, SidebarShell, etc.).

---

## Executive Summary

The dashboard is a mature, high-utility Workbench with strong URL-as-state discipline, realtime updates, virtualization, code-splitting, and bulk operations. It has evolved into a multi-view hub (Unshipped fulfillment queue, Shipped outbound, FBA, Warranty) with a rich sidebar.

**Strengths:**
- Excellent state modeling (search params drive everything cleanly).
- Realtime + optimistic cache patches are production-grade.
- Reuses many canonical primitives (HorizontalButtonSlider, SwimlaneBoard, ToolbarButton, etc.).
- Good performance engineering (virtual lanes, dynamic imports, BootGate warmup).

**Primary issues (high impact):**
1. **Design system drift** — heavy use of raw `blue-*`, `red-*`, `emerald-*` Tailwind shades instead of semantic tokens. Violates "Color only from semantic tokens".
2. **Motion & empty-state inconsistency** — `OrderSearchEmptyState` (and callers) use raw motion + custom springs + non-canonical visuals. Several spinners hard-code blue.
3. **Archetype & rail purity** — Unshipped is intentionally a monitor-like swimlane pipeline inside a Workbench. Sidebar does not compose `SidebarRailShell`. Acceptable in context but undocumented and inconsistent with other workbenches.
4. **Information architecture & view fragmentation** — Four views have different mental models (pipeline board vs list vs lookup + table vs coverage card + table). Switching cost is high; some views (FBA, Warranty) feel bolted on.
5. **Under-use of global header contextual zone** and inconsistent header chrome across the four sub-views.
6. **Visual hierarchy & polish gaps** — No prominent page-level title/identity in main area for some views. Empty states, loaders, and banners vary in quality and color.

**Overall UX quality:** Functionally strong (8/10). Visual & system consistency: 5.5/10. Room for a focused "tighten & align" pass to bring it to the level of newer surfaces (studio, receiving).

---

## Surface Map (Information Architecture)

**Layout**
- Persistent 40px `GlobalHeader` (sidebar toggle, goal chip, contextual zone from `useHeader`, global actions).
- Fixed 360px left `DashboardSidebar` (desktop) / drawer (mobile).
- Main content: flex row of `<DashboardOrdersView>` (board/list) + `<DashboardOrderDetails>` (slide-in).

**Sidebar (via `DashboardOrdersContextPanel` + `SidebarShell` + MasterNav)**
- Master nav rail (when enabled).
- Sub-view switcher (Unshipped / Shipped / Warranty Logger) via `HorizontalButtonSlider` (legacy fallback in panel).
- Per-view sidebars:
  - Unshipped: search, staff filter, stage facets, status legend, handoff cards (Shipped/Labels), FirstScanOnboardingCard, ThroughputRoiCard, recent searches, import.
  - Shipped: similar + intake form.
  - Warranty: coverage lookup card lives in main; sidebar carries filters.
  - Default/Management: import, sync, search history.
- Intake form (`?new=true`) replaces panel content.

**Main Content Views (driven by `?view` / `?shipped` / `?fba` / `?warranty` etc.)**
1. **Unshipped** (default): SwimlaneBoard (PENDING/TESTED/BLOCKED lanes derived, not assigned) with `OrdersQueueTable` bodies. Per-lane sort, staff filter, virtualization.
2. **Shipped**: SwimlaneBoard (Outbound states) or "All" list + `DateRangeHeader` / period controls + grouping.
3. **FBA**: Tabular list of shipments with readiness bars, status badges, remove actions. Lighter monitor feel.
4. **Warranty**: `WarrantyCoverageCard` (search-driven lookup) + `WarrantyClaimsTable` + slide-in `WarrantyClaimDetailPanel`.

**Selection & Details**
- URL-driven selection for unshipped/shipped.
- FBA and Warranty manage their own `?open*` details.
- Bulk selection (pencil mode) + `ContextualSelectionBar`.

**Cross-cutting**
- Realtime (Ably) → targeted React Query patches.
- Search is URL `?search=` and shared between sidebar + main.
- Saved views per sub-surface.
- Boot splash on fresh sign-in that warms the active view.

---

## Detailed Critique

### 1. Information Architecture & Navigation
**Strengths**
- URL is the source of truth; deep-linkable, refresh-safe, shareable.
- Clear separation: sidebar owns filters/scope, main owns the working set + detail.
- `HorizontalButtonSlider` used for the three main order sub-views.

**Issues**
- Four views have mismatched metaphors:
  - Unshipped = pipeline (board)
  - Shipped = pipeline or flat list + time
  - FBA = list + progress bars (monitor-ish)
  - Warranty = lookup card + table (hybrid)
- No single "Orders" overview or cross-view rollup.
- FBA lives under dashboard but has its own top-level route `/fba` elsewhere — duplication risk.
- Switching views resets a lot of mental context (different columns, different filters, different detail behavior).
- Sidebar switcher is hidden behind master-nav flag in some paths, causing discoverability variance.

**Risk:** High context-switching cost for daily operators who live in Unshipped ↔ Shipped.

### 2. Visual Hierarchy & Layout (House Style)
**Strengths**
- Linear vertical scaffolds inside lanes and sidebars.
- Good use of `PaneHeader`, `DateRangeHeader`, `ToolbarButton`, `StatusLegend`.
- One-row anatomy respected in many table rows.

**Issues**
- Main content area often lacks a clear, sticky, eyebrow-style title for the current view when GlobalHeader contextual zone is empty.
- Swimlane headers and board toolbars are good but vary slightly from other workbenches.
- GlobalHeader's left contextual zone is under-used by the dashboard tables (no consistent "Unshipped (N)" or mode chips pushed up).
- Some banners (`QueueTableBanner`, management cards) use direct `text-blue-700` and custom gradients.
- Selection states are close to spec (`bg-blue-50...`) but not identical everywhere.

### 3. Design System & Color Tokens (Major Violation)
Multiple files use arbitrary Tailwind colors instead of `src/design-system/tokens/colors/semantic.ts`:

- `text-blue-600/700/500`, `bg-blue-600`, `border-blue-200/100`, `from-blue-50`, `bg-blue-50/xx`, `focus:border-blue-500`.
- `bg-red-50`, `text-red-400` in empty state.
- `bg-emerald-500` (progress), `bg-emerald-50/rose-50` in ThroughputRoiCard (these are closer to semantic surfaceSubtle but still raw).
- Spinners: `text-blue-600`, `text-blue-500`.
- Buttons and active states in popovers, staff filter, onboarding card, queue banners.

**Allowed exception:** Selection `bg-blue-50 ring-blue-*` (documented).

**Impact:** High — surface no longer looks like it belongs to the same system as studio, receiving, products.

### 4. Motion, Animation & Feedback
**Strengths**
- `OrdersQueueTableRow` correctly uses `framerPresence.tableRow`.
- Details use `AnimatePresence`.
- SwimlaneBoard presumably handles its own layout/motion.

**Issues**
- `OrderSearchEmptyState.tsx`: raw `motion.div` + `motionBezier` + spring + scale + hardcoded red circle. Bypasses `useMotionPresence` / `useMotionTransition` + canonical presets. Reduced-motion will not be handled correctly.
- Several loaders and banners use ad-hoc opacity/scale.
- Crossfade target is correct (right pane for details), but some internal cards animate raw.
- No visible "act-and-clear" feedback on some bulk or status changes beyond toasts.

### 5. Empty, Loading, Error & First-Run States
**Strengths**
- Dedicated `OrdersFirstRunEmptyState`, `ShippedTableEmptyState`, search handoff cards.
- BootGate + warmup splash is thoughtful.

**Issues**
- `OrderSearchEmptyState` is visually inconsistent (red icon circle vs dashed teaching boxes used elsewhere).
- Multiple hard-coded blue spinners in loading states (`WarrantyClaimsTable`, `OrdersQueueTable`, `DashboardOrdersView`, etc.).
- FBA table has minimal empty/loading treatment visible in quick scan.
- "No results this week" vs search-empty vs out-of-scope suggestions are handled but with different visual languages.
- Error states are mostly unremarkable (standard query error).

### 6. Interaction Design & Feedback
**Strengths**
- Bulk selection + ContextualSelectionBar is clean.
- Per-lane sort persistence, column config, saved views are power-user friendly.
- Realtime patches feel instant.

**Issues**
- Select mode toggle lives in the board toolbar but the affordance is not always obvious on first use.
- FBA and Warranty have their own selection/detail models that do not participate in the shared dashboard bulk scope.
- Intake form (`?new=true`) is a mode that replaces the whole sidebar panel — good, but discoverability relies on a small + icon.
- Drag-reorder / resize in boards is powerful but has a learning cost (no first-use education beyond the board itself).

### 7. Performance & Technical
**Strengths**
- Virtualization (canary + full), dynamic imports for non-default views and details, prefetch warmup, targeted cache patches.
- Good separation of concerns in hooks.

**Minor**
- Some queries still fetch broad sets; limit + "load more" is in progress for unshipped.
- FBA query appears full for the period.

### 8. Accessibility, Mobile, Polish
- Good ARIA on many controls; `HoverTooltip` used.
- Mobile drawer for sidebar is present.
- 40px header + dense rows are information-dense (good for ops, requires care for contrast and tap targets).
- Some icon-only buttons in toolbars could benefit from more consistent labels.

---

## Prioritized Improvement Plan

### Phase 0 — Immediate (1–2 days, high visual impact, low risk)
1. **Color token normalization pass**
   - Audit all `blue-*`, `red-*`, `emerald-*` (except documented selection) in:
     - `src/components/dashboard/**`
     - `src/components/unshipped/**` (UnshippedSidebar, UnshippedShelfBoard, OrdersSyncPopover, etc.)
     - `src/components/shipped/dashboard-table/**`
     - `src/components/warranty/**`
   - Replace with semantic tokens or status tone utilities (`condition-tone.ts` style or lifecycle dots).
   - Make spinners use `text-text-muted` or a token.
   - Update `ThroughputRoiCard`, `FirstScanOnboardingCard`, `QueueTableBanner`, empty states, staff filter active states, buttons.

2. **Fix the empty state motion & visuals**
   - Refactor `OrderSearchEmptyState` (and `ShippedTableEmptyState` usage) to use canonical motion hooks + a standard dashed teaching box.
   - Align "not found" treatment with project empty pattern.

3. **Standardize loaders**
   - Create or reuse a `<DashboardBusy />` or use existing `Loader2` with consistent class (no blue).

### Phase 1 — Consistency & Polish (1 week)
4. **Header & view identity**
   - Have each dashboard sub-view (or the view component) push a contextual title / count / mode chip into the GlobalHeader via `useHeader` / `usePageHeader` so the 40px bar always identifies the current view.
   - Make Unshipped / Shipped / FBA / Warranty headers visually consistent (height, divider, busy indicator placement).

5. **Document archetype intent**
   - Add clear comments in `UnshippedShelfBoard.tsx`, `UnshippedTable.tsx`, and `DashboardOrdersContextPanel.tsx` explaining the intentional "pipeline workbench" hybrid and why `SidebarRailShell` is not composed here.

6. **Unify empty / first-run / search states**
   - Promote a small shared `DashboardEmptyState` family (first-run, no-results, search-empty, out-of-scope) that all four views use.
   - Ensure they degrade gracefully and teach next actions.

7. **Selection state exact match**
   - Align all row selection classes to the documented `bg-blue-50 ring-1 ring-inset ring-blue-400` (or the closest token equivalent) without size shift.

### Phase 2 — IA & Navigation Improvements (medium effort)
8. **Clarify the four views**
   - Consider (or document) a clearer mental model: "Fulfillment Queue" (unshipped) vs "Completed / History" (shipped) vs "FBA Pipeline" vs "Warranty Support".
   - Evaluate whether FBA and Warranty should remain under `/dashboard` or become first-class top-level sections with their own sidebars (they already have some).

9. **Improve view switching discoverability**
   - Ensure the `HorizontalButtonSlider` (or MasterNav mode rail) is always visible and consistent for the four dashboard sub-views.
   - Consider a persistent "Orders" summary strip or quick stats when on FBA/Warranty.

10. **Cross-view search & handoff**
    - Strengthen the search handoff cards (already exist) and make "found in another view" suggestions more prominent and one-click.

11. **Bulk & selection scope**
    - Decide and document whether FBA/Warranty should join the shared `DASHBOARD_ORDERS_SELECTION_SCOPE` or keep private scopes. Make behavior predictable.

### Phase 3 — Deeper UX & Power Features (backlog)
12. **First-use & education**
    - Lightweight onboarding for board features (lane drag, per-lane sort, staff filter, select mode) — perhaps a one-time dismissible hint or improved empty state.

13. **Monitor vs Workbench tension**
    - If the Unshipped board is primarily "observe + act", consider whether a pure Monitor reading (timeline + KPIs) should be a separate tab or lens.

14. **Performance hardening**
    - Finish pagination story for shipped/FBA.
    - Add skeleton or progressive loading that matches the final row density.

15. **Accessibility audit pass**
    - Focus order through board + detail.
    - Ensure all icon-only toolbar buttons have proper labels/tooltips.
    - Keyboard navigation in swimlanes (arrow between lanes/rows).

---

## Recommended Next Steps (Actionable)

1. **Today / this session**: Run a color + spinner + empty-state fix pass (Phase 0). This gives the biggest visual "it belongs here" win.
2. Create a small shared `DashboardViewHeader` or push consistent content to GlobalHeader for all four views.
3. Add the archetype-intent comments so future contributors don't "fix" the hybrid shape.
4. After Phase 0+1, do a quick before/after visual review (or screenshot diff) of Unshipped vs Shipped vs FBA vs Warranty.
5. Consider a follow-up `/critique` or `audit` pass focused only on FBA and Warranty sub-surfaces once the base tokens/motion are aligned.

---

## Files Most Needing Attention (from this review)

- `src/components/dashboard/OrderSearchEmptyState.tsx`
- `src/components/dashboard/FirstScanOnboardingCard.tsx`
- `src/components/dashboard/ThroughputRoiCard.tsx`
- `src/components/dashboard/OrdersQueueTable.tsx` + `orders-queue/*`
- `src/components/unshipped/UnshippedSidebar.tsx`, `UnshippedShelfBoard.tsx`, `OrdersSyncPopover.tsx`
- `src/components/shipped/dashboard-table/*` (headers, empty, loaders)
- `src/components/warranty/*` (loaders, cards)
- `src/components/DashboardOrdersView.tsx`, `DashboardOrderDetails.tsx`
- `src/hooks/useDashboardSearchController.ts` (for any header integration)
- Global layout files if header contextual zone needs extension: `GlobalHeader.tsx`, `ResponsiveLayout.tsx`

---

**End of critique.** This plan can be turned into GitHub issues or a phased execution using the project's `execute-plan` / `execute-task` flows if desired.

---

# Addendum — Design-Director Critique (evidence-backed, 2026-07-06)

> Produced via the `/critique` skill after a three-agent code audit (color-token inventory, motion/empty/loader
> inventory, IA/structure map). Every claim below is anchored to a real `file:line`. Design context confirmed from
> `.impeccable.md`: **internal FBA/warehouse operators; utilitarian, direct, calm; brutally simple, icon-first,
> restrained color.** This addendum supersedes the impressionistic Phase 0/1 notes above where they conflict, and adds
> the concrete mapping + file targets needed to execute.

## Anti-Patterns Verdict — does this look AI-generated?

**Mostly no — and that's the point.** This is a dense, icon-first ops tool, not a 2024 SaaS landing page. It is free of
the classic AI tells: no gradient hero metrics, no glassmorphism, no purple-to-blue neon-on-dark, no identical card
grids, no centered-everything. The one exception worth naming: **`FirstScanOnboardingCard.tsx:78`** uses
`bg-gradient-to-br from-blue-50 to-white` with a `Sparkles` icon (`:84`) — that gradient-card-with-sparkle is the single
most AI-slop-flavored surface on the dashboard. Everything else fails a *different* test.

**The real "slop" here is not AI aesthetics — it is design-system entropy.** The dashboard has drifted off its own
token system so far that it no longer looks like one system. That is the dominant quality problem, and it is measurable:

- **27 files** carry raw Tailwind shades instead of semantic tokens (full inventory: color-audit section below).
- **Zero** dashboard files route motion through `useMotionPresence`/`useMotionTransition` — reduced-motion is silently
  unhandled across the whole surface.
- The **canonical dashed teaching box does not appear once**; the de-facto empty state is faint italic text at
  `opacity-20` (`OrdersQueueTable.tsx:333`, `ShippedTableEmptyState.tsx:65`, `ShippedLaneTable.tsx:86`) — text
  deliberately dimmed to near-invisibility is the opposite of "teach the next action."
- The **documented selection exception** (`bg-blue-50 ring-1 ring-inset ring-blue-400`) is applied **nowhere**; all
  three selection sites use a *different, non-sanctioned* string (`OrdersQueueTableRow.tsx:126` `bg-blue-50/80`,
  `WarrantyClaimsTable.tsx:71` bare `bg-blue-50`, `WarrantyLoggerSidebar.tsx:177` `ring-blue-200`). So even the *allowed*
  blue is wrong.

If you showed a designer the studio/receiving surfaces next to this one, they would not believe they came from the same
team. That is the gap to close.

## Overall Impression

Structurally excellent, cosmetically incoherent. The state modeling (bare-presence URL params in
`dashboard-search-state.ts:35-44`, shared `?openOrderId` scope, code-split views in `DashboardOrdersView.tsx:32-43`) is
genuinely strong engineering. But the surface reads as **four apps wearing four skins**: a swimlane pipeline
(Unshipped), a date-ranged board/list (Shipped), a loud purple bespoke banner table (FBA,
`FBAShipmentsTable.tsx:133-148`), and a coverage-card + plain table (Warranty). The single biggest opportunity is not a
redesign — it is a **normalization pass** that snaps color, motion, empty states, and page-identity back onto the
existing house primitives. High visual ROI, low behavioral risk.

## What's Working (keep, and copy from)

1. **URL-as-state discipline.** `dashboard-search-state.ts` + `useDashboardSearchController.ts` make every view
   deep-linkable and reload-safe, and correctly clear stale mode-private params on switch (`:60-63`). This is the
   Workbench contract done right.
2. **`ThroughputRoiCard.tsx` is the reference for the whole surface.** No motion it doesn't need, a *token-colored*
   loader (`:64-65`, `Loader2` inheriting `text-text-faint`), and it returns `null` rather than inventing an empty
   visual. Every other card should look this disciplined. **Copy this loader verbatim.**
3. **`OrdersQueueTableRow.tsx` already half-follows the motion law** — it consumes `framerPresence.tableRow` +
   `framerTransition.tableRowMount` (`:105-106`). It's the closest thing to a correct motion citizen; it just needs the
   reduced-motion hook and to drop the inline `whileHover`/`whileTap` literals (`:107-108`).

## Priority Issues (ordered by impact)

### P1 — Design-system color entropy (27 files)
- **What:** Raw `blue/red/emerald/rose/amber/purple/violet/teal/indigo/yellow` shades used pervasively for text,
  surfaces, borders, rings, buttons, spinners, and status dots instead of `semantic.ts` tokens.
- **Why it matters:** The house rule is "color only from semantic tokens" precisely so a theme change / dark mode / new
  palette flows everywhere at once. Every raw shade is a spot that will break under theming and that visually secedes
  from studio/receiving. Highest-leverage single file: **`warranty/chips.tsx:15-19`** — one tone map feeds every
  warranty chip.
- **Fix:** Apply the canonical mapping (below) across all 27 files. Snap the 3 selection rows to the *sanctioned*
  string. Re-grep to zero.
- **Command:** `/normalize` then `/colorize` (or the mechanical pass in the execution section).

### P2 — Motion & empty states bypass the house engine entirely
- **What:** `OrderSearchEmptyState.tsx:25-37` is fully-raw motion (inline `scale`/`y` + a **custom spring**
  `stiffness:300 damping:20` + `motionBezier`) wrapped around a **hardcoded red circle** (`bg-red-50` + `text-red-400`),
  and it is reused as the search-empty for *both* Unshipped (`OrdersQueueTable.tsx:322`) and Shipped
  (`ShippedTableEmptyState.tsx:44`). No dashboard file calls the reduced-motion hooks. Empty states are `opacity-20`
  italic text, not typed teaching boxes.
- **Why it matters:** Reduced-motion users get unguarded scale/spring animation (a WCAG 2.3.3 miss). A red "error" circle
  for a *no-results* state mislabels a normal outcome as a failure. Near-invisible empty copy teaches nothing.
- **Fix:** Rewrite `OrderSearchEmptyState` as a token dashed teaching box routed through `useMotionPresence`
  (`framerPresence.workbenchPane`) / `useMotionTransition`; branch copy by type (first-use / no-results / out-of-scope).
  Replace the three `opacity-20` empties with the same box.
- **Command:** `/animate` + `/harden` (reduced-motion), `/onboard` (empty-state copy).

### P3 — Loaders are a rainbow of hardcoded spinners
- **What:** ~14 spinners hardcode color — `text-blue-600/500` (`DashboardOrdersView.tsx:28,69`,
  `OrdersQueueTable.tsx:312`, `QueueTableBanner.tsx:43`, `ShippedTableHeader.tsx:27`, `WarrantyClaimsTable.tsx:26`,
  `WarrantyCoverageCard.tsx:31`, `WarrantyClaimDetailPanel.tsx:104`, `WarrantyTicketPopover.tsx:248/257/357`), and even
  `text-red-600` / `text-purple-600` in `FBAShipmentsTable.tsx:89,119`. A red spinner reads as an error, not a load.
- **Why it matters:** A busy indicator's color should be neutral chrome, not a semantic signal. Mixed spinner colors
  make "loading" look like a status.
- **Fix:** Every spinner → `<Loader2 className="h-4 w-4 animate-spin text-text-faint" />` (size preserved). Same file
  already proves it (`WarrantyCoverageCard.tsx:105` is correct while `:31` is not).
- **Command:** mechanical (execution section).

### P4 — Page identity is inconsistent across the four views
- **What:** No view pushes a title/count into the 40px `GlobalHeader` contextual zone (no `usePageHeader` consumer in
  the whole surface). Unshipped/Shipped intentionally suppress a main-area title (identity delegated to the sidebar
  rail — defensible), but **FBA** carries a loud bespoke purple banner (`FBAShipmentsTable.tsx:134-140`) and
  **Warranty** carries *nothing* (`WarrantyWorkspace.tsx:19-24`). Three different answers to one question.
- **Why it matters:** An operator switching Unshipped→FBA→Warranty gets a jarring change in where "where am I" lives.
  The FBA banner's `bg-purple-50` chrome doesn't share the board-toolbar language of the other three.
- **Fix:** Pick one identity model. Recommended: a shared, quiet `DashboardViewHeader` eyebrow (or push
  `usePageHeader('FBA Shipments', count)` into the global header) so all four read identically; retune FBA's banner to
  the shared toolbar language and tokenized fulfillment hue.
- **Command:** `/normalize` + `/arrange`.

### P5 — FBA is reachable but not discoverable
- **What:** The sidebar/rail switcher lists only **Unshipped · Shipped · Warranty Logger**
  (`DashboardOrdersContextPanel.tsx:36-40`, `sidebar-navigation.ts:415-418`). FBA is deliberately excluded
  (`sidebar-navigation.ts:408-410`) because `/fba` is its own top-level page — yet `?fba` still renders
  `FBAShipmentsTable` inside `/dashboard` with **no selection, no detail, no bulk scope** (`FBAShipmentsTable` has no
  `?open*` param and no row click). So the dashboard hosts a fourth view that has no entry point and no interaction
  model.
- **Why it matters:** A view you can only reach by hand-typing a URL, that then can't be interacted with, is dead
  weight that still has to be reasoned about. This is an IA decision, not a cosmetic one.
- **Fix (needs product sign-off — NOT auto-executed):** either (a) drop `?fba` from `/dashboard` entirely and let `/fba`
  own it, or (b) give it a rail entry + wire it into the shared selection/detail scope. Recommend (a).
- **Command:** `/distill` (remove) — but confirm intent first.

## Minor Observations
- `OrdersQueueTableRow.tsx:135` checkbox uses `border-blue-600 bg-blue-600 text-white` — tokenize to accent.
- The two `*SearchHandoffCard.tsx` files are near-identical templates differing only in hue (blue vs violet) — extract a
  shared `SearchHandoffCard` taking a tone prop (`/extract`).
- `FirstScanOnboardingCard` and `OrdersFirstRunEmptyState` both route through richer first-run visuals (gradient card /
  `EmptyState` medallion) rather than the dashed box — acceptable as *deliberate* first-run richness, but the gradient
  should still be tokenized.
- `WarrantyCoverageCard.tsx` disagrees with itself: `:31` hardcodes a blue spinner while `:105` correctly uses
  `text-text-faint`. Same file, two rules.

## Questions to Consider
- **What if the four views shared one identity strip?** A single quiet `Unshipped (N) · Shipped · FBA · Warranty` header
  that always sits in the same place would erase most of the "four apps" feeling for near-zero behavioral change.
- **Does FBA belong here at all?** If `/fba` is the real home, `?fba` on `/dashboard` is drift — remove it rather than
  invest in making it consistent.
- **Should the dashed teaching box become a real primitive?** The rule references a box that exists nowhere in `src`.
  Either promote `EmptyState` to render it, or add a `DashboardEmptyState` family so "no-results" stops being reinvented
  as dimmed italic text.

---

## Canonical color mapping (the cheat-sheet used for execution)

Raw shade → semantic utility. Alpha modifiers (`/70`, `/10`) are supported on themed utilities (see `tailwind.config.ts`
wrapper). **Exception, keep raw:** row selection = `bg-blue-50 ring-1 ring-inset ring-blue-400` (documented).

| Raw | → Semantic |
|---|---|
| `text-blue-400/500/600/700/900` | `text-text-accent` |
| spinner `text-blue-*` / `text-red-600` / `text-purple-600` | `text-text-faint` |
| `bg-blue-600` (solid CTA) + `text-white` | `bg-accent-bg` + `text-accent-text` |
| `bg-blue-50` / `bg-blue-50/70` | `bg-surface-accent` / `bg-surface-accent/70` |
| `border-blue-*` / `focus:border-blue-*` / `ring-blue-200` | `border-border-accent` / `focus:border-border-accent` / `ring-border-accent` |
| `text-emerald-600/700` | `text-text-success` |
| `bg-emerald-500` (dot/progress) | `bg-fill-success` |
| `bg-emerald-600 hover:bg-emerald-700` (button) | `bg-fill-success hover:bg-fill-success/90` |
| `bg-emerald-50` / `border-emerald-200` / `ring-emerald-200` | `bg-surface-success` / `border-border-success` / `ring-border-success` |
| `text-red-400/600` / `text-rose-600` | `text-text-danger` |
| `bg-red-50` / `bg-rose-50` | `bg-surface-danger` |
| `border-red-200` / `border-rose-100` / `ring-rose-200` | `border-border-danger` / `ring-border-danger` |
| `text-amber-500/600/700/800` / `text-yellow-600` | `text-text-warning` |
| `bg-amber-50/100` | `bg-surface-warning` |
| `bg-amber-600 hover:bg-amber-700` (button) | `bg-fill-warning hover:bg-fill-warning/90` |
| `border-amber-200/300` / `ring-amber-200` | `border-border-warning` / `ring-border-warning` |
| `bg-indigo-600 hover:bg-indigo-700` (button) | `bg-accent-bg hover:bg-accent-bg/90` |
| `text-purple-*` / `text-violet-*` | `text-text-fulfillment` |
| `bg-purple-50` / `bg-violet-50/70` (pastel) | `bg-fill-fulfillment/10` |
| `border-purple-*` / `border-violet-*` / `hover:bg-purple-50` | `border-fill-fulfillment/30` / `hover:bg-fill-fulfillment/10` |
| warranty `teal` chip | `bg-fill-info/10 text-text-info ring-fill-info/40` |

## Execution scope decision

- **EXECUTING NOW (display layer, low risk):** P1 color normalization (all 27 files), P2 empty-state + motion rewrite,
  P3 loader standardization, P4 view-identity/header consistency + archetype-intent comments.
- **NOT auto-executing (needs product decision):** P5 FBA discoverability/removal, and the Phase 2/3 IA restructuring
  (whether FBA/Warranty leave `/dashboard`). Flagged for sign-off.

**End of addendum.**
