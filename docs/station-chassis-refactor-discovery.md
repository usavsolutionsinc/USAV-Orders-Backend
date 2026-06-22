# Station Chassis Refactor — Discovery Report

**Status:** Discovery only. No code changes proposed yet — this maps the terrain and proposes a target architecture + phasing.
**Date:** 2026-06-21
**Goal:** Collapse every station page (Receiving, Tech, Packer, FBA, Outbound, Walk-in, …) onto ONE reusable **scan → crossfade → display** chassis, so the receiving pipeline's quality is inherited everywhere, redundancy is removed, behavior is predictable, and per-staff UI variation becomes a config concern rather than a fork.

---

## 0. The one-paragraph thesis

The "gold standard algorithm" you're describing — *scan, crossfade, display, with per-mode sidebar filters and a per-mode right-pane* — **already exists twice** in this codebase, and the refactor is to make the two converge:

1. **The reference implementation:** the Receiving pipeline. A genuinely well-decomposed page (≈30 focused hooks + a `ReceivingRightPane` that crossfades table ⇄ scan-loader ⇄ workspace via `framer-motion`), but it is hard-wired to receiving's domain.
2. **The abstraction, already drafted:** `src/lib/stations` — a "blocks = code, composition = data" station-builder contract whose `SlotId = 'trigger' | 'queue' | 'workspace' | 'advance' | 'header'` is *exactly* the scan→crossfade→display anatomy, with data-source/action registries that wrap existing routes. It has an Incoming pilot and a `BlockConfigSheet`, but the real station pages don't run on it yet.

**The refactor = extract a runtime "Station Chassis" out of the receiving pipeline, express it in the station-builder contract, and re-host every station as a configuration over that chassis.** Per-staff theming/rails then becomes a `staff_preferences` + station-override layer, not a new fork per person.

This is the lowest-redundancy path because it does not invent a third abstraction — it promotes the proven one (receiving) into the slot-contract that's already designed for it.

---

## 1. The gold-standard anatomy (Receiving), decomposed

The receiving page at `src/app/receiving/page.tsx` is `Sidebar (modes + scan + rails)` + `RightPane (crossfade display)`, driven entirely by URL state (`?mode=`, `?unboxview=`, `?triview=`, `?recvId=`). Decomposed into reusable concerns:

| Anatomy slot | Receiving concrete | Reusable primitive today | Generalizable? |
|---|---|---|---|
| **Mode switch** | `ReceivingModeSwitcher` (incoming/triage/receive/pickup/history) | `HorizontalButtonSlider` + `?mode=` URL | ✅ already generic |
| **Trigger (scan)** | `ReceivingUnboxScanBar` / `TriageScanBand` → `useTrackingScan` | `StationScanBar` base + `scan-hotkey` store | ⚠️ base shared, orchestration domain-specific |
| **Queue (rails/filters)** | `ReceivingRailBody`, `UnboxViewToggle`, `ReceivingRecent/Scanned/ViewedRail` | `SidebarRailShell`, `rail-edit-mode`, `StatusLegend` | ✅ rail skeleton already generic |
| **Crossfade** | `ReceivingRightPane` (table ⇄ `ReceivingScanLoader` ⇄ workspace, `AnimatePresence`) | `framerPresence`/`framerTransition` in `motion-framer.ts`; **no named crossfade host** | ⚠️ pattern exists, not extracted |
| **Workspace (display)** | `ReceivingLineWorkspace` → `ReceivingProgressStepper` + `LineEditPanel` | accordion + stepper are receiving-specific | ⚠️ shell generic, body domain |
| **Advance (commit)** | `LineReceiveActionBar` / `useReceiveAction` | sticky action bar pattern | ⚠️ per-domain action |
| **Row display** | `ReceivingLineOrderRow` → `RowTitle`/`RowMetaColumns`/`ReceivingIdentityChips` | `RowMetaColumns`, `ChipColumns`, `CopyChip`+`CHIP_TONES` | ✅ already shared primitives |

