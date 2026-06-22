# Design System: Token System & Simplification

**Status:** Planning. Forward-looking simplification plan for the design-system *foundation* layer.
**Date:** 2026-06-21
**Scope:** Tokens, themes, tone registries, motion adoption, and Tailwind wiring — the *values* layer that every page consumes.

---

## 0. What this doc is (and is not)

This is the **foundation-layer** companion to two adjacent docs. Keep the boundaries clean:

| Doc | Owns | Layer |
|---|---|---|
| `src/design-system/DESIGN_SYSTEM.md` | The **current spec & rules** (North Star, functional-color meanings, CopyChip semantic constraints, "no cards for data rows", desktop↔mobile mapping). | Reference / law |
| **This doc** | The **simplification *plan*** — consolidating scatter, wiring dormant tokens, adopting the motion layer. | Foundation / values |
| `docs/station-chassis-refactor-discovery.md` | How *pages* compose primitives into the scan→crossfade→display chassis. | Architecture / composition |

**Rule of thumb:** if it's about a *value or its single source* (a color, a duration, a tone map, a z-band), it lives here. If it's about how a *page wires components together*, it lives in the chassis doc. The chassis *consumes* this layer; it must never fork it.

---

## 1. The seam with the chassis refactor

Three items surfaced in the chassis discovery are actually **token-layer work** and are owned here, not there. The chassis plan references them; this doc executes them:

1. **Central status-tone registry** — the chassis wants to kill per-page `STATUS_TONE` maps. That consolidation is a token-system task (§4). The chassis just consumes the result.
2. **Theming mechanism (light/dark + density)** — the chassis Phase 4 *selects* a theme via `staff_preferences`, but the `data-theme` → CSS-var swap and the dark-theme completion live here (§5).
3. **SoT inventory the chassis must "consume not fork"** — `z-index.ts`, `motion-framer.ts`, `CHIP_TONES`, `source-platform.ts`, `conditions.ts`, `unit-status.ts`, `unshipped-state.ts`, `outbound-state.ts`. This doc is the registry of those SoTs (§6) so the chassis has one authoritative list.

---

## 2. Current state — what's already centralized & working

The token layer is genuinely strong in places. Do **not** rebuild these:

- **Z-index scale** — `src/design-system/tokens/z-index.ts` (18 named bands), wired into Tailwind (`z-panel`/`z-modal`/…), CSS vars (`--ds-zIndex-*`), and inline usage. Complete. (See SoT memory: never hardcode `z-[NNN]`.)
- **Color token structure** — `tokens/colors/base.ts` (raw palettes) → `tokens/colors/semantic.ts` (`semanticColors`: text/background/surface/border/outline/functional/status/gradient/overlay/tonalNesting + dashboard nested tones). Clean two-tier separation.
- **CSS-var generation** — `tokens/css-variables.ts` flattens the token tree into `--ds-{section}-{name}` vars + a `:root` style block. Mechanism is solid.
- **Motion foundations** — `foundations/motion.ts` (durations/easings) + `foundations/motion-framer.ts` (`motionBezier`, `framerDuration`, `framerTransition`, `framerPresence`, `framerGesture`, slide/pager variants, mobile set). The library is comprehensive — the gap is *adoption*, not coverage (§7).
- **Exemplary tone/label registries (the pattern to copy):**
  - `src/lib/unit-status.ts` — `STATUS_TONES` (14 states × `badge`/`chip`) + `unitStatusBadgeClass()`/`unitStatusChipClass()`.
  - `src/lib/outbound-state.ts` / `src/lib/unshipped-state.ts` — `*_STATE_META` (label/description/pill/dot), deliberately hue-coordinated at the `PACKED_STAGED` seam.
  - `src/lib/conditions.ts` — `CONDITION_LABELS` (6 variants) + `conditionLabel()`.
  - `src/lib/source-platform.ts` — `SOURCE_PLATFORMS` + `sourcePlatformMeta()`.
  - `src/components/ui/CopyChip.tsx` — `CHIP_TONES` (6 semantic chips), with the hard FNSKU ≠ Tracking color rule.

These are the proof the pattern works. Every simplification below is "make the scattered thing look like these."

---

## 3. The simplification targets (overview)

