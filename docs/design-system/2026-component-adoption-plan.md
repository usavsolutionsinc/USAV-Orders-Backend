# 2026 Component Adoption Plan

> Migrating the USAV Orders Backend UI onto a modernized, consistent component
> set. Every component is prototyped **live** in the showroom at `/design-demo`
> (`src/app/design-demo/`). This document is the plan to promote each one out of
> the showroom and into the design system, then retire the hand-rolled versions.

**Status:** Draft / not started · **Owner:** _you_ · **Branch:** `main` (per repo convention)
**Showroom route:** `/design-demo` → `src/app/design-demo/page.tsx` + `_gallery/sections.tsx`

---

## Why this exists

The app already ships a mature 3-layer design system (`src/design-system/primitives`,
`src/design-system/components`, `src/components/ui`) plus Tailwind 3.4, Framer
Motion 11, Sonner, and a full CSS-variable token set with light/dark themes.

The problem is **incomplete adoption, not a missing system**:

- Overlays are hand-rolled everywhere (`fixed inset-0 z-[80]` repeated per modal).
- ~6 tables are bespoke sticky-header markup with no shared family.
- Buttons split between the `PrimaryButton` primitive and ad-hoc `<button>`.
- Typography mixes design-system presets with 145+ arbitrary `text-[...]` values.
- The semantic tokens (`surface-card`, `text-default`, `border-soft`…) exist but
  are barely referenced — which is why dark mode effectively isn't exercised.

This plan closes those gaps using the components proven in `/design-demo`.

### Guiding principles

1. **Promote, don't rebuild.** Each showroom component moves to a real path with
   minimal change. The showroom `<Bay>` header already names that path.
2. **Token-first.** Promoted components use semantic tokens
   (`bg-surface-card`, `text-text-default`, `border-border-soft`) so they theme
   for free. No per-component `dark:` classes.
3. **Strangler pattern.** Land the primitive, migrate call sites incrementally,
   delete the old markup last. Never a big-bang rewrite.
4. **One canonical per concern.** After migration there is exactly one Button,
   one Dialog, one DataTable, one Tab. Lint/grep guards prevent regressions.
5. **Main branch, small PRs.** One component (or one call-site batch) per PR.

### Effort / risk legend

`S` ≤0.5d · `M` ~1–2d · `L` ~3–5d · risk **Low/Med/High** = blast radius if it breaks.

---

## Phasing overview

| Phase | Theme | Sections | Rationale |
|------|-------|----------|-----------|
| **0** | Foundations | tokens, lint guards | Make tokens real before anything leans on them |
| **1** | Primitives | 01 Buttons, 03 Inputs, 02 Tabs | Low-risk, high-frequency, unblock everything else |
| **2** | Overlays | 05 Dialog / Command / Popover / Tooltip | Highest duplication; biggest consistency win |
| **3** | Data | 04 DataTable, StatCards | Largest surface; depends on Phase 1 primitives |
| **4** | Feedback & polish | 06 Feedback, 07 Motion | Cross-cutting finish pass |

Recommended order: **0 → 1 → 2 → 3 → 4**. Phases 1 and 2 can overlap; 3 should
wait on 1 (the table uses Button/Checkbox/StatusPill).

---

## Phase 0 — Foundations (do first)

Before promoting components, make the token layer load-bearing.

- [ ] **Confirm dark-mode strategy.** Decide manual toggle vs. `media`. Tailwind
      `darkMode` is currently default (`media`). If a manual app-wide toggle is
      wanted, set `darkMode: ['selector', "[data-theme='dark']"]` in
      `tailwind.config.ts` and drive `data-theme` from a ThemeProvider. The
      showroom proves token-based theming already works via `[data-theme='dark']`.
- [ ] **Adopt semantic token utilities** as the default for new/touched surfaces:
      `bg-surface-card`, `bg-surface-canvas`, `text-text-default`,
      `text-text-muted`, `border-border-soft`.
- [ ] **Centralize z-index.** Add a `z-index` scale (already stubbed at
      `src/design-system/tokens/z-index.ts`) — `backdrop`, `modal`, `popover`,
      `tooltip`, `toast`. Replaces the `z-[80]/z-[81]` magic numbers.
