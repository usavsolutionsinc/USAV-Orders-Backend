# Gemini Antigravity — Design System Theme Audit Report & Execution Plan

**Date:** 2026-07-04
**Based on:** `docs/gemini-antigravity-design-system-theme-audit-plan.md`

## 1. Executive Summary & Audit Findings

The audit scan of the codebase reveals substantial gaps between the desired state (a multi-theme, fully tokenized design system) and the current state. While the foundational structures (`src/design-system/tokens`) exist and some primitives are adopted, the reliance on ad-hoc Tailwind styling and a binary, override-heavy approach to theming prevents the system from easily scaling to the planned 8+ themes (e.g., `mono`, `cyberpunk`, `ember`).

### Key Metrics from Scan:
- **Raw Color Utility Overload:** The codebase contains **~10,795 instances** of direct raw color utility classes (e.g., `bg-white`, `text-gray-900`, hardcoded hex values) across the `src/` directory.
- **Widespread Hardcoded Values:** More than 650 individual files directly use `bg-white`, indicating a massive failure in adopting `bg-surface-canvas`, `bg-surface-card`, or equivalent semantic tokens.
- **Theming Override Bloat:** `src/styles/globals.css` stands at 644 lines, predominantly composed of manual dark-mode overrides (`html[data-theme='dark']`) rather than being a lean consumer of dynamic CSS variables injected by a theme registry.

---

## 2. Identified Gaps (Deep Dive by Category)

### 2.1 Tokenization Debt (Critical)
**Issue:** Extreme overuse of raw Tailwind colors throughout both feature code and core primitives.
**Evidence:** 
- ~10,795 hits for raw colors (`bg-white`, `text-gray-*`, `#[0-9a-fA-F]`).
- **Core Primitives & Components:** More than 45 files within `src/design-system/` itself use raw color utility classes. For example, `src/design-system/components/StatCard.tsx` contains hardcoded `bg-white` and `border-slate-100`, plus explicit tone mapping like `text-blue-600` and `bg-blue-600` in its `CATEGORY_STYLES`.
- **Layout Shells:** `src/design-system/components/RouteShell.tsx` hardcodes its mobile active views using `bg-white`, `border-gray-100`, and `border-t`. 
**Impact:** A theme like `cyberpunk` or `ember` cannot be deployed without doing manual replacements on thousands of lines of JSX, as the semantic meaning of `bg-white` (is it a card? a canvas? a popover?) is lost. The primitives that should be leading by example are currently contributing to the debt.

### 2.2 Theming Infrastructure (High)
**Issue:** Binary and brittle theme implementation tied purely to CSS overrides.
**Evidence:** 
- `src/styles/globals.css` (644 lines) relies entirely on `html[data-theme='dark']` to manually override specific `--ds-color-*` variables one by one.
- `src/lib/theme/theme.ts` only toggles between two states (`light` vs `dark`) and persists it via `ds-theme` in `localStorage`.
- `tailwind.config.ts` extends these variables (e.g. `surface-card: 'var(--ds-color-background-surface)'`), but there is no abstract concept of a generic palette.
**Impact:** Introducing `mono` or `nous` requires copying, pasting, and manually tuning hundreds of lines in `globals.css`. There is no `THEME_PALETTES` registry in TS, making it impossible to pass arbitrary custom themes to a `<ThemeProvider>`.

### 2.3 Adoption & Consistency (High)
**Issue:** Under-utilization of Design System Primitives.
**Evidence:** 
- `scripts/codemods/color-tokens.mjs` currently maps specific hex values like `#fbfbfa` to `bg-surface-card` and standard Tailwind colors to their exact class (`#f59e0b` to `bg-amber-500`). This implies feature code has been copying hex codes from Figma or older repositories rather than using tokens.
- Many page layouts and components (`src/app/admin/inventory/*`, `src/app/m/(shell)/*`, `src/app/fba/page.tsx`) hand-roll their UI using raw divs and raw classes instead of utilizing `Panel`, `PanelRow`, or `StatusBadge`.
**Impact:** UI inconsistency across themes. When a base primitive is updated to support a new theme, the hand-rolled implementations miss out on the update.

### 2.4 Extensibility for New Palettes (Medium)
**Issue:** Missing architectural space for new visual themes.
**Evidence:** The codebase lacks a `src/design-system/themes/` registry (e.g., `registry.ts`, `cyberpunk.ts`, `mono.ts`). The CSS structure implies theming is just an additive hack on top of light mode, rather than an interchangeable palette system.
**Impact:** Developers lack a clear path to contribute new themes. Creating an "ember" theme right now would mean polluting `globals.css` with `html[data-theme='ember']` overrides.

---

## 3. High-ROI Remediation & Execution Plan

