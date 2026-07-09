# Gemini Antigravity — Design System Gap Audit & Multi-Theme Expansion Plan

**Version:** 2026-07-04  
**Owner / Trigger:** Comprehensive scan for theme switching (light, dark, mono, nous, midnight, ember, cyberpunk, slate + similar "display" modes)  
**Goal:** Systematically identify gaps preventing first-class, maintainable support for multiple visual themes/palettes and display variants. Produce actionable report + remediation roadmap.  
**Output:** Machine-readable + human report (gaps by category/severity/file, palette specs, migration tasks, lint rules, codemod targets).

---

## 1. Executive Summary & Objectives

Current design system has:
- Solid token foundations (`src/design-system/tokens/`)
- Partial light/dark theming via `html[data-theme="dark"]` + ~600+ lines of high-specificity overrides in `src/styles/globals.css`
- Accent "themes" (staff color variants) via `theme-*` classes + CSS vars
- Staff preference persistence + `ThemeSync` + boot script for no-flash
- `lightTheme`/`darkTheme` objects + `createTheme` + CSS var generator
- Tailwind extensions for a few semantic aliases (`surface-*`, `text-*` etc.)

**Core problems for multi-theme:**
- Theming is **patch-based** (override raw Tailwind utilities), not **token-driven**.
- Widespread direct use of `bg-white`, `bg-gray-50`, `text-gray-900`, `bg-blue-50`, `ring-gray-200`, arbitrary hex/rgba, and non-semantic colors.
- Theme definitions are fragmented (semantic.ts vs light/dark.ts vs globals.css :root vs Tailwind config vs styles/tokens.ts).
- No extensible palette registry or runtime theme loader for new named themes.
- No "display" layer separate from color theme (density exists but is limited; no high-contrast, mono-chrome display, reduced-chrome, etc.).
- Dark coverage is "good enough" but brittle (gaps remain for gradients, react-flow, arbitrary values, some components, contrast).
- Primitives and design-system components are under-adopted relative to raw JSX + Tailwind in pages/features.

**Target state:** Any supported theme (including vivid ones like cyberpunk or warm ember) is achieved by swapping a coherent palette at the token/CSS-var layer. Raw color utilities are minimized or eliminated in new code. Archetypes (station/workbench/monitor/canvas) render correctly and accessibly in every theme. Switching is instant, persisted, previewable, and extensible.

Gemini Antigravity's job: perform a deep, repeatable, low-noise scan that surfaces every gap with file/line evidence, severity, and remediation steps. It must respect existing invariants (`.claude/rules/*`, source-of-truth maps, archetype rules).

---

## 2. Scope

**In scope:**
- All source under `src/` (app, components, design-system, features, lib, hooks, contexts).
- CSS: `src/app/globals.css`, `src/styles/globals.css`, postcss/tailwind config.
- Theme-related: `src/design-system/{tokens,themes,utils,providers}`, `src/lib/theme`, `src/components/theme`, `src/lib/settings/appearance`, staff prefs.
- Usage of colors, tokens, primitives, status tones, motion, typography, z, radii, borders, shadows.
- Archetype surfaces (station cards, workbench sidebars/panes, monitor timelines, studio canvas, mobile shells).
- Existing dark overrides + any `prefers-color-scheme` leakage.
- Accessibility (contrast), build (content globs, codemods), DX (linters, docs).
- "Display" concepts (density, reduced motion/chrom e, high-contrast variants).

**Out of scope (initial pass):**
- DB schema / backend (except any staff theme prefs queries).
- E2E visual screenshots (recommend later).
- Third-party libs internals (except react-flow overrides).
- Full migration PRs (scanner produces the plan + lists; execution follows).

**Extensible themes (minimum set to support):**
- `light` (current default)
- `dark` (current)
- `mono` — strict grayscale, minimal hue, high legibility
- `nous` — refined, low-saturation, thoughtful/neutral-intellectual feel
- `midnight` — deep navy/black dominant, cool
- `ember` — warm, orange/amber dominant, energetic
- `cyberpunk` — high-contrast neon (magenta/cyan/electric), dark base
- `slate` — cool industrial slate/gray dominant (similar to current dark but distinct base)

Plus "display modes" orthogonal or composable: high-contrast, low-chrome, dense-compact (beyond current density), print-optimized, etc.

---

## 3. Current State Snapshot (from initial reconnaissance)