- [ ] **Lint guards** (ESLint `no-restricted-syntax` / a custom rule or grep CI):
      flag new raw `<button>`, new `fixed inset-0 z-[` modals, and `text-[Npx]`
      where a preset exists. Guards are what keep adoption from regressing.
- [ ] **Shared spring tokens.** Export the showroom's `spring` / `softSpring`
      into `src/design-system/foundations/motion-framer.ts` so every promoted
      component shares one motion vocabulary.

**Exit criteria:** tokens documented as the default, z-index scale in use, CI
guard in place.

---

## Phase 1 — Primitives

### 01 · Buttons & actions  — `Upgrade` · `M` · risk Med

**Target:** `src/design-system/primitives/Button.tsx` (consolidate with existing
`PrimaryButton`, `IconButton`).

- Variants: `primary | brand | secondary | ghost | danger`; sizes `sm|md|lg`
  (mode-aware, keep the 44px mobile promotion from `PrimaryButton`).
- Built-in `loading`, `icon`, `iconTrailing`; spring press (`whileTap`).
- API: real `onClick`/`type`/`disabled` props (the showroom's inner-`<span>`
  click hack is demo-only — do **not** carry it over).

**Migration targets (grep `<button className` + `PrimaryButton`):**
`src/components/DashboardSidebar.tsx`, all `src/components/sidebar/*`,
`QuarterSelector`, form submit buttons, modal footers.

- [ ] Land `Button` primitive + stories in showroom (already prototyped)
- [ ] Codemod/grep the ad-hoc `<button>` call sites in batches by directory
- [ ] Fold `PrimaryButton` into `Button` (or re-export as thin alias) and deprecate
- [ ] Lint guard: no new raw `<button>` outside primitives

**Acceptance:** one Button import path; visual parity on dashboard + a sidebar;
loading state replaces manual disable+spinner wiring in ≥3 forms.

### 03 · Inputs  — `New`/`Upgrade` · `M` · risk Med

**Targets:** `src/design-system/primitives/TextField.tsx` (floating label),
upgrade `SearchField.tsx` (clearable), `src/design-system/primitives/Switch.tsx`.

**Migration targets:** `src/design-system/components/FormField.tsx` wrappers,
`src/design-system/primitives/sidebar-intake/*`, admin forms, the many bespoke
search inputs.

- [ ] Land `TextField` (floating label, focus ring, error state) + `Switch`
- [ ] Add clearable + leading-icon support to `SearchField`
- [ ] Migrate sidebar-intake forms first (most inconsistent), then admin forms
- [ ] Standardize focus ring + error styling via tokens

**Acceptance:** sidebar and admin forms share one field style; one search input.

### 02 · Segmented tabs  — `Upgrade` · `S` · risk Low

**Target:** add a `layoutId` sliding-indicator variant to the existing
`TabSwitch` (`src/components/ui/TabSwitch.tsx`) — the design-system hard rule
already routes all tab UI through this component, so this upgrades every tab at once.

- [ ] Add animated indicator (respect `useReducedMotion`)
- [ ] Verify dashboard view switcher (Pending/Shipped/Unshipped/FBA) + any
      `HorizontalButtonSlider` usages
- [ ] No API change — purely additive

**Acceptance:** active pill animates app-wide; reduced-motion falls back to instant.

---

## Phase 2 — Overlays (highest-value)

### 05 · Dialog  — `New` · `L` · risk High

**Target:** `src/design-system/components/Dialog.tsx` — focus-trap, ESC +
click-outside, blurred backdrop, spring scale-in, scroll-lock, `AnimatePresence`,
z-index from the token scale. Consider `@radix-ui/react-dialog` as the
accessibility engine (focus trap / aria) styled with tokens — evaluate vs.
hand-rolled; the app currently has no Radix dependency.

**Migration targets (every hand-rolled modal):**
`src/components/fba/FbaCreatePlanModal.tsx`, `src/components/auth/StepUpModal.tsx`,
`src/components/sidebar/OrderSyncDialog.tsx`, manual CRUD modals, and anything
matching `fixed inset-0 z-[8`.

- [ ] Decide: Radix primitive vs. hand-rolled (recommend Radix for a11y)
- [ ] Land `Dialog` + `Dialog.Footer`/`Dialog.Header` slots
- [ ] Migrate one modal end-to-end as the reference (suggest `OrderSyncDialog`)
- [ ] Migrate remaining modals in batches; delete per-file backdrop markup
- [ ] Lint guard: no new `fixed inset-0 z-[` overlays