To reach the target state where adding a new theme is a pure configuration exercise, we must execute the following prioritized waves.

### Wave 1: Architectural Foundation (Highest ROI)
**Goal:** Establish a robust theme registry and a generic runtime injector.
- **Action 1:** Create `src/design-system/themes/registry.ts` defining a `ThemeName` union (`light` | `dark` | `mono` | `slate` | `cyberpunk`) and a standard `ThemePalette` interface.
- **Action 2:** Extract the light and dark CSS variable declarations from `globals.css` into `themes/light.ts` and `themes/dark.ts` as JavaScript objects.
- **Action 3:** Refactor `src/lib/theme/theme.ts` to accept arbitrary theme strings rather than just checking for `'dark'`.
- **Action 4:** Implement a generic `ThemeProvider` that reads the active theme from the registry and dynamically injects the corresponding CSS variables into the DOM (e.g., via a `<style>` tag or setting them on the `<html>` element), reducing `globals.css` to just base tailwind imports and global resets.

### Wave 2: Design System Core Alignment
**Goal:** Ensure all primitive components are strictly tokenized.
- **Action 1:** Audit and update all components under `src/design-system/primitives/` and `src/design-system/components/` (specifically layout shells like `RouteShell` and `DesktopShell`) to *strictly* use semantic aliases (`bg-surface-card`, `text-text-default`, `border-border-soft`).
- **Action 2:** Refactor components like `StatCard.tsx` that rely on manual `CATEGORY_STYLES` objects mapped to tailwind utility colors. They should utilize semantic registry mapping (`bg-surface-success`, `text-text-success`, etc.).
- **Action 3:** Remove *all* instances of `bg-white`, `text-gray-*`, `bg-slate-*`, etc., from the core design system folder.

### Wave 3: The "Great Token Codemod" (High ROI for File Count)
**Goal:** Drastically reduce the 10,795 raw color usages in application code.
- **Action 1:** Expand the capabilities of `scripts/codemods/color-tokens.mjs`. Currently it only catches a few exact hexes. It needs to map common generic tailwind classes (`bg-white` -> `bg-surface-card` or `bg-surface-canvas` based on structural heuristics).
- **Action 2:** Run the codemod across high-traffic directories: `src/app`, `src/components`, and `src/features`.
- **Action 3:** Implement an ESLint rule (e.g., `no-restricted-syntax`) to throw a warning (and eventually an error) when raw color literals like `bg-white` or `#[0-9a-fA-F]` are used outside of token definition files.

### Wave 4: Status and Domain Tone Unification
**Goal:** Centralize operational colors.
- **Action 1:** Standardize all tone mappings in `src/lib/*-status.ts`. Ensure they return semantic token classes (`bg-surface-success`, etc.) instead of hardcoded tailwind colors (`bg-green-50`).

### Wave 5: Pilot New Themes
**Goal:** Validate the new architecture.
- **Action 1:** Implement `themes/mono.ts` (strict grayscale) and `themes/slate.ts` (cool industrial).
- **Action 2:** Expose a theme switcher in `src/app/settings/appearance/` allowing staff to preview and select these themes.
- **Action 3:** Perform a contrast accessibility pass on these new themes.

---

## 4. Next Steps
1. **Review and Approve:** Development team must align on the proposed `ThemePalette` schema in Wave 1.
2. **Execute Wave 1 & 2:** These foundational steps must be completed before the widespread codemods of Wave 3.
3. **Continuous Monitoring:** The CI pipeline should begin reporting on the count of raw color usages to track the burndown from ~10,795 down to the acceptable baseline.

---

## 5. EXECUTION LOG — 2026-07-04 (all waves executed)

Every wave landed in one working-tree change set. Where the audit's prescription met a conflicting
repo reality, the deviation is recorded below with its rationale.

### Wave 1 + 2 — Theme registry, runtime, core alignment ✅

- **`src/design-system/themes/registry.ts`** (new): `ThemeName` union, `ThemePalette` contract
  (the `ThemeVars` Record forces full variable coverage per theme at the type level), the
  `STAFF_ACCENTS` table (8 accents × light/dark variants), and `themeRegistryCssText()` — the
  generator that emits `:root` (light), `.theme-<accent>` classes, one `html[data-theme='<name>']`
  block per registered theme, and `html[data-color-scheme='dark'] .theme-<accent>` overrides.
- **Palettes**: `themes/light.ts` + `themes/dark.ts` rewritten to the palette shape (values
  byte-for-byte from the old hand-curated `globals.css` blocks; the legacy unconsumed
  `lightTheme`/`darkTheme` exports were retired). New vars added to every palette:
  `surface-hover`, `surface-strong`, `border-hairline`, `text-info`, `text-fulfillment`,
  `fill-info/success/warning/danger/fulfillment` — exposed as Tailwind aliases in
  `tailwind.config.ts`.