**Key takeaways:**
- The **state contract is event-driven**: sidebar dispatches `CustomEvent`s (`receiving-workspace-open`, `-scan-in-flight`, `-scan-resolved`, `-arm-line`…) that the right pane listens for. This is the seam that makes scan→crossfade→display loosely coupled — and it's the seam to standardize.
- The **crossfade is the one genuinely missing primitive.** `ReceivingRightPane` hand-rolls: always-mounted table (visibility-hidden in non-table modes) < empty-state < scan-loader (300 ms grace delay, 500 ms linger) < workspace (`AnimatePresence`, fade+rise, respects reduced-motion) < detail slide-over. This exact stack is what every station wants and what every station currently re-invents or skips.

---

## 2. Current state of duplication (the matrix)

Stations found: **Receiving** (gold), **Tech/Testing**, **Packer**, **FBA** (Kanban, intentionally different), **Outbound** (scan-out), **Walk-in** (repairs/sales), plus non-station pages (**Products**, **Studio**, **Warehouse**, **Dashboard**) and the separate **`/m/*` mobile** tree.

| Concern | Receiving | Tech | Packer | FBA | Outbound | Walk-in |
|---|---|---|---|---|---|---|
| Sidebar mode switch | custom pills | `HorizontalButtonSlider` | `HorizontalButtonSlider` | `HorizontalButtonSlider` | (sidebar) | `?mode=` |
| Scan bar | `StationScanBar`+wrap | `TestingScanBar` (fork) | in `StationPacking` (fork) | `FbaWorkspaceScanField` (fork) | `ScanOutStationBar` (fork) | mobile QR |
| Mode URL param | `?mode=` | `?view=` | `?packMode=` | `?mode=` | — | `?mode=` |
| Row display | custom row | `TechRecordRow` | `PackerRecordRow` | Kanban cards | — | `RepairTable` |
| Status dots | `receiving-constants` | `SOURCE_DOT_BG` (dup) | `SOURCE_DOT_BG` (dup) | — | `outbound-state` | — |
| Crossfade host | `ReceivingRightPane` ✅ | none | none | slide panel | — | — |
| Detail panel | `useReceivingDetailOverlays` | `useTechDetailOverlays` (fork) | `useStationDetailsSelection` ✅ | `useFbaDetailPanel` (fork) | — | custom |
| Bulk select | `useReceivingLineBulkSelection` ✅ | `useTechTestingSelection` (fork) | (fork) | — | — | — |
| Shared row primitives | ✅ | ✅ | ✅ | partial | ? | ? |

**The highest-value, lowest-risk duplication targets (confirmed by reading the files):**

1. **`TechRecordRow` ≈ `PackerRecordRow`** — near-identical chip-grid rows; both re-declare a `SOURCE_DOT_BG`/`getSourceDotType` map inline instead of using `source-platform.ts`. (`src/components/station/TechRecordRow.tsx:51-112` vs `PackerRecordRow.tsx:36-93`.)
2. **Five forked scan bars** all wrapping the same idea (`TestingScanBar`, packing scan, `FbaWorkspaceScanField`, `ScanOutStationBar`, receiving bands) — none share a scan-orchestration hook, only the visual `StationScanBar` base in some cases.
3. **Four mode-switch conventions** (`?mode` / `?view` / `?packMode`) with four bespoke parser hooks (`useReceivingDashboardMode`, `useTechRightView`, inline packer parse, `resolveFbaMode`).
4. **Three detail-overlay hooks** and **three bulk-select hooks** that are the same shape with different field names.
5. **Hand-rolled per-page `STATUS_TONE` maps** scattered across pages — no central status-tone registry the way `conditions.ts` centralizes condition labels.

---

## 3. What you already have to build on (don't rebuild these)

**Sidebar/mode system (mature):** `SidebarShell` → `SidebarContextPanel` (route→panel registry) → per-page panel composing `HorizontalButtonSlider` (mode pills, 5 variants) + `SidebarRailShell` (generic recent-activity rail: fetch, optimistic, pin-top-N, keyboard nav, hover preview) + `rail-edit-mode` provider (pencil → multi-select → bulk bar). Layout tokens unified via `SIDEBAR_GUTTER`, `sidebarHeaderSearchRowClass`, `sidebarHeaderPillRowClass`.

**Station-builder contract (the target shape):** `src/lib/stations/contract.ts` defines `SlotId`, `FieldKind` (po_ref/tracking_ref/order_ref/sku_ref/serial_ref/condition_grade/source_platform/…), `BlockDefinition`, `DataSourceDefinition` (wraps an existing GET route + declares field shape), `ActionDefinition` (wraps an existing mutation), `StationConfig` (`{slots}` *or* the literal `'legacy'` escape hatch), persisted in `station_definitions` (org/pageKey/modeKey/config JSONB/version/isActive). Registries in `blocks/registry.ts`, `data-sources.ts`, `actions.ts`. One checklist block + 3 data sources + 4 actions exist; Incoming is the pilot. `BlockConfigSheet` (Source/Display/Actions tabs) is the admin editor.

**Scan primitives:** `scan-hotkey/store.ts` (framework-agnostic F1–F12 global focus binding, localStorage + `staff_preferences` server truth, focus-target stack) + `useScanHotkey`/`useRegisterScanTarget` + `ScanHotkeyControl` gear. `StationScanBar` is the shared visual chrome.

**Display primitives:** `RowMetaColumns`/`RowTitle` (`META_COL` fixed virtual columns), `ChipColumns` (`CHIP_COL`), `CopyChip` + `CHIP_TONES` + `useCopyChip`/`useChipTooltip`, `StatusLegend` (dot-legend doubling as count filter), `EventTimeline` (+ `src/lib/timeline` adapters), `DateTimeValue`, status models `unshipped-state.ts`/`outbound-state.ts`, registries `conditions.ts`/`source-platform.ts`, `z-index.ts` token scale.

**Animation:** `src/design-system/foundations/motion-framer.ts` centralizes `motionBezier`, `framerDuration`, `framerTransition`, `framerPresence`, `framerGesture` (incl. `tabPager` x-slide+opacity crossfade, `workOrderBodyCrossfade`). There is **no named "crossfade host" component** — that's the gap.

**Studio:** `/studio` + `StudioWorkspaceContext` (semantic zoom L0–L3, 5 lenses, diagnostics gate) is the *authoring/observe* surface for `station_definitions`. The chassis refactor is its runtime counterpart — Studio designs the config, the chassis renders it.

---

## 4. Target architecture — the Station Chassis

### 4.1 One runtime, five slots

Create a `StationChassis` runtime (new, thin) that renders a `StationConfig` into the proven receiving layout:

```
<StationShell config=… theme=… >          // resolves slots, owns URL ?mode= + event bus
  Sidebar:
    [header]   ← ModeSwitcher (HorizontalButtonSlider, from config.modes)
    [trigger]  ← StationScanBar + useStationScan (generic orchestration)
    [queue]    ← SidebarRailShell-driven rails/filters (from config.queue blocks)
  RightPane:
    <CrossfadeHost>                         // NEW extracted primitive (see 4.3)
      table  ⇄  scan-loader  ⇄  workspace  ⇄  detail-overlay
    </CrossfadeHost>
       [workspace] ← block-composed display (from config.workspace blocks)
       [advance]   ← sticky action bar (from config.advance actions)
</StationShell>
```

Each station (Receiving, Tech, Packer, Outbound, Walk-in) becomes **a `StationConfig` row**, not a folder of bespoke components. FBA's Kanban stays a `'legacy'`-escape-hatch workspace block (don't force a board into a table — but it still reuses the shell, mode switch, scan bar, and detail panel).

### 4.2 The standardized event/state contract

Promote receiving's `CustomEvent` seam into a typed `StationEventBus` (or a small context) with a fixed vocabulary: `scan:in-flight`, `scan:resolved`, `workspace:open`, `workspace:update`, `workspace:close`, `queue:select`, `detail:open`. Every station speaks the same events; the chassis owns the crossfade reaction to them. This is what makes behavior "predictable" — the wiring is identical everywhere.

### 4.3 The missing primitive: `CrossfadeHost`

Extract `ReceivingRightPane`'s logic into a domain-agnostic `CrossfadeHost`:
- Always-mounted **base layer** (table/board), `visibility` toggled by mode.
- **Loader layer** with the 300 ms grace delay + 500 ms linger (so fast/local scans never flash a skeleton) — driven by `scan:in-flight`/`scan:resolved`.
- **Workspace layer** via `AnimatePresence` + `framerPresence` (fade+rise, reduced-motion aware).
- **Detail slide-over** layer.
- Z-ordering from `z-index.ts`.

This single component, used by all stations, is the literal "crossfade" you described and the biggest correctness win (the grace/linger timing is subtle and currently only receiving gets it right).

### 4.4 Generic hooks to replace the forks

- `useStationMode(pageKey)` — one URL-state hook (normalize on `?mode=`; migrate `?view=`/`?packMode=` with back-compat redirects) replacing 4 parsers.
- `useStationScan({ classifiers, resolvers })` — generic scan orchestration (classify → local-first → integration fallback) parameterized by domain resolvers, replacing 5 forked scan flows. Receiving's internal-code/local-first/Zoho cascade becomes the *configured* resolver chain.
- `useStationDetailOverlays` — already half-generic (`useStationDetailsSelection`); fold `useReceivingDetailOverlays`/`useTechDetailOverlays`/`useFbaDetailPanel` into it.
- `useStationBulkSelection` — generalize `useReceivingLineBulkSelection` (the actions list becomes config-driven), retire `useTechTestingSelection` and the packer fork.

### 4.5 Row rendering convergence

Collapse `TechRecordRow`/`PackerRecordRow` into one `StationRecordRow` driven by `FieldKind` → renderer mapping (po_ref→`OrderIdChip`, tracking_ref→`TrackingChip`, serial_ref→`SerialChip`, source_platform→dot from `source-platform.ts`, condition_grade→`conditions.ts`). Kill both inline `SOURCE_DOT_BG` maps. This is the cleanest immediate win and a template for the whole "blocks render by field kind" idea.

---

## 5. Per-staff / per-role UI variation (themes & rails)

This is achievable **without per-person forks** because the substrate exists:

**Storage — extend the existing generic blob.** `staff_preferences (org, staff, prefs jsonb)` already backs the scan hotkey via `/api/staff-preferences` (GET/PUT merge). Add keys, no migration:
```jsonc
prefs: {
  focusScanHotkey: "F2",            // exists today
  theme: "light" | "dark",          // themes defined, no toggle yet
  stationRails: { receiving: ["recent","viewed"], tech: ["testing"] },
  tableColumns: { "tech.testing": ["po","serial","condition"] },
  density: "comfortable" | "compact",
  viewDefaults: { receiving: "receive", tech: "testing" }
}
```

**Resolution order for what a staffer sees in a station** (highest wins):
1. Per-staff `prefs.stationRails`/`tableColumns`/`density` (personal taste — your "testing rail vs minimal recent rail" example).
2. Per-role override (optional new `station_role_overrides` table, same shape as `station_definitions.config`).
3. Org `station_definitions.config` (the published Studio design).
4. `'legacy'` hard-coded fallback.

This mirrors the **already-working precedent**: mobile bottom-nav resolves role defaults (`roles.mobile_defaults`) overlaid by per-staff override (`staff.mobile_display_config`) inside `AuthContext.resolveMobileDisplayConfig`. We copy that exact pattern for station layout.

**Theming.** `lightTheme`/`darkTheme` + CSS-variable tokens (`--ds-color-*`) + `z-index.ts` are in place; there is no `data-theme` toggle. Wire `prefs.theme` → `data-theme` on `<html>` at auth load (same place mobile config resolves). Centralize the scattered per-page `STATUS_TONE` maps into a tone registry (like `conditions.ts`) so themes can re-skin statuses coherently — prerequisite for "more info vs minimal" density variants to look intentional.

> **Owned by the token layer, not here.** The `data-theme`/density mechanism, dark-theme completion, and the `STATUS_TONE` consolidation are foundation-layer tasks specified in **`docs/design-system-token-simplification.md`** (T1, T2). This chassis plan only *consumes* the result — Phase 4 selects a theme/density via `staff_preferences`; it does not define the tokens. Likewise the "consume not fork" SoT list (§7 below) is maintained authoritatively in that doc's §6.

**Permission gating already exists** (`permission-registry.ts`, `role-store`, `computeEffectivePermissions`, `sidebar-navigation` `requires`) — block/action visibility per role is solved; we reuse `requiredPermissions` on `BlockDefinition`.

---

## 6. Phasing (each phase independently shippable, tsc/build-gated)

**Phase 0 — Extract primitives (no behavior change, pure dedup).**
- `CrossfadeHost` extracted from `ReceivingRightPane`; receiving re-hosted on it (proves parity). *(not started — risky, touches receiving; do supervised.)*
- `StationRecordRow` (field-kind driven); migrate Tech + Packer rows; delete inline dot maps.
  - **🔧 2026-06-21 — chip grid + row shell shared (Tech+Packer):**
    - `src/components/station/station-chip-columns.tsx` (`buildStationChipColumns` + `buildStationFnskuColumns`) — the platform/order-id/tracking[/serial] column construction (was byte-identical copy-paste).
    - `src/components/station/StationRecordShell.tsx` — the zebra grid + source-dot title + qty/condition meta + chip-grid chrome (the `animated` prop covers Packer's mount/hover motion vs Tech's static row).
    - `src/utils/source-dot.ts` `resolveStationSource()` — returns `{dotType, isSku}` in one `getSourceDotType` pass (rows previously called it twice: directly + inside `isSkuSourceRecord`). Both rows use it; tech still ORs `has_sku_serial_source`.
    - `TechRecordRow` 145→~90 lines, `PackerRecordRow` 130→~78; both now = record-specific derivation + delegation. Output identical; tsc clean.
    - **Remaining for a *full* `StationRecordRow`:** a normalized record shape so the two record types collapse into one component + field-kind-driven dot/condition mapping (and retiring the `SOURCE_DOT_BG` inline maps onto `source-platform.ts`). The shared shell+builders are the reusable core that component will sit on.
- Central `status-tone` registry; migrate per-page `STATUS_TONE`. **✅ effectively done** via the token-plan T1/T1b/T1c (9+ per-domain `lib/<domain>-status.ts` registries).
- *Risk: low. Payoff: immediate redundancy cut + the crossfade primitive everyone needs.*

**Phase 1 — Generic hooks.**
- `useStationMode` (with `?view`/`?packMode` back-compat), `useStationDetailOverlays`, `useStationBulkSelection`. Migrate Tech/Packer/Outbound onto them.

**Phase 2 — Generic scan.**
- `useStationScan` + a single `StationScanBar` config surface; collapse the 5 forks. Receiving's resolver cascade becomes the reference resolver chain.

**Phase 3 — Chassis runtime + config.**
- `StationShell` rendering `StationConfig` via the slot contract. Re-express **one simple station first** (Outbound or Tech) as a config row in `station_definitions` (the Incoming pilot already proves the registry path). Keep receiving on `'legacy'` until parity is independently demonstrated.

**Phase 4 — Per-staff/role layer.**
- Extend `staff_preferences` keys + resolution merge; `data-theme` wiring; optional `station_role_overrides`. Surface a lightweight per-staff "what's in my sidebar" control (reuse `BlockConfigSheet` patterns / the rail toggle UI).

**Phase 5 — Studio tie-in.**
- `station_definitions` edited in `/studio` (L2/L3) now drive the live chassis; diagnostics gate publish. This closes the loop: design in Studio → render in chassis → personalize via prefs.

---

## 7. Anti-patterns to avoid (drift guards)

- **Don't invent a third abstraction.** Use `src/lib/stations/contract.ts` slots as the vocabulary; if a slot is missing, extend the contract, don't fork.
- **Don't force every station into a table.** FBA Kanban and any future board stay `'legacy'` workspace blocks but still inherit shell/scan/crossfade/detail.
- **Keep `'legacy'` escape hatch real.** Migrate station-by-station behind it; never a big-bang cutover. Receiving stays last (it's the parity oracle).
- **Per-staff variation is config, never code.** If a personalization needs a new component, it belongs as a *block* in the registry, selectable by config — not a per-person branch.
- **Preserve the event seam.** The loose coupling between scan/queue/crossfade/workspace is *why* receiving is maintainable; the chassis must keep that boundary, not collapse it into one mega-component.
- **Respect existing SoTs:** `source-platform.ts`, `conditions.ts`, `CHIP_TONES`, `z-index.ts`, `motion-framer.ts`, `SIDEBAR_GUTTER`. The refactor *consumes* these; it must not spawn parallel copies.

---

## 8. Decisions (confirmed 2026-06-21)

1. **Convergence target — DECIDED:** Promote the receiving pipeline into the `src/lib/stations` slot contract (not a separate "station kit"). Reuses the most existing work and ties the runtime to the Studio authoring surface.
2. **First station to migrate (Phase 3) — DECIDED: Outbound.** Smallest surface (scan-out only), cleanest parity proof with least domain noise. Receiving stays `'legacy'` as the parity oracle until last.
3. **Theming scope for v1 — DECIDED:** density + which-rails-show + light/dark, all via `staff_preferences` JSONB. Full brandable per-staff color theming is explicitly out of v1 scope.
4. **Per-role overrides (still open):** lean toward shipping per-staff prefs first (cheap JSONB) and deferring a `station_role_overrides` table until a concrete need appears — revisit at Phase 4.

---

### Appendix — primary file anchors

- Receiving page/shell: `src/app/receiving/page.tsx`, `src/components/receiving/ReceivingDashboard.tsx`, `ReceivingRightPane.tsx` (crossfade), `workspace/ReceivingLineWorkspace.tsx`, `sidebar/ReceivingSidebarPanel.tsx`.
- Station-builder contract: `src/lib/stations/contract.ts`, `blocks/registry.ts`, `data-sources.ts`, `actions.ts`, `src/components/stations/BlockConfigSheet.tsx`.
- Sidebar system: `src/components/sidebar/SidebarShell.tsx`, `SidebarContextPanel.tsx`, `SidebarRailShell.tsx`, `rail-edit-mode.tsx`, `ui/HorizontalButtonSlider.tsx`, `layout/header-shell.ts`.
- Scan: `src/lib/scan-hotkey/store.ts`, `useScanHotkey.ts`, `components/scan/ScanHotkeyControl.tsx`, `components/station/StationScanBar.tsx`.
- Display primitives: `ui/RowMetaColumns.tsx`, `ui/ChipColumns.tsx`, `ui/CopyChip.tsx`, `ui/StatusLegend.tsx`, `ui/EventTimeline.tsx`, `design-system/components/DateTimeValue.tsx`.
- Status/registry SoT: `lib/unshipped-state.ts`, `lib/outbound-state.ts`, `lib/conditions.ts`, `lib/source-platform.ts`, `design-system/tokens/z-index.ts`, `design-system/foundations/motion-framer.ts`.
- Preferences/identity: `lib/migrations/2026-06-21_staff_preferences.sql`, `api/staff-preferences/route.ts`, `lib/schemas/staff-preferences.ts`, `contexts/AuthContext.tsx` (`resolveMobileDisplayConfig`), `lib/auth/permission-registry.ts`, `role-store.ts`.
- Duplication hotspots: `components/station/TechRecordRow.tsx` vs `PackerRecordRow.tsx`; forked scan bars (`TestingScanBar`, `FbaWorkspaceScanField`, `outbound/scan-out/ScanOutStationBar`).
- Related prior plans: `docs/receiving-workspace-mode-primitives-plan.md`, `docs/operations-studio/station-builder-ui-plan.md`, `docs/operations-studio/operations-studio-plan.md`.
</content>
</invoke>