**Acceptance:** zero bespoke modal backdrops; focus trap + ESC verified; keyboard
accessible.

### 05 · Command palette (⌘K)  — `Upgrade` · `M` · risk Med

**Target:** surface the existing `src/components/CommandBar.tsx`. Make it
globally discoverable from `GlobalHeaderActions`, wire real navigation/actions.

- [ ] Bind `⌘K`/`Ctrl-K` globally; add a header entry point
- [ ] Populate commands from the route registry + common actions
- [ ] Fuzzy filter + keyboard nav (arrows/enter)

**Acceptance:** `⌘K` opens from any page; top routes + actions reachable.

### 05 · Popover & Tooltip  — `New` · `M` · risk Med

**Targets:** `src/design-system/primitives/Popover.tsx`,
`src/design-system/primitives/Tooltip.tsx`. Use a positioning lib
(`@floating-ui/react`) or Radix Popover/Tooltip rather than the current
`style={{position:'fixed', top, left}}` hand-positioning.

**Migration targets:** `src/components/ui/ViewDropdown.tsx`, dropdown menus,
any inline-positioned popovers.

- [ ] Land Popover (positioned, dismiss-on-outside) + Tooltip (delay, arrow)
- [ ] Migrate `ViewDropdown` off inline `style` positioning
- [ ] Add tooltips to icon-only action buttons (a11y win)

**Acceptance:** no inline `position:fixed` positioning hacks; tooltips on
icon-only controls.

---

## Phase 3 — Data display

### 04 · DataTable family  — `New` · `L` · risk High

**Target:** `src/design-system/components/DataTable/` — `DataTable`, `Header`,
`Row`, `Cell`, plus selection, sticky header, density prop, empty/loading slots,
row-enter animation, sortable headers. Evaluate **TanStack Table** as the
headless engine (sorting/selection/virtualization) styled with tokens —
recommended given the table count and row volume.

**Migration targets (each is bespoke today):**
`src/components/PendingOrdersTable.tsx`,
`src/components/unshipped/UnshippedTable.tsx`,
`src/components/dashboard/FBAShipmentsTable.tsx`,
`src/components/TechTable.tsx`, `src/components/PackerTable.tsx`.

- [ ] Land `DataTable` with selection + status pills + density (prototyped)
- [ ] Add `StatusPill` shared component (used by table + cards)
- [ ] Migrate `UnshippedTable` first (detail-panel pattern) as reference
- [ ] Migrate remaining tables; preserve realtime (Ably) row updates
- [ ] Add virtualization where row counts are large
- [ ] Wire empty/loading states to the shimmer skeleton (Phase 4)

**Acceptance:** all order tables share the family; sticky header + selection +
density consistent; realtime updates intact; no regression in row interactions.

### 04 · Stat cards (sparkline + animated counter)  — `New` · `S` · risk Low

**Target:** upgrade `src/design-system/components/StatCard.tsx` with an inline
SVG sparkline, trend delta, and an animated number counter.

**Migration targets:** dashboard/reports metric cards,
`src/features/operations/components/SupportOverviewCard.tsx`,
`src/components/admin/overview/*`.

- [ ] Add `data`/`delta` props + `Sparkline` subcomponent
- [ ] Animated counter (respect reduced-motion)
- [ ] Roll into reports + overview dashboards

**Acceptance:** metric cards show trend + sparkline; counters animate once on mount.

---

## Phase 4 — Feedback & motion polish

### 06 · Feedback  — `Mixed` · `M` · risk Low

- **Toasts** (`have`): Sonner is already global (`src/components/Providers.tsx`,
  `src/lib/toast.ts`). Action item is **consistent usage** — success/error/promise
  patterns documented, not re-implemented per feature.
- **Shimmer skeletons** (`upgrade`): upgrade `src/design-system/components/Skeletons.tsx`
  from pulse to a moving-highlight shimmer; wire into Suspense fallbacks + DataTable loading.
- **Empty state** (`upgrade`): polish `src/components/ui/EmptyState.tsx` with
  illustration slot + primary CTA.