**Strengths:**
- Base + semantic color separation exists.
- CSS var pipeline (`tokens/css-variables.ts`, injected in layout).
- Named z-index + motion foundations + typography presets.
- Some semantic Tailwind aliases wired.
- Light/dark + accent mechanism + persistence + boot script.
- Many status tone maps consolidated (per design-system-token-simplification.md).
- Primitives (Button, Panel, EmptyState, StatusBadge, etc.) and design-system components.
- Strict rules in `.claude/rules/ui-design-system.md`, `source-of-truth.md`, `contextual-display.md`.

**Major gaps (evidence-based):**
1. **Override explosion**: `globals.css` contains exhaustive remaps for gray/slate/blue/green/...-50/100/200/600/700/800/900 + /opacity variants + gradients + rings + text + disabled states + react-flow. This pattern does not scale to 8+ themes.
2. **Raw Tailwind color usage**: Thousands of call sites still use `bg-white`, `text-gray-*`, `border-gray-200`, `bg-blue-50`, `hover:bg-emerald-50`, arbitrary `shadow-[...]`, hex in components (e.g. some dashboard shadows, chart configs, dark.ts itself has `#22D3EE`, `#FDBA74`).
3. **Fragmented theme sources**:
   - `semanticColors` (light biased)
   - `lightTheme` / `darkTheme` (partial)
   - `:root` + `[data-theme='dark']` (runtime truth for most UI)
   - Tailwind `extend.colors` aliases (partial)
   - `src/styles/tokens.ts`
   - Hardcoded values in lib/status files, components, features.
4. **No palette abstraction for new themes**: Adding "ember" would require duplicating the entire override monster + new semantic map + Tailwind + component patches.
5. **Incomplete dark coverage**: Comments reference "phase 2 gap closers"; opacity variants, some arbitrary classes, specific components (KpiDetailsModal had hardcoded before), gradients, studio canvas.
6. **Adoption of design-system primitives is partial**: Many pages/features still hand-roll rows, chips, panels using raw classes instead of `PanelRow`, `StatusBadge`, semantic chips, etc.
7. **No runtime multi-palette loader**: `applyTheme` only toggles `data-theme` attr. No CSS var block swap per named full palette.
8. **Typography/motion/radii/spacing tokens** exist but direct class usage + inline styles bypass them in places.
9. **Contrast & a11y**: No systematic per-theme WCAG checks. Vivid themes (cyberpunk) are high-risk for low-contrast text on neon.
10. **Display / archetype fidelity**: Rules require consistent linear scaffold, one-row anatomy, chips, HoverTooltip, semantic colors per archetype. Scanner must verify color decisions don't break station crossfade, workbench selection rings (`bg-blue-50 ring-blue-400`), etc.
11. **DX gaps**: No lint rule banning raw hex or non-semantic colors in TSX/CSS. Codemods exist (`scripts/codemods/color-tokens.mjs`) but narrow. No theme preview harness.
12. **Staff accent vs full theme**: Accent overlays current themes but may clash with new palettes.
13. **Outdated comments** (e.g. appearance.ts still says "dark-only").

**Files of highest impact (prioritize scan + fixes):**
- All under `src/design-system/`
- `src/styles/globals.css` (the override monster)
- `tailwind.config.ts`
- `src/app/layout.tsx`, `src/components/Providers.tsx`
- Layout primitives: `RouteShell`, `ResponsiveShell`, `DesktopShell`, `MobileShell`, sidebars
- Station: `Station*`, scan bar, active cards
- Workbench patterns: sidebars (`SidebarRailShell`), right panes
- Common UI: `CopyChip`, `StatusBadge`, `TabSwitch`, buttons, tables, forms
- Status/tone files in `src/lib/*-status.ts`, `conditions.ts`, `source-platform.ts`, outbound/unshipped/receiving states
- Features/ops: dashboards, rails, charts (`chart-theme.ts`), studio canvas
- Any file still importing raw Tailwind colors for meaning

---

## 4. Gemini Antigravity Scanning Methodology

**Principles for the scanner:**
- Be exhaustive but deduplicated (group by pattern + file clusters).
- Output structured data (JSON report + Markdown summary) + prioritized task list.
- Never mutate code during scan (read-only pass; propose patches in follow-up).
- Respect SoT: always cross-reference `src/design-system/...` and `.claude/rules/source-of-truth.md`.
- Classify severity: **Critical** (breaks a theme or archetype), **High** (fragile maintenance), **Medium** (inconsistent), **Low** (cleanup).
- Provide "why it matters for multi-theme" for each finding.
- Include suggested fix pattern (use semantic token X, introduce Y palette entry, run codemod Z).