- **Two-attribute model** (deviation-as-improvement): `data-theme="<name>"` selects the palette;
  `data-color-scheme="dark"` (derived from `palette.scheme`) scopes the ~400-line raw-neutral
  compatibility remap and the dark staff-accent overrides. Any future dark-family theme
  (cyberpunk, ember) inherits both **for free** — the remap was retargeted once via
  `html[data-theme='dark']` → `html[data-color-scheme='dark']`.
- **Runtime**: `src/lib/theme/theme.ts` now applies any registry theme (unknown → light) and the
  `THEME_BOOT_SCRIPT` inlines the registry's name lists, so a new theme needs zero boot-script
  changes. `app/layout.tsx` injects `<style id="app-theme-palettes">` (server-rendered, static —
  no FOUC, no runtime injection cost). `styles/tokens.ts` and `styles/globals.css` no longer
  declare any theme-varying `--ds-color-*` var — the registry is the single owner (was 3 competing
  sources).
- **`globals.css`**: 643 → ~450 lines; all variable/accent blocks deleted; what remains is
  theme-independent tokens, resets, and the dark-scheme compatibility remap (which shrinks as the
  token migration burns down).
- **StatCard** (reference refactor): `CATEGORY_STYLES` now maps categories → semantic tone tokens
  (`text-text-info`/`bg-fill-info`, success, warning, danger, fulfillment) — under mono the whole
  dashboard correctly goes grayscale-with-safety-triad. **RouteShell/DesktopShell** and the rest of
  `src/design-system` were tokenized by the Wave-3 codemod + a residual sweep (434 raw neutrals →
  only documented exceptions: alpha washes, deliberate camera/dark chrome, focus-emphasis ramps,
  400-step underline affordances).

### Wave 3 — The great token codemod ✅

- `scripts/codemods/color-tokens.mjs` gained a prefix-preserving NEUTRAL pass (gray/slate/zinc ×
  bg/text/border/divide/ring, step-mapped; interactive `bg-*-50` washes → `bg-surface-hover`).
  Mappings are parity-safe: light values match the slate family exactly; dark values match what the
  remap already rewrote each class to.
- **Applied: 10,962 replacements across 976 files.** Remaining raw neutrals: **1,151** (alpha
  washes Tailwind can't token-ize over hex vars, deliberate dark chrome, 300-step decorative
  fills) — vs ~10,795 counted by the audit scan.
- Deliberately unmapped: `text-white`, opacity-modified classes, warm `stone`/`neutral` families
  (visible hue shift), saturated accent hues, gradient stops.

### Wave 4 — Status/tone SoTs ✅ (with a deviation)

The codemod tokenized every neutral inside the tone SoT modules (`unshipped-state`,
`outbound-state`, `condition-tone`, `source-platform`, `workflow-stages`). **Deviation:** the
audit's "bg-green-50 → bg-surface-success everywhere" prescription was NOT applied to hue-identity
classes — eBay yellow, Amazon orange, grade-B blue, USED_C slate, stage dots. Status hues are
*information*, themes swap *chrome*; converting identity hues to functional tokens would mislabel
brand/grade identity as status semantics and visibly shift pill trios (ring-x-200 vs
border-x-400). These remain raw and dark-safe via the remap.

### Wave 5 — Pilot themes + switcher + contrast ✅

- **`themes/mono.ts`** — strict grayscale (zinc): chrome, accents, info/fulfillment tones collapse
  to neutral; the success/warning/danger triad keeps deep desaturated hue (status color is safety
  information on a warehouse floor). The theme-owned `accent` block outranks per-staff
  `.theme-<accent>` classes by specificity — choosing mono means choosing monochrome.
- **`themes/slate.ts`** — cool industrial: steel canvas, near-white cards, functional tones one
  step deeper; staff accents still apply.
- **Switcher**: `AppearanceSection`'s Theme card is now registry-driven (all `THEME_NAMES`, with a
  live palette miniature — canvas field, card chip, accent dot, text tick). Persistence unchanged:
  `staff_preferences.theme` (type widened to `string | null`; unknown values resolve to light).
- **Contrast (WCAG AA)**: dark passes all 16 checks; mono + slate initially failed
  soft-on-sunken/faint-on-card and were corrected (`text-soft`/`text-faint` darkened) — now pass.
  **Pre-existing light-theme findings (unchanged, parity-first):** `text-faint` on card = 2.56
  (decorative tier), `text-success #16a34a` on card = 3.30, `text-warning #ea580c` on card = 3.56,
  success/warning pill text ≈ 3.2–3.4. Fixing these means changing today's production light values
  — flagged for a deliberate follow-up decision, not smuggled into a refactor.