| # | Target | Problem | Effort | Risk |
|---|---|---|---|---|
| T1 | **Status-tone registry consolidation** (§4) | 12+ inline `STATUS_TONE` maps, inconsistent shapes | M | Low | ✅ **named-`STATUS_TONE` scope DONE** (11/12, 9 registries) — broader `*_TONE` tail found, see T1b |
| T1b | **Broader `*_TONE` tail** (§4) | maps under other names (`SEV_TONE`×2, `RISK`/`REPAIR`/`TIER`/`QUOTE`/`TYPE`) | M | Low | ✅ **DONE** (6 registries) — residue reclassified, see §4 |
| T2 | **Theme wiring** (§5) | ~~dark theme dormant~~ | M | Med | ✅ **DONE** 2026-06-21 (mechanism + Settings→Appearance toggle) |
| T3 | **Motion-token adoption** (§7) | ~266 inline `animate`/`transition` bypass the token library | M | Low | ✅ **DONE** — easeOut consolidated; durations resolved (stay literal, see §7) |
| T4 | **Tailwind semantic aliases** (§8) | ~~only 5 semantic color utilities; functional tones not aliased~~ | S | Low | ✅ **DONE 2026-06-21** |
| T5 | **Typography presets as utilities** (§8) | presets exist in code but aren't a Tailwind layer | S | Low | ⛔ **WON'T DO** — redundant (see §8) |
| T6 | **Color-story documentation** (§9) | ~~semantic hue meanings only implicit~~ | S | None | ✅ **DONE 2026-06-21** |

S = small, M = medium. None require schema changes except T2's optional preference key (which reuses the existing `staff_preferences` blob).

---

## 4. T1 — Status-tone registry consolidation

**The scatter** (confirmed inline `STATUS_TONE`/`*_TONE`/`*_DOT_BG` declarations — ≈12 files, 31 grep hits):

| File | Map | Shape |
|---|---|---|
| ~~`src/app/warehouse/replenishment/page.tsx`~~ | ✅ → `lib/replenishment-status.ts` | migrated |
| ~~`src/app/warehouse/rma/page.tsx`~~ | ✅ → `lib/rma-status.ts` | migrated |
| ~~`src/app/m/rs/[id]/page.tsx`~~ | ✅ → `lib/repair-status.ts` | migrated |
| ~~`src/app/m/h/[id]/page.tsx`~~ | ✅ → `lib/handling-unit-status.ts` | migrated |
| ~~`src/app/m/receiving/po/[poId]/page.tsx`~~ | ✅ → `lib/po-header-status.ts` | migrated |
| ~~`src/features/operations/components/KpiDetailsModal.tsx`~~ | ✅ → `lib/repair-status.ts` (reconciled hues) | migrated |
| ~~`src/features/operations/components/OperationsAgentsRow.tsx`~~ | ✅ → `lib/agent-status.ts` | migrated |
| ~~`src/features/operations/components/StaffGoalsRail.tsx`~~ | ✅ → `lib/staff-goal-status.ts` | migrated |
| `src/components/ui/pane-header/blocks.tsx` | `STATUS_TONE_CLASS` | ⏸️ left — already central in `PaneHeaderStatusPill` |
| ~~`src/components/admin/SystemSyncActivityTab.tsx`~~ | ✅ → `lib/sync-run-status.ts` | migrated |
| ~~`src/components/inventory/TriageWorkspace.tsx`~~ | ✅ → `lib/inventory-triage-status.ts` | migrated |
| ~~`src/components/inventory/sidebar/InventoryTriageSidebar.tsx`~~ | ✅ → `lib/inventory-triage-status.ts` | migrated |

**Two distinct problems:** (a) the same domain's tones are re-declared in sibling files (e.g. inventory triage in two places, repair statuses in three); (b) shapes diverge — some map to a single class string, others to `{dot, chip, label}`.

**Established pattern (proven by the pilot — follow for every remaining file):**
- **One canonical tone-meta shape** per domain, matching the exemplars: `{ label, badge, chip }` (badge = no ring, chip = with ring) — or `{ label, dot, pill }` where dots are used. Resolved via `*BadgeClass(code)` / `*ChipClass(code)` / `*Label(code)` functions with a safe fallback. Don't invent a new shape — mirror `unit-status.ts`/`outbound-state.ts`.
- **Per-domain registries** (`src/lib/<domain>-status.ts`), not one mega-map — repairs, sync-runs, agents, replenishment, RMA each get a `lib` SoT next to the existing `unit-status.ts`/`warranty/types.ts`.
- **Pure swap, preserving exact classes** — consolidation must be visually identical (no hue change). Snapping amber→`warning`/emerald→`success` aliases is a deliberate follow-up, not part of the swap.
- **Content-globs:** `src/lib` is in Tailwind's content globs, so classes authored in the registry are generated — but keep using already-common shades and restart dev after any content/safelist edit (the `outbound-state.ts` invisible-dot precedent).
- Migrate file-by-file; tsc-gated.

**✅ Pilot done 2026-06-21 — inventory triage (tracking exceptions):**
- New SoT `src/lib/inventory-triage-status.ts` (`triageStatusBadgeClass` / `triageStatusChipClass` / `triageStatusLabel`; states open/resolved/discarded).
- Retired the two divergent inline maps in `TriageWorkspace.tsx` (badge, no ring) and `sidebar/InventoryTriageSidebar.tsx` (chip, with ring) — the badge/chip split is exactly why one registry serves both. Classes preserved verbatim; tsc clean (exit 0).

**✅ Repair-status group done 2026-06-21 (reconciled, per user decision):**
- New SoT `src/lib/repair-status.ts` (`repairStatusBadgeClass` bordered/mobile + `repairStatusChipClass` flat/ops; one canonical hue per status). Retired the two CONFLICTING inline maps in `m/rs/[id]/page.tsx` (also fed its status-toggle buttons) and `KpiDetailsModal.tsx`. This one intentionally **changed colors** (the maps disagreed): hues now follow the color story — Awaiting Parts→warning, Pending Repair→info, Awaiting Pickup→success, Awaiting Payment→danger, Repaired/Contact→info, Done→success. tsc clean.

**✅ Warehouse + sync done 2026-06-21 (pure swaps):** `lib/replenishment-status.ts`, `lib/rma-status.ts`, `lib/sync-run-status.ts` — single-surface each, classes verbatim, tsc clean.

**✅ Mobile + operations done 2026-06-21 (pure swaps):** `lib/handling-unit-status.ts` (m/h), `lib/po-header-status.ts` (m/receiving/po), `lib/agent-status.ts` (OperationsAgentsRow — nested `{dot,chip,label}`), `lib/staff-goal-status.ts` (StaffGoalsRail — nested `{ring,dot,chip,label}`). tsc clean.

**`pane-header/blocks.tsx` — consciously NOT migrated.** Its `STATUS_TONE_CLASS` is a generic hue→class table *inside the reusable `PaneHeaderStatusPill` primitive* (consumed via `tone="amber"`, not copy-pasted), so it's already central — moving it adds no dedup value. It's the natural seed for the shared-palette follow-up.

**Registries built (9):** `inventory-triage-status`, `repair-status`, `replenishment-status`, `rma-status`, `sync-run-status`, `handling-unit-status`, `po-header-status`, `agent-status`, `staff-goal-status`. Named-`STATUS_TONE` scope = complete.

### T1b — broader `*_TONE` tail (found by post-migration sweep)

The original audit counted only maps literally named `STATUS_TONE`. A repo sweep found the **same class of scattered map under other names** — not yet migrated:
- `src/app/m/pick/[orderId]/page.tsx` — `CONDITION_TONE` ⚠️ may duplicate the `conditions.ts` SoT; check before making a new registry (might just delegate).
- `src/components/admin/QualityDashboardTab.tsx` **+** `src/components/labels/unit-detail/UnitQualityPanel.tsx` — `SEV_TONE` in **both** (severity; a dup pair like triage/repair → one `lib/severity-tone.ts`).
- `UnitQualityPanel.tsx` — also `RISK_TONE`, `REPAIR_TONE`.
- `src/features/operations/components/VelocityAndDeadStock.tsx` — `TIER_TONE`.
- `src/components/warranty/WarrantyQuotesSection.tsx` — `QUOTE_TONE`.
- `src/components/repair/mobile/RepairActionTimeline.tsx` — `TYPE_TONE`.
- `src/components/warehouse/BinsFilterBar.tsx` — `ACTIVE_TONE` (filter-active state; may not be a "status" — judge).

**✅ T1b done 2026-06-21 (6 registries):** `quality-severity-tone` (`SEV_TONE` dup → QualityDashboardTab **+** UnitQualityPanel), `quality-risk-tone` (RISK), `repair-outcome-tone` (REPAIR_TONE — distinct from repair-service status), `velocity-tier-tone` (TIER, nested `{bg,ring,label}`), `warranty-quote-status` (QUOTE — distinct from warranty claim status), `repair-action-type-tone` (TYPE). tsc clean.

**Deferred / out of scope:**
- `m/pick` `CONDITION_TONE` → folded into the **condition-color consolidation** (separate initiative, see below).
- `BinsFilterBar` `ACTIVE_TONE` → **judged out**: filter-button *active* styling coupled to local filter config (inactive half lives inline), not a reusable domain status.

**Refined landscape (post-full-sweep) — most `*_TONE` maps are NOT scatter.** A repo-wide sweep shows the majority of `*_TONE`/`TONE_*` constants are **correct primitive-internal variant tables** driven by a `tone="…"` prop (`CardShell`, `Toolbar`, `StickyActionBar`, `FloatingButton`, `ChevronToggle`, `WorkspaceCard`, `MobileSelectionBar`, `ConfirmDock`, `UpNextActionButton`, `HorizontalButtonSlider`, `StatusCard`, `StatPill`, `intakeFormClasses`) or dedicated chip/status primitives already central (`EventTimeline` `DOT_TONE`/`BADGE_TONE`, `ScanSurface` `BRACKET_TONE`, `pane-header` `STATUS_TONE_CLASS`, `warehouse/StatusChip`, `warranty/chips`). **Leave all of these** — they are the pattern, not the problem.

### T1c — residual genuine domain status maps — ✅ mostly done 2026-06-21

- **FBA** `STATUS_PILL_COLOR` → moved into the canonical `lib/fba/status.ts` (`FBA_STATUS_PILL` + `fbaStatusPillClass`, beside `FBA_STATUS_LABEL`); FbaBoardTable delegates. Pure swap.
- **`AuditLogReceivingClient`** — its 3 inline maps were **duplicates of canonical SoTs** in `receiving-constants.ts`; now delegate to `WORKFLOW_BADGE` / `QA_BADGE` / `DISP_BADGE`. This is a *consistency win* (audit-log badges now match every other receiving surface). Verified `WORKFLOW_BADGE` covers all 11 audit-log statuses. tsc clean.
- **✅ `ClipboardHistoryPopover` `TONE_DOT` done 2026-06-21:** added a `dot` field to `CHIP_TONES` (exact colors preserved) so it owns the accent-dot hue; clipboard delegates via `dotForKind()`, keeping only the non-chip `seller_claim` kind local. T1c fully closed.
- **Left as-is (correct tone-variant tables / already-central primitives):** `IncomingSidebarPanel` `TONE`, `IncomingSyncDialog` `TONE_MAP`, `KpiDetailsModal` `TONE_RING`, `DashboardKPICard` `TONE`, `OperationsMatrix` domain tones — all keyed by tone-name (a `tone=` prop), not domain status.

### Condition-color consolidation — 🔧 partial

- **✅ Inline-TEXT color deduped:** `ConditionText.getConditionColor` and `upnext-helpers.getConditionColor` were byte-identical; both now delegate to a single SoT `conditionTextColor` in `lib/conditions.ts` (export names kept → zero caller changes). tsc clean.
- **✅ Canonical grade→chip SoT chosen = receiving `conditionBadgeTone`** (decision 2026-06-21: "unify but keep the good colors" → adopt the established everywhere-SoT, which covers all 7 grades and already styles the dominant surfaces unchanged). **`m/pick` `CONDITION_TONE` retired** → now uses `conditionBadgeTone` + `conditionGradeTableLabel` (its outlier USED_A/USED_B colors conform to canonical; chip now also shows for LIKE_NEW/REFURBISHED). tsc clean.
- **⏳ Remaining condition surfaces — left to avoid color churn (pervasively divergent):** conforming any of these changes their colors, so they're deferred per "keep the colors the same":
  - `RecentActivityRailBase` — ring-chip with `-50`/`ring` shades + USED_A=emerald (canonical is `-100`, USED_A=blue). Different scheme.
  - `MobileCartonSheet`/`MobileReceivingRow`/`PoLinesSection` — these are inline-**text** colors (yellow-600/amber-800/gray-500), a near-miss of `conditionTextColor` (yellow-500/amber-800/black). Could converge on `conditionTextColor` but shades shift.
  - `sourcing-shared` `conditionTone` — free-text key-space (marketplace `new`/`used`/`refurbished`), distinct domain; would need a free-text→grade map.
  - **Net:** the two clear wins (inline-text dedup + m/pick chip) are done; the rest is genuine shade-reconcile, parked until there's appetite for the visual change.