- **Inline notice** (`new`): `src/design-system/components/InlineNotice.tsx` —
  one error/warning/info banner (failed syncs, validation, missing tracking).

- [ ] Document toast usage patterns; sweep ad-hoc `alert()`/inline error text
- [ ] Ship shimmer skeleton; replace flat-pulse loaders
- [ ] Ship `InlineNotice`; adopt in sync/integration error paths
- [ ] Empty-state CTA pass on key zero-states (orders, search results)

**Acceptance:** one banner component for errors/warnings; shimmer loaders on key
async surfaces; documented toast conventions.

### 07 · Motion lab  — `New` · `M` · risk Low

Adopt the proven Framer patterns where they add clarity (not everywhere):

- **Shared-element expand** (`layoutId`) → detail-panel reveals on tables.
- **Spring press** (`whileTap`) → already in Button; extend to cards/toggles.
- **Stagger reveal** (`staggerChildren`) → freshly-loaded queues/lists.

- [ ] Export shared spring + presence presets (Phase 0) and use everywhere
- [ ] Apply shared-element transition to one detail panel as reference
- [ ] Add stagger to order-queue mount
- [ ] Audit with the `motion` skill for jank/`prefers-reduced-motion`

**Acceptance:** consistent motion vocabulary; reduced-motion respected globally.

---

## Cross-cutting workstreams

- **Accessibility:** focus traps (Dialog), `aria-label` on icon buttons,
  keyboard nav (Command/Popover/Table), visible focus rings, reduced-motion.
  Use the `audit` and `a11y-debugging` skills per phase.
- **Theming:** every promoted component token-only; verify each in dark mode in
  the showroom before merging.
- **Typography:** opportunistically migrate `text-[Npx]` → presets
  (`sectionLabel`, `fieldLabel`, `dataValue`, `tableHeader`, `microBadge`) when
  touching a file.
- **Testing:** Playwright E2E for Dialog open/close/ESC, Command palette, table
  selection (use the `e2e-spec-writer` agent). Visual check via the showroom.
- **Dependencies to evaluate:** `@radix-ui/react-{dialog,popover,tooltip}`,
  `@floating-ui/react`, `@tanstack/react-table`. Decide per phase; prefer
  headless + token styling over fully-styled libs.

---

## Decisions to lock before starting

| # | Decision | Options | Default recommendation |
|---|----------|---------|------------------------|
| D1 | Dark mode | `media` vs. manual `selector` toggle | Manual `selector` + ThemeProvider |
| D2 | Overlay engine | Radix vs. hand-rolled | Radix (a11y) styled with tokens |
| D3 | Table engine | TanStack Table vs. hand-rolled | TanStack (volume + features) |
| D4 | Positioning | Floating UI vs. Radix vs. manual | Floating UI or Radix |
| D5 | Button consolidation | New `Button` vs. extend `PrimaryButton` | New `Button`, alias old |

---

## Master tracking checklist

- [ ] **P0** Foundations: dark-mode decision, token defaults, z-index scale, lint guards, shared springs
- [ ] **01** Button primitive + call-site migration + `PrimaryButton` alias
- [ ] **03** TextField + Switch + SearchField clearable + form migration
- [ ] **02** TabSwitch sliding-indicator variant
- [ ] **05** Dialog primitive + migrate all hand-rolled modals
- [ ] **05** Command palette surfaced (⌘K global)
- [ ] **05** Popover + Tooltip + ViewDropdown migration
- [ ] **04** DataTable family + migrate 5 tables + StatusPill
- [ ] **04** StatCard sparkline + animated counter
- [ ] **06** Shimmer skeleton + InlineNotice + EmptyState + toast conventions
- [ ] **07** Motion presets + shared-element + stagger + reduced-motion audit
- [ ] **Cleanup** Delete `src/app/design-demo` showroom once everything is promoted

---

## Reference

- Live prototypes: `/design-demo` → `src/app/design-demo/_gallery/sections.tsx`
- Design system: `src/design-system/` · `src/design-system/DESIGN_SYSTEM.md`
- Tokens: `src/design-system/tokens/` · `src/styles/globals.css` (theme vars)
- Rules: `.design-system-rules.md`
- Toasts: `src/lib/toast.ts` · `src/components/Providers.tsx`