### Enforcement ✅ (with a deviation)

- **`src/components/ui/color-neutrals.guard.test.ts`** (new, wired into `test:ds-guards` +
  `test:neutral-guard`): shrink-only ratchet on raw neutral utilities, baseline **1,151**, escape
  hatch `ds-allow-raw-neutral`. All 13 ds-guard tests pass.
- **Deviation:** no ESLint rule. `eslint.config.mjs`'s own architecture note explains why: a second
  `no-restricted-syntax` block for the same files *overrides* (not merges with) the existing
  z-index/tenancy guard block. The ratchet guard is this repo's established mechanism for exactly
  this kind of burn-down (typography, raw-button, hex ratchets) and is CI-enforced via
  `test:ds-guards`.

### How to add a theme now (the acceptance test)

1. Author `src/design-system/themes/<name>.ts` exporting a `ThemePalette` (the type forces full
   variable coverage; set `scheme: 'dark'` to inherit the dark remap + dark staff accents).
2. Register it in `THEME_PALETTES` + the `ThemeName` union in `registry.ts`.
3. Done. Generated CSS, boot script, theme switcher (with preview swatch), and persistence all pick
   it up with zero further changes.

---

## 6. BURN-DOWN ADDENDUM — 2026-07-04 (second pass into the remainder)

The 1,151 post-codemod remainder was attacked on three fronts; **raw neutrals now stand at 454**
(from ~12,100 pre-migration — a 96% reduction), all deliberate.

### A. Alpha-capable tokens
Tailwind semantic aliases became **function colors** (`themed()` helper in `tailwind.config.ts`):
with no alpha modifier they emit today's exact `var(--ds-color-*)` (byte-identical, zero
regression); with a modifier (`bg-surface-card/90`) they emit
`color-mix(in srgb, var(…) calc(a·100%), transparent)` (Chrome 111+/Safari 16.2+; probe-compiled
and verified). The codemod gained an alpha pass — frosted **surfaces** convert
(`bg-white/90 → bg-surface-card/90`, `bg-gray-50/60 → bg-surface-canvas/60`,
`ring-gray-200/60 → ring-border-soft/60`), while **glass highlights** (`bg-white/5..40`) and
**scrims** (`bg-black/NN`) stay raw as compositing effects. +373 conversions.

### B. Inverse-chrome token family
Seven new palette variables (typed into every theme): `surface-inverse`, `surface-inverse-hover`,
`text-inverse`, `text-inverse-soft`, `border-emphasis` (≈gray-400 affordances), `border-strong`
(≈gray-900 selection outlines — flips light on dark, fixing an invisible-selection dark bug),
`border-inverse`. All inverse text/fill pairs pass WCAG AA in all four themes. Context sweeps
converted **293 sites** (dark pills, CTAs, action bars, tooltips, selection outlines,
`text-gray-300`-on-light → `text-text-faint`) plus **27 idle-dot/handle sites** →
`bg-border-emphasis` and stone-family drift. Fill-matched rings/borders on inverse pills use
`ring-surface-inverse` / `border-surface-inverse` (the ring IS the fill color — a ruling, now
precedent).

### C. Registry reach + fixes
- `STAFF_THEMES` (the server-side Zod validator for `staff_preferences.theme`) now derives from
  the registry's `THEME_NAMES` — the last hardcoded light|dark union is gone; a new palette is
  storable with zero schema changes.
- Mechanical residue: `bg-*-300 → bg-surface-strong`, `border-*-400 → border-border-emphasis`,
  `border/divide-*-50 → border-hairline`, `neutral-*` family folded into the codemod.
- Ratchet baseline lowered **1,151 → 454** (`color-neutrals.guard.test.ts`). Remainder taxonomy:
  alpha scrims/glass (~66), camera/scanner/photo chrome (~30), staff/tone color-identity
  registries (~22), print zones (2), chart constants, and 600/700-step fills awaiting an
  "inverse-raised" step decision (noted below).

### Known follow-ups (deliberate, not debt-by-accident)
- An **inverse-raised** step (chip resting/hover ON an inverse bar, e.g. `bg-zinc-800` on the
  manuals bulk bar) would let ~8 more sites convert without erasing their hover distinction.
- Alpha-carrying inverse pills (`bg-slate-900/95` sign-in PIN pad, `bg-slate-900/80` zoom hint)
  are convertible now that tokens take alpha — left for a follow-up since surface-inverse/95 in
  dark = mid-slate at 95%, a deliberate look change to review visually.
- Light theme's pre-existing AA findings (§5) remain open for a product decision.