**Shared-palette follow-up (still deferred):** with 9 registries now each re-declaring similar `bg-{hue}-{50|100} …` strings, extract a shared hue→class palette (badge/chip variants) they delegate to — unifies the `text-700`/`text-800` and `-50`/`-100` drift and gives T2 one dark-mode target. Deferred because normalizing those shades is a visual change (like the repair reconcile), and the repo's existing `StatusTone` types use *divergent* hue vocabularies (`orange`/`green`/`gray` vs `amber`/`emerald`/`slate`), so unifying needs a deliberate pass.

---

## 5. T2 — Theme wiring (light/dark + density)

**Current state:** `themes/light.ts` + `themes/dark.ts` both fully define the theme object (`{name, colors, surfaces, gradients, overlays, tonalNesting, functional, signature, primitives, fallback}`), but:
- **No theme provider/toggle exists.** `UIModeProvider` handles desktop/mobile density only — not color theme.
- `globals.css` `[data-theme='dark']` overrides only ~5 vars; the dark object's full override set is never applied.

**Direction:**
- Generate the **complete** `[data-theme='dark']` CSS-var override block from `dark.ts` (reuse the `flattenTokenTree` machinery in `css-variables.ts`) so the dormant dark values actually take effect — not a hand-maintained 5-var subset.
- Add a thin **theme toggle mechanism**: set `data-theme` on `<html>`. Resolve the initial value the same way mobile-nav config is resolved today — at auth load, from `staff_preferences.prefs.theme` (the blob already exists and backs the scan hotkey; no migration). This is exactly the chassis-doc Phase-4 hook.
- **Density** (`tokens/spacing.ts` `density` + `touch.ts` `mobileDensity`) becomes a second preference key (`prefs.density`) driving the comfortable/compact variants the chassis wants for "more info vs minimal" staff.
- Scope guard: **v1 is light/dark + density only** (per chassis decision). Full per-staff brandable palettes are out of scope.

**Risk note:** completing dark mode will expose every place using a raw `bg-gray-50`/`text-gray-900` instead of a semantic token — those won't flip. T4 (semantic aliases) should land first so migrations have a target.

**✅ Mechanism built 2026-06-21 (additive — light unaffected, dark inactive until opt-in):**
- `staff_preferences.theme` added to the contract (`StaffPreferences` read type + `StaffPreferencesPutBody` Zod, with `STAFF_THEMES`/`DEFAULT_THEME`).
- Complete `html[data-theme='dark']` overrides in `globals.css` for the 5 base vars **and** the 12 functional-tone vars (text→-400, surface/border→low-alpha hue tints). Selector hardened to `html[data-theme='dark']` (specificity 0,1,1) so it reliably beats the injected `:root` token block.
- `src/lib/theme/theme.ts` — pure `applyTheme()` + `THEME_BOOT_SCRIPT` (no-FOUC, reads localStorage before paint).
- `src/components/theme/ThemeSync.tsx` — mirrors `ScanHotkeySync`; reconciles `data-theme` from server `prefs.theme`. Mounted in `app/layout.tsx` beside `ScanHotkeySync`; boot script injected in `<head>`.
- **A `useStaffPreferences().update({ theme: 'dark' })` from anywhere now flips the app cross-device, no flash.**
- **✅ Toggle shipped:** Settings → Appearance → **Theme** (Light/Dark) in `AppearanceSection.tsx` — calls `update({ theme })` + `applyTheme()` for instant feedback; replaced the "coming soon" placeholder. T2 is functionally complete.
### Dark-mode *adoption* — broad coverage shipped via a scoped override layer

**✅ 2026-06-21 — global dark-override layer (`src/styles/globals.css`).** The UI is built with hardcoded light utilities (`bg-white`/`bg-gray-50`/`text-gray-900`/…) across thousands of call sites; migrating each is enormous and flipping text without its background breaks contrast on light accent pills. So dark coverage is delivered by a **scoped override layer**: rules under `html[data-theme='dark']` remap the common neutral surfaces/text/borders **and** the light accent-pill fills (`bg-blue-50`→tint, etc.) + invert dark elements (`bg-gray-900`→mid-slate). Higher specificity (type+attr+class) beats Tailwind's single-class utilities; **light mode is byte-for-byte unchanged** (every rule is dark-scoped). This flips the sidebar, page shells, cards, and the active/selected pills app-wide in one place, and fixed the unreadable light-pill-with-white-text bug.
- **Caveats / per-case follow-ups:** opacity-modified variants (`bg-white/80`) and arbitrary `bg-[#…]`/`gray-[…]` values aren't matched; a few intentionally-light or inverted elements may need targeted rules. Refine per-surface as issues surface; the semantic-token aliases (below) remain the preferred path for *new* code.

**Foundation also laid (semantic path, for new/migrated code):**
- **Full neutral ramp aliases** added (`text-soft`=gray-500, `text-faint`=gray-400, `surface-sunken`=gray-100, `border-default`=gray-300; light-exact, dark overrides in `html[data-theme='dark']`), alongside the existing `text-default`/`text-muted`/`surface-card`/`surface-canvas`/`border-soft`. These are the vocabulary the adoption sweep will use.
- **`AppearanceSection`** migrated to the exact-safe aliases (proof surface, since the toggle lives there).

**⚠️ Resolve before sweeping further (why this isn't a quick blind sweep):**
1. **`--ds-color-text-secondary` is inconsistent** — `globals.css` hardcodes `#475569` (gray-600) but the SoT (`semantic.ts`) + `tokens.ts` say gray-700 (`#334155`). So `text-muted` is ambiguous; `text-gray-700 → text-muted` is **not** provably exact until this is reconciled. (Left `text-gray-700` literal in AppearanceSection for now.)
2. **Pitfalls:** opacity modifiers (`bg-x/10` won't compute opacity on a `var()` color), arbitrary `gray-[…]`, and non-exact shades (`gray-600`/`gray-800`, `bg-gray-900` dark accents that should *invert*, not flip).
3. Then sweep `settings/sections/*` + page shell, then broader app — per-surface reviewed, tsc + build-gated. Optional `<meta theme-color>` dark swap.

---

## 6. T6-precursor — the SoT inventory (authoritative list)

The single list the chassis (and everyone) must consume, never fork:

| Concern | SoT | Never do instead |
|---|---|---|
| Z-index | `tokens/z-index.ts` | hardcode `z-[NNN]` / inline `zIndex` numbers |
| Condition grade→label | `lib/conditions.ts` | inline a grade→label map |
| Source platform→label/tone | `lib/source-platform.ts` | inline a platform map |
| Unit pipeline status | `lib/unit-status.ts` | inline unit tone classes |
| Unshipped/outbound dots | `lib/unshipped-state.ts` + `lib/outbound-state.ts` | hand-pick dot hues (must stay hue-distinct) |
| Copy-chip tones | `CopyChip.tsx` `CHIP_TONES` | recolor chips (FNSKU ≠ Tracking) |
| Sidebar gutter / search band | `SIDEBAR_GUTTER`, `sidebarHeaderSearchRowClass` | hardcode sidebar padding/row heights |
| Motion | `foundations/motion-framer.ts` | inline `transition`/`animate` numbers (T3) |
| Status tones (post-T1) | per-domain `lib/<domain>-status.ts` | inline `STATUS_TONE` |

---

## 7. T3 — Motion-token adoption

**Problem:** ~155 inline `animate={{…}}` + ~111 inline `transition={{…}}` across components duplicate values that already exist as `framerDuration`/`framerTransition`/`framerPresence` (e.g. `SidebarRailShell` hardcodes `duration: 0.18, ease: [0.22,1,0.36,1]` = `framerDuration.stationChevron` + `motionBezier.easeOut`). The library is complete; adoption isn't.

**Direction:**
- Catalog the inline instances; tag each to its token equivalent (most map 1:1 to an existing preset).
- Migrate opportunistically (when touching a file) plus a focused sweep of the high-traffic shells (sidebar, overlays, station rows).
- Consider a lightweight lint/grep guard flagging new inline `transition={{ duration:` literals, steering to the token import.

**🔧 In progress 2026-06-21 — easing-curve consolidation (the clean part):**
- The duplicated easing magic-array `[0.22, 1, 0.36, 1]` (= `motionBezier.easeOut`) appeared in ~30 spots across 25 files. Replacing the literal with the named token is exact + zero timing change. Pattern: `import { motionBezier }` → `ease: motionBezier.easeOut`.
- **✅ COMPLETE 2026-06-21:** every framer occurrence now sources from `motionBezier.easeOut` (verified repo-wide; tsc clean). `StationTesting`'s local `STATION_EASE_OUT` const now points at the token too. The only remaining match is `FilterRefinementBar`'s Tailwind `ease-[0.22,1,0.36,1]` *class* — intentionally excluded (CSS utility, not a framer value).
- **Correction to an earlier audit note:** durations do NOT map cleanly (`0.18` ≠ `framerDuration.stationChevron`, which is `0.28`); value-only matching is misleading, so durations need a careful per-site pass with semantically-correct tokens — NOT a blind swap.
- **✅ All ~24 framer files done** across iterations: SidebarRailShell, TabSwitch, SelectionActionBar, RightPaneOverlay, EventTimeline, MobileBottomActionBar, FavoritesDefaultView, RecentActivityRailBase, LocalPickupReviewPanel, BootSplash, OrderSearchEmptyState, MobileRowCard, StationScanBar, SquareProductSearchPopover, ReceivingRightPane, UpNextActionButton, StationTesting, UpNextFilterBar (×2), CartonAddPopover, ReceivingLineWorkspace, PhotoPeekFan, EcwidProductSearchPopover, FbaBoardRegion (×2), FbaShipmentEditorForm.
- **⛔ Excluded (false positive):** `FilterRefinementBar` uses a Tailwind arbitrary class `ease-[0.22,1,0.36,1]` (CSS utility, not a framer value).
- **✅ Duration pass — RESOLVED (decision 2026-06-21): durations stay literal.** Inline `duration: N` values do NOT map 1:1 to named tokens (`0.18`/`0.22`/etc. each span several semantic tokens; `0.18 ≠ stationChevron`'s `0.28`), so forcing a token would be arbitrary or misleading. The shared *easing curve* was the real duplication (one magic-array repeated 30×) and is now fully consolidated to `motionBezier.easeOut`. Per-component durations are legitimately local tuning; leaving them literal is correct, not debt. T3 is complete.

---

## 8. T4/T5 — Tailwind wiring gaps

- **T4 Semantic color aliases — ✅ DONE 2026-06-21.** Added the functional triad + accent across text/surface/border as Tailwind aliases, mirroring the existing compound-key convention:
  - **Aliases (`tailwind.config.ts`):** `text-success|warning|danger|accent`, `surface-success|warning|danger|accent`, `border-success|warning|danger|accent`. Used as `text-text-success`, `bg-surface-success`, `border-border-success` (doubled prefix, matching `text-text-default`/`bg-surface-canvas`).
  - **CSS vars (`src/styles/globals.css` `:root`):** 12 `--ds-color-{text|surface|border}-{tone}` vars, literal-hex, values mirror `semanticColors`. Injected at runtime via the existing `globals.css` + `designTokenStyleText` chain in `app/layout.tsx`.
  - **Token SoT (`tokens/colors/semantic.ts`):** added `surfaceSubtle` (green/orange/red/navy `-50` pastels) so the pill-fill values have a real home in the token tree.
  - **Verified:** real Tailwind build emits the utilities pointing at the correct vars.
  - **Deferred to T2:** dark-mode `[data-theme='dark']` overrides for these 12 vars (light values only today). Adopting the aliases now means automatic dark support once T2 lands.
  - *Still open under T4 umbrella:* migrating the ≈2,780 raw `bg-emerald-50`/`text-rose-600` usages onto these aliases (incremental, pairs with T1).
- **T5 Typography presets as a layer — ⛔ WON'T DO (resolved 2026-06-21).** The presets in `tokens/typography/presets.ts` are *already* the reusable SoT — exported constants imported directly (`className={sectionLabel}`), used across components. A Tailwind `@layer components`/plugin class API would either **duplicate** the utility strings (CSS can't import the TS SoT) or rely on `@apply`-in-plugin which isn't reliably supported — so it adds a parallel API with **zero dedup gain** and a duplication risk. The drift-prevention goal T5 was meant to serve is met by the constants. Leaving as-is. (If anything, the future work is *adoption* — replacing any remaining hand-typed label/value class strings with the preset imports — which is the same judgment sweep as T3, not an `@layer`.)
- **Gotcha:** keep the explicit `.ts` extension on the z-index import in `tailwind.config.ts` (Turbopack dev resolver won't guess `.ts`; silent drop of `z-*` utils in dev only).

---

## 9. T6 — Color-story documentation — ✅ DONE 2026-06-21

Expanded the **Functional Color Mapping** section in `src/design-system/DESIGN_SYSTEM.md` into a full color story:
- **Functional hues table** (meaning → hue → `semanticColors.functional.*` token).
- **Status-pill triad table** (the T4 `surface`/`text`/`border` aliases as a copy-paste recipe).
- **Rule for new tone registries:** map each state to a meaning in the table, then to the matching tone; no new hue without adding it to the table first — this is the guardrail T1 enforces.

Lives in `DESIGN_SYSTEM.md` (the spec/law doc) rather than here, so the rule sits next to the CopyChip/TabSwitch hard rules new code already consults.

---

## 10. Suggested sequencing

1. **T4 + T6** first (small, unblock everything): semantic aliases + documented hue meanings give T1/T2 a target.
2. **T1** registry consolidation (per-domain, file-by-file, content-glob-aware).
3. **T2** theme wiring (now that semantic aliases exist to flip).
4. **T3** motion adoption (continuous, opportunistic + one sweep).
5. **T5** typography layer (independent, any time).

Each step is independently shippable and tsc/build-gated. Ordering chosen so later steps have the tokens earlier steps create.

---

## 11. Anti-patterns / drift guards

- **One shape for tones.** Don't reintroduce divergent `STATUS_TONE` shapes — mirror `outbound-state.ts` (`{label, dot, pill}` + resolver fn).
- **Lib-file classes must be generated.** Any Tailwind class authored in `src/lib` needs an already-generated shade or a safelist entry + dev restart (the outbound-state invisible-dot bug).
- **Semantic over raw.** New code uses semantic aliases / token vars; raw `bg-color-NNN` only where no semantic token fits (and that's a signal to add one).
- **Consume, don't fork.** The chassis refactor and all pages import from §6's SoT list. A new inline map is a regression.
- **Theme scope locked.** v1 = light/dark + density. No per-staff color palettes.

---

### Appendix — primary file anchors

- Tokens: `src/design-system/tokens/{z-index,spacing,radii,shadows,borders,touch}.ts`, `tokens/colors/{base,semantic}.ts`, `tokens/typography/*`, `tokens/css-variables.ts`.
- Motion: `src/design-system/foundations/{motion,motion-framer}.ts`.
- Themes: `src/design-system/themes/{light,dark}.ts`; `src/styles/globals.css` (`[data-theme]`); `src/design-system/providers/UIModeProvider.tsx`.
- Tailwind: `tailwind.config.ts`.
- Exemplar registries: `src/lib/{unit-status,outbound-state,unshipped-state,conditions,source-platform}.ts`, `src/lib/warranty/types.ts`, `src/components/ui/CopyChip.tsx`.
- Scatter to fix: see §4 table.
- Current spec: `src/design-system/DESIGN_SYSTEM.md`.
- Related: `docs/station-chassis-refactor-discovery.md` (consumer), `design-2026-component-adoption` initiative + `/design-demo` showroom.
</content>