### 4.1 Pass 1: Static Token & Color Inventory
- Grep for hex/rgba/hsl in `**/*.{ts,tsx,css,js,mjs}` (exclude node_modules, reports). Categorize: design tokens vs inline vs shadows vs charts vs print.
- Grep raw Tailwind color families: `bg-(white|black|gray|slate|stone|zinc|neutral|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-`, same for `text-`, `border-`, `ring-`, `divide-`, `from-`/`to-` gradients, `shadow-`, `placeholder:text-`.
- Count per-file + aggregate. Flag files with >10 raw instances.
- Detect `style={{ color: `, `backgroundColor`, inline `fill=`, `stroke=`.
- Detect `dark:` variant usage (should be minimal; system should not need per-class dark:).

### 4.2 Pass 2: Design System Surface Audit
- Inventory imports/usage of:
  - `semanticColors`, `baseColors`, `lightTheme`/`darkTheme`, `createTheme`, `designSystemCssVariables`, `getTokenValue`.
  - Design-system primitives (`@/design-system/primitives/*`, components/*).
  - Tokens: z-index, motion (framer + css), typography presets, spacing, radii, shadows, borders.
- Flag "bypass" patterns: direct `border-gray-200` when `border-border-soft` or semantic exists; direct status colors instead of tone registries.
- Check `src/lib/` for tone maps (even if renamed from STATUS_TONE).
- Cross-check against `.claude/rules/source-of-truth.md` (conditions, platforms, copy chips, etc.).

### 4.3 Pass 3: Theming Runtime & CSS Audit
- Parse `globals.css` (both locations) for all `[data-theme]`, `:root`, `.theme-*` rules. Map which utilities are covered vs not.
- Check for `prefers-color-scheme` leakage or conflicting media queries.
- Audit CSS var consumption: files using `var(--ds-*)` vs those that should.
- Audit `tailwind.config.ts` color extensions and content globs (missing globs = invisible classes per build-gotchas).
- Check `lib/theme/theme.ts`, `ThemeSync`, `Appearance*`, staff prefs queries.
- Look for `className` construction that hardcodes theme-dependent colors.

### 4.4 Pass 4: Component & Archetype Coverage
- Per-archetype:
  - Station (scan-driven, ephemeral cards, crossfade): verify no hover-dependent color, scan bar focus, active card states.
  - Workbench (sidebar picker + right pane): selection = `bg-blue-50 ring-blue-400` (or semantic equiv), stable list.
  - Monitor / Canvas: observe-only vs graph; special overrides for react-flow, timelines.
- Sample high-traffic files (dashboard, receiving, fba, ops, studio, mobile shells, sidebars).
- Check empty/error states, chips, status dots, tooltips for token usage.
- Check mobile vs desktop parity for color application.

### 4.5 Pass 5: Gap Synthesis & Report Generation
- Cluster findings:
  - Tokenization debt (raw colors, missing semantic aliases).
  - Palette definition debt (no registry for new themes).
  - Runtime switching debt (only binary toggle + patches).
  - Adoption debt (files/components not using DS).
  - Fidelity / invariant violations (archetype color rules, SoT maps).
  - A11y / contrast debt.
  - DX / build debt (lints, codemods, docs).
  - Fragmentation (multiple sources of truth for the same value).
- Produce:
  - `reports/gemini-antigravity-<date>.json` (structured: {gaps: [{id, severity, category, files[], evidence, remediation}]})
  - Human Markdown summary with top-20 files, heatmaps (by category), estimated effort.
  - Suggested palette skeleton for each target theme.
  - Prioritized migration waves (core primitives first, then status, then pages, then new themes).

### 4.6 Pass 6 (Optional but Recommended): Tool-Augmented
- Use codemod-style or ts-morph for precise counts of color class occurrences.
- Static contrast check (approximate ratios for proposed palettes against text/background pairs).
- Diff the current `dark` overrides against semantic dark to surface drift.
- Search for any remaining "TODO dark", "dark mode", "theme" comments.

**Run commands (examples for the agent to execute):**
- `grep -r --include="*.tsx" --include="*.ts" --include="*.css" "bg-white\|text-gray-900\|#[0-9a-f]" src/ | ...`
- Targeted: `grep -l "bg-blue-50\|ring-blue-400" src/components/sidebar/* src/app/*`
- `node scripts/codemods/color-tokens.mjs --dry` (study it).

---

## 5. Detailed Gap Categories & Checklists

### 5.1 Tokenization Gaps (Critical/High)
- [ ] Any hex/rgba not originating from `baseColors` or `semanticColors`.
- [ ] Direct Tailwind hue usage where semantic alias or design-system component exists.
- [ ] Status / functional colors duplicated inline instead of registry + `conditionLabel` / tone helpers.
- [ ] Shadows using arbitrary `shadow-[...]` instead of token or `shadows.ts`.
- [ ] Missing Tailwind content glob coverage for new token usage (see build-gotchas).

**Fix pattern:** Import from `@/design-system/tokens/colors/semantic` or use `bg-surface-success text-text-success border-border-success`. Extend Tailwind aliases when needed. Update codemod.

### 5.2 Theming Infrastructure Gaps
- [ ] `applyTheme` only handles 'light'/'dark'. No `applyFullTheme(name: ThemeName)`.
- [ ] No central `THEMES` registry exporting palette objects (base + semantic overrides + metadata).
- [ ] CSS overrides live only in one massive file; no per-theme partials or generated blocks.
- [ ] `data-theme` attr is binary; consider `data-theme="cyberpunk"` + `[data-theme="cyberpunk"] { ... }` or pure var injection.
- [ ] Accent themes may need redefinition or compatibility matrix per base theme.
- [ ] Density/font-scale live in localStorage + separate applier; unify under one appearance + theme context?

**Recommended architecture:**
- `src/design-system/themes/registry.ts`: `export const THEME_PALETTES = { light: ..., dark: ..., mono: ..., ... } as const`
- Each palette: full or delta over base semantic structure.
- Runtime: `setTheme('ember')` injects a `:root, [data-theme="ember"] { --ds-*: value; }` block (or swaps a `<style>` tag) + sets attribute for specificity.
- Keep the current override layer only for transitional "legacy raw" support; deprecate it.
- `createTheme` becomes `createTheme(palette)`.

### 5.3 New Palette Definition Gaps
For each target theme the scanner must produce (or validate) at minimum:
- Base ramp (or reference to existing + tint adjustments).
- Full semantic mapping (text, background, surface ladder, border, functional, status, overlay, gradient, tonalNesting, focus, dashboard tones).
- Signature values (ghost borders, scrims).
- Accent compatibility notes.
- High-contrast / mono variants if relevant.
- Contrast audit (text on surface at least AA).

**Suggested starting points for scanner to seed:**
- `mono`: desaturate most hues; use gray ramps exclusively for neutrals; keep minimal functional hue.
- `midnight`: heavy use of navy/gray-950 base + cool accents.
- `ember`: shift primary/accents toward orange/amber; warm surfaces.
- `cyberpunk`: dark base, electric cyan/magenta/lime for accents/functional; high value contrast.
- `slate` / `nous`: refined gray + very low sat navy or stone.

### 5.4 Adoption & Consistency Gaps
- Files using design-system components vs raw equivalents.
- Violations of "color only from semantic tokens" (rule in ui-design-system.md).
- One-row anatomy, eyebrow, chip, HoverTooltip, icon pairing still using raw colors.
- Archetype selection affordances (`bg-blue-50 ring-1 ring-inset ring-blue-400`).
- Status dots / timeline tones using registry vs ad-hoc.

### 5.5 Accessibility, Motion, Display Gaps
- Per-theme contrast matrix.
- `prefers-reduced-motion` + theme (some themes may imply different defaults).
- High-contrast display mode (separate or composable).
- Print / label themes (already special-cased somewhat).
- Reduced-chrome "display" for station focus.

### 5.6 DX, Docs, Build Gaps
- No ESLint rule or knip-style check for raw color literals in component code.
- Codemods need generalization to support "replace with theme var" or "flag for manual palette mapping".
- DESIGN_SYSTEM.md and rules docs need explicit "themes are palettes" section.
- Storybook / design-demo pages (if exist) need multi-theme previews.
- Visual regression (Playwright shots) per theme.
- Update `.claude/rules/ui-design-system.md` + build-gotchas if new vars or globs required.

---

## 6. Proposed Architecture Sketch (for reference during scan)

```
src/design-system/
  tokens/
    colors/
      base.ts                 # shared raw ramps (can be extended per-theme)
      semantic.ts             # default/light semantic
  themes/
    index.ts
    registry.ts               # THEME_DEFINITIONS, type ThemeName = 'light'|'dark'|...
    light.ts
    dark.ts
    mono.ts
    ember.ts
    cyberpunk.ts
    ...
    utils.ts                  # buildCssVarsForTheme(name)
  utils/
    createTheme.ts            # generalized
  providers/
    ThemeProvider.tsx         # new: context + applier + <style> injector
```

Runtime flow:
- Boot script + ThemeSync read pref → call `applyTheme('ember')`
- `applyTheme` sets `data-theme="ember"`, injects/ updates a theme style block with `--ds-*` for that palette.
- Components use Tailwind semantic aliases or `var(--ds-...)` or design-system helpers.
- Legacy raw utilities still get minimal overrides only for the transition period.
- Accents remain as overlay classes but validated against current base theme.

---

## 7. Phased Remediation Roadmap (high-level)

**Wave 0 (Scanner):** Run Gemini Antigravity. Produce report + initial palette seeds. Update this plan with concrete counts.

**Wave 1 (Foundation):** Unify theme definitions into registry. Implement generic CSS var applier. Add ThemeName type + persistence. Port light/dark faithfully. Add first new theme (e.g. slate or mono) as proof.

**Wave 2 (Core surfaces):** Migrate design-system primitives + layout shells + common components (CopyChip, badges, sidebars, panels) to pure token usage. Reduce globals.css overrides by 50%+.

**Wave 3 (Status & domain):** Ensure all `* -status`, conditions, platforms, states use the central tone story. Update any remaining inline maps.

**Wave 4 (Pages & features):** Prioritized sweep of high-traffic + archetype surfaces. Use codemods + manual for complex cases.

**Wave 5 (New palettes + UI):** Ship remaining themes. Add theme switcher UI (Settings + perhaps quick toggle or cmd-k). Add previews / swatches.

**Wave 6 (Hardening):** Lints ("no raw color literals outside tokens"), stricter content globs, visual tests, a11y matrix in CI/docs, archetype regression checklist.

**Parallel:** Update all docs, rules, DESIGN_SYSTEM.md. Train team via the plan artifacts.

---

## 8. Scanner Deliverables & Artifacts

1. Structured gap report (JSON + MD).
2. Heatmap: files by # of raw color usages + category.
3. Per-theme palette proposal files (as TS objects ready to drop in).
4. List of "quick wins" (low effort, high coverage: e.g. replace all `bg-white` in DS primitives).
5. Proposed diff for `globals.css` reduction strategy.
6. Lint rule sketch + codemod enhancement spec.
7. Checklist for "theme ready" component sign-off.
8. Risks log (e.g. "react-flow theming", "arbitrary shadow usage in 17 files").

---

## 9. Success Criteria

- Adding a new theme requires: 1 new file in `themes/`, registration, optional accent tuning. No changes to 90% of components.
- All current light/dark visual behavior preserved (byte-for-byte where intended).
- Zero (or near-zero) new raw hex/rgba in component code after Wave 2.
- Every archetype surface has documented token usage for its key states (selection, status, empty, focus).
- Contrast passes for all 8+ themes (documented).
- Theme switch is instant (<50ms perceived) and survives reload + cross-device via prefs.
- Scanner report itself is checked into `reports/` and referenced from this plan.

---

## 10. References & Invariants (load before scanning)

- `.claude/rules/ui-design-system.md`
- `.claude/rules/source-of-truth.md`
- `.claude/rules/contextual-display.md`
- `.claude/rules/backend-patterns.md` (for any route components)
- `src/design-system/DESIGN_SYSTEM.md`
- `docs/design-system-token-simplification.md` (note completed items, continue the spirit)
- `src/design-system/tokens/...` (all)
- Current `lib/theme`, appearance, ThemeSync, staff prefs
- `scripts/codemods/color-tokens.mjs` and `text-size-tokens.mjs`
- `tailwind.config.ts` + build gotchas

**Anti-patterns to flag:**
- Mixing archetypes in one region.
- Forking rails/shells.
- Hardcoding selection as anything except the ring + bg-blue-50 pattern (until semanticized).
- Bypassing `record*` or tone helpers for visuals.

---

## 11. How to Execute the Scan (for Gemini Antigravity or human follow-up)

1. Load all references above + this plan.
2. Run Pass 1–6 using terminal + grep + read_file on clusters.
3. For each major cluster (e.g. all sidebar components), produce sub-report.
4. Synthesize global report.
5. (Stretch) Generate a starter `themes/mono.ts` skeleton from dark + desaturate logic.
6. Output the artifacts. Flag any blocker (e.g. a component whose entire color logic is ad-hoc).

**Prioritize scan order:**
1. Design system internals + tokens.
2. Layout + shells + primitives.
3. Status / tone / condition / chip SoT files.
4. Station surfaces.
5. Sidebar + workbench patterns.
6. Operations / studio / charts (special surfaces).
7. Remaining pages (sample top by usage or complexity).
8. CSS + config.
9. Docs + rules cross-check.

---

**End of Plan.** Update this document with actual scanner findings, counts, and palette seeds after first run. The ultimate measure of success is that new themes become a configuration exercise, not a global refactor.

Gemini Antigravity: scan deep, report precisely, enable beautiful, coherent, themeable operations interfaces without violating the house style or archetypes.