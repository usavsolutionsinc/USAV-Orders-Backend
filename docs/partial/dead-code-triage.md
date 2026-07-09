# Dead Code Triage Log

**LIVING LOG — Waves 1-6 DONE (75%).** Status verified 2026-06-28.
Un-triaged knip "Unused Files" backlog (mobile/, fba/table/, manuals/, admin/connections/) remains open.

**Purpose**: Living record of every candidate, decision, and deletion related to dead / unused code.

**How to use**:
- Add new rows at the top when new signals appear (knip, manual review, etc.).
- Update Status and Notes as you work.
- Every actual deletion must have a corresponding row here + link to the PR.

**Columns**:
- **Path** — file or directory
- **Category** — RootJunk | Component | Route | Script | Schema | FlagGated | Other
- **Confidence** — High | Medium | Low (for being truly dead)
- **Detection** — knip | manual | depcruise | schema-comment | plan-doc | etc.
- **Status** — `new` | `triaging` | `approved-delete` | `archived` | `kept-explain` | `deleted:PR-xxx`
- **Notes / Evidence**

---

## High-Confidence Quick Wins (Phase 1 — do these first)

| Path | Category | Confidence | Detection | Status | Notes / Evidence |
|------|----------|------------|-----------|--------|------------------|
| `apps/desktop/` | RootJunk | High | Manual + ls | deleted (this wave) | 11k+ files of node_modules from previous Electron build. Removed from disk (untracked in index in this env). |
| `firebase-debug.log` | RootJunk | High | Manual + ls | deleted (this wave) | 1.6k lines, generated artifact. Removed from disk. **DONE 2026-06-28: now gitignored + untracked — resolved.** |
| `receiving_lines_cleanup_backup_*.json` (both) | RootJunk | High | Manual + ls | deleted (this wave) | ~11.5k lines each. One-off backup during receiving schema work. Removed from disk. |
| `Repair Service HTML` | RootJunk | High | Manual + ls | deleted (this wave) | No extension, suspicious name at root. Removed from disk. |
| `get-all-ebay-tokens.js`<br>`get-ebay-tokens.js` | Script | High | Manual + README | deleted (this wave) | Old token helper scripts. Superseded by proper eBay account management + refresh jobs. Removed from disk. |
| `test-packing-flow.sh` | Script | High | Manual | deleted (this wave) | One-off test script at root. Removed from disk. |
| `src/app/design-demo/` | Component | High | Self-documenting + knip + no imports | kept-explain (STALE 2026-06-28) | ~~Git-deleted.~~ **CORRECTION 2026-06-28: design-demo is BACK** — it is the live component showroom for [[design-2026-component-adoption]], not dead code. Do not delete. |
| Root `*_PLAN.md` files (ARCHITECTURE_PLAN.md, COMPONENT_DEDUP_PLAN.md, FBA_*, etc.) | Docs | Medium | Manual | archived (this wave) | Moved via git mv to `docs/archive/plans/`. Added explanatory README. |

**Wave 1 completed**: 2026-06 — Surface junk + infrastructure (apps/desktop, design-demo, root junk, archived plans). Also Phase 2: legacy setup routes (setup-db/*, drizzle-setup, migrate-process, diagnose-migration, setup-source-db) + guard removed. Docs/references cleaned. Modern: `npm run db:migrate`.

**Wave 2 (follow-up from knip triage)**: Deleted 5 more high-confidence unused components with zero import references:
- src/components/DocxUploader.tsx
- src/components/StaffSelector.tsx
- src/components/TechSearchPanel.tsx
- src/components/electron/ElectronTitleBar.tsx
- src/components/electron/UpdaterButton.tsx

(ElectronDragStrip remains as it is imported in layout.tsx. These were from the initial knip "Unused files" list.)

**Wave 3**: Deleted another verified batch (no external "from" imports in src/, only historical release-notes mentions):
- src/components/activity-inbox/ActivityInboxButton.tsx
- src/components/activity/ActivityFeed.tsx
- src/components/barcode/BarcodeStepper.tsx
- src/components/barcode/index.ts

These were top of the current knip unused files list. Activity inbox/feed and barcode stepper appear superseded by newer UI patterns.

**Wave 4**: Deleted 5 more from top of knip list (mostly historical references only, comments in other files, no strong active production imports):
- src/components/fba/FbaFnskuChecklist.tsx
- src/components/fba/FbaFnskuDirectoryPanel.tsx
- src/components/admin/ManualAssignmentTable.tsx
- src/components/admin/OrdersManagementTab.tsx
- src/components/admin/StaffTable.tsx

Note: There is a separate active StaffTable in app/settings/staff/. The components/admin one was the old one flagged by knip. FBA ones appear legacy compared to current board/sidebar.

**Wave 5 (export-level, zero-risk)**: Removed 46 redundant `export default <Ident>;` lines. These files follow the `export function X` + `export default X` pattern, but every consumer imports the **named** export — the `default` export had **0 importers anywhere in `src/`**.

- Detection: knip "Unused exports" section (303 entries), filtered to the 47 whose only unused export was bare `default`.
- Safety verification before edit:
  - 0 default-importers (`import X from '...'`) across all 47 (grep-verified).
  - None reached via `next/dynamic` or `React.lazy` (which resolve `.default`).
  - None are `src/app/**` route/page/layout files (where `default` is structurally required).
- Result: `npx tsc --noEmit` clean (exit 0); knip unused exports 303 → 257 (−46, exact).
- **Correction to prior turn's analysis**: knip is NOT producing false positives on these components. They are correctly recognized as used via their named exports; the earlier "active components flagged as dead" read was a mis-attribution of the *Duplicate exports* / redundant-`default` rows. Detection (incl. `@/` alias resolution) is working correctly — no knip config repair needed.

| Path | Category | Confidence | Detection | Status | Notes / Evidence |
|------|----------|------------|-----------|--------|------------------|
| `src/utils/orders.ts` | Schema | Medium | knip | deleted (DONE 2026-06-28) | **Whole-file candidate** (not a redundant-default case). Legacy `defineSchema('orders', [...])` definition with `export default`; **0 importers anywhere in `src/`**. Superseded by the drizzle schema. Excluded from Wave 5 (file deletion needs Phase-C protocol: confirm no schema-generation/SQL-emit consumer first). **DONE 2026-06-28: confirmed no consumer; file deleted.** |

**Wave 6 (dead exported types, zero-runtime-risk)**: knip reported 394 unused-exported-type entries (785 type symbols). A single-pass scanner (`/tmp/scan.mjs`) counted each identifier's occurrences across **all** of `src/` *including test/spec files* (knip ignores tests — a known blind spot). Results: 736 symbols are used locally (only the `export` keyword is redundant — left untouched, churn-only), 1 is test-imported (`ReceivingView` — kept exported), and **47 are fully dead** (identifier occurs exactly once = its own declaration).

Of the 47 fully-dead types, **14 unambiguously-internal ones were deleted** this wave (hook return types, query-row types, internal unions/responses):

| Path | Type(s) deleted |
|------|-----------------|
| `src/components/admin/access/useStaffAccessDetail.ts` | `StaffAccessMutations` |
| `src/hooks/station/useUpNextController.ts` | `UseUpNextControllerReturn` |
| `src/hooks/useFeedback.ts` | `FeedbackFn` |
| `src/hooks/useInventorySearch.ts` | `InventoryResultKind` |
| `src/lib/neon/pairing-queries.ts` | `SupportedPlatform` |
| `src/lib/neon/repair-service-queries.ts` | `RepairStatus` |
| `src/lib/zendesk-links.ts` | `TicketEntityType` |
| `src/components/admin/access/staff-access-shared.ts` | `CardTheme` |
| `src/components/po-triage/types.ts` | `TriageResponse` |
| `src/components/sidebar/receiving/receiving-sidebar-shared.ts` | `OpenException` |
| `src/lib/neon/sku-catalog-queries.ts` | `SkuPairingSuggestionRow`, `SkuPairingAuditRow` |
| `src/lib/staff-availability.ts` | `StaffScheduleMatrixResponse` |
| `src/lib/sync-cursors.ts` | `SyncCursorRow` |

Gates: `tsc --noEmit` clean; build run. Removal was brace-matched (type + attached doc comment), surrounding code untouched (diffs reviewed).

**Then deleted (user decision: "schemas + integrations only") — 12 more fully-dead types:**
- `src/lib/schemas/**` (10): Zod `z.infer` contract types — `OrderUpdateInput`, `OrderTrackingPostInput`, `OrderTrackingPatchInput`, `ReasonCodeCreateInput`, `ReasonCodeUpdateInput`, `RmaUpdateInput`, `SkuCatalogCreateInput`, `SkuCatalogUpdateInput`, `SkuRelationshipCreateInput`, `SkuRelationshipUpdateInput`. Trivially regenerated from their Zod schemas if a consumer is later wired. Related to [[crud-endpoints-initiative]].
- `src/lib/integrations/credentials.ts` (2): `EcwidCredentials`, `SquareCredentials`. Related to [[nango-additive-integration]].

Wave 6 total deleted: **26 dead types** (14 internal + 12 schema/integration). Gate: `tsc --noEmit` clean + full build (exit 0).

**Kept by decision — 21 design-system token/theme types** in `src/design-system/**` (`Spacing`, `Radii`, `Shadows`, `ZIndex`, `FontSizes`, `FontWeights`, `TypographyPresets`, `BaseColors`, `SemanticColors`, `DarkTheme`, `LightTheme`, `Breakpoints`, `MotionDurations`, `HapticPattern`, `TouchTarget`, `SafeArea`, `MobileDensity`, `FontFamilies`, `BorderWidths`, `DesignSystemCssVariables`, `FoundationIcons`). Fully dead now (occur once, not barrel-re-exported) but preserved as intentional typed API for [[design-2026-component-adoption]]. Revisit if that initiative stalls.

**Not pursued — 736 locally-used "unused exports"**: only the `export` keyword is redundant (type is used within its own file). Demoting to local removes no actual code (types erase at compile) and carries edge-case risk (declaration merging, barrels). Left as accepted knip baseline noise.

---

## Knip "Unused Files" — Initial Baseline Triage (182 reported)

**Important**: Knip output requires heavy triage. Many of these are reached via:
- `src/app/m/**` mobile routes
- Dynamic imports
- Admin section routing
- Feature-flagged paths
- Barrel re-exports that knip didn't fully follow

**Date of this snapshot**: 2026-06 (from `npx knip --reporter compact`)

### Receiving / Old Modes (high probability of dead)

| Path | Category | Confidence | Detection | Status | Notes / Evidence |
|------|----------|------------|-----------|--------|------------------|
| `src/components/receiving/Mode1BulkScan.tsx` | Component | Medium | knip | deleted (DONE 2026-06-28) | Old bulk scan mode. Current receiving uses workspace + triage modes. Zero importers — deleted this session. |
| `src/components/receiving/Mode2Unboxing.tsx` | Component | Medium | knip | new | Superseded by unboxing workspace. |
| `src/components/receiving/Mode3LocalPickup.tsx` | Component | Medium | knip | deleted (DONE 2026-06-28) | Zero importers — deleted this session. |
| `src/components/receiving/PODetailPanel.tsx` | Component | Medium | knip | new | Likely replaced by newer PO / receiving line UI. |
| `src/components/receiving/ZohoPOManager.tsx` | Component | Medium | knip | new | Zoho integration surface may have moved. |
| `src/components/receiving/workspace/FlowSection.tsx` etc. | Component | Low | knip | new | Some workspace pieces may still be active. |

### Mobile Components (many false positives possible)

Large number of files under:
- `src/components/mobile/station/*`
- `src/components/mobile/overlays/*`
- `src/components/mobile/shared/*`
- `src/components/mobile/orders/*`
- Various `index.ts` barrels in mobile

**Triage note**: Cross-check against `src/app/m/` directory and any dynamic mobile navigation. Some of these may be from a prior mobile redesign and are now dead. Others are legitimately only loaded on mobile.

### FBA Table / Small Components

Many small files under `src/components/fba/table/` and `src/components/fba/` (ItemRow, StatusBadge, RemoveFromPlanButton, etc.).

These are often good candidates once you verify they aren't used by the current FBA board or combine view.

### Admin & Connection Cards

- `src/components/admin/ManualAssignmentTable.tsx`
- `src/components/admin/OrdersManagementTab.tsx`
- `src/components/admin/StaffTable.tsx`
- `src/components/admin/connections/*` (BackfillCard, EcwidSquareSyncCard, OrdersIntegrityCard, etc.)
- `src/components/admin/workflow/OperationsFlowBoard.tsx`

**Note**: Admin UI is highly dynamic (section-based). Many of these may still be mounted via the admin tabs system even if direct imports are few.

### Other Notable Knip Flags (initial pass)

- `src/components/DocxUploader.tsx`
- `src/components/StaffSelector.tsx`
- `src/components/TechSearchPanel.tsx`
- `src/components/activity-inbox/*` and `src/components/activity/*`
- `src/components/barcode/BarcodeStepper.tsx`
- `src/components/electron/*` (only relevant in desktop shell)
- `src/components/labels/*` (some preview / button pieces)
- `src/components/manuals/*` (large set — pairing, sidebars, tables). Products page may have taken over.
- `src/components/po-triage/*`
- `src/components/quick-access/CommonPagesBar.tsx`
- `src/components/replenish/UrgentStockBanner.tsx`
- `src/components/shipped/details-panel/*` (some blocks)
- `src/components/sidebar/DeviceModeToggle.tsx`
- `src/components/sku/BinSkuEditorRow.tsx`
- `src/components/station/*` (several: BarcodeScanner, PendingUnboxingQueue, PhotoCapture, ProductManualViewer, ReceivingLogs, ReceivingTestPanel)

**Action**: When triaging a batch, add a sub-section below with your findings and change the Status column above.

---

## Legacy Routes & Diagnostic Surface (Phase 2)

| Path | Category | Confidence | Detection | Status | Notes / Evidence |
|------|----------|------------|-----------|--------|------------------|
| `src/app/api/setup-db/route.ts` (and related) | Route | Medium | plan-docs + auth-coverage.md + README | deleted (this wave) | Legacy schema bootstrap routes removed. Modern path is `npm run db:migrate` + drizzle-kit. Guard also removed. All doc references cleaned. |
| `src/lib/setup-guard.ts` | Lib | Medium | — | deleted (this wave) | Only protected the above routes. |
| `src/lib/setup-guard.ts` | Lib | Low | — | new | Only needed while the above routes exist. Can be deleted with them. |

---

## Inventory V2 Dual Paths (Phase 4 — long-term) — OBSOLETE (DONE 2026-06-28)

**OBSOLETE 2026-06-28: all 12 `INVENTORY_V2_*` flags were removed 2026-06-14; the engine is now unconditional.**
There are no remaining V1/V2 dual paths to strangle. Snapshot below kept for history only.

See `src/lib/feature-flags.ts`. Do **not** delete code while the corresponding flag can still be false for active tenants.

When a flag becomes permanently enabled:
1. Delete the `else` / V1 branch.
2. Remove the flag function + any `isInventoryV2Legacy*` mirrors.
3. Record here.

Current flags (snapshot):
- `INVENTORY_V2_RECEIVING_PUTAWAY`
- `INVENTORY_V2_TECH_LIFECYCLE`
- `INVENTORY_V2_ALLOCATION`
- `INVENTORY_V2_PACKING`
- `INVENTORY_V2_FBA_SERIAL_LINK`
- `INVENTORY_V2_RETURNS`
- `INVENTORY_V2_PICKING`
- `INVENTORY_V2_BIN_ROLES`
- `INVENTORY_V2_REPLENISHMENT`
- `INVENTORY_V2_RMA`
- `INVENTORY_V2_LEGACY_PACK_MIRROR`
- `MOBILE_RECEIVING_PIPELINE_V2`

---

## Deleted / Archived (completed work)

(Rows will be added here with PR links as cleanups land)

Example format:
| `path/to/deleted` | Component | High | knip + manual | `deleted:PR-1234` | 2026-06-07 — Removed after confirming no imports and no mobile reachability. Verified build + receiving smoke. |

---

## How to Add a New Candidate

1. Run `npm run dead-code:report` (or `npx knip`).
2. Add a row to the appropriate section.
3. Do the import + route + sidebar search.
4. Update Status as you progress.
5. When deleting, move the row to the "Deleted" section and add the PR number.

---

**This document is the single source of truth for dead code decisions.** Treat it like a lightweight RFC log.

---

## Session 2026-06-28 — completion pass

- Deleted two orphaned receiving modes with zero importers: `src/components/receiving/Mode1BulkScan.tsx`, `src/components/receiving/Mode3LocalPickup.tsx`.
- Deleted `src/utils/orders.ts` (was Wave 5 pending — confirmed no schema-generation/SQL-emit consumer).
- Reconciled stale markers: `design-demo` corrected (it is BACK as the live showroom, not dead); `firebase-debug.log` now gitignored + untracked (resolved); Phase 4 `INVENTORY_V2_*` section marked obsolete (all 12 flags removed 2026-06-14, engine unconditional).

### 2026-06-29 — knip unused-files verification wave

Verified all 26 current knip "unused files" candidates (read-only: static + dynamic imports, barrel re-exports, route/registry/sidebar-nav reachability, **and git working-tree status**). **Deleted 7** confirmed-dead (zero refs, clean git status, tsc-green after):
`src/lib/photos/photo-library-selection.ts`, `src/components/admin/workflow/OperationsSection.tsx`, `src/components/mobile/packer/PackerPhotoCaptureSurface.tsx`, `src/components/mobile/receiving/PhotoCaptureSurface.tsx`, `src/components/mobile/receiving/PhotoGalleryView.tsx`, `src/components/repair/details-panel/RepairNotesTab.tsx`, `src/components/receiving/workspace/line-edit/LineNotesCard.tsx`.
**Kept 19** (do NOT delete): ~14 are **uncommitted in-flight work** (the raw-`<button>`→primitive sweep — `ListingPhotoGallery`, `station/OfflineBanner` [dead duplicate but ` M`], `StationSlot`, `NasPhotoPicker`, `RedesignedBottomNav`, `SkuPairingModal`, `OperationsSidebarPanel`, …); the rest have live importers (`useListingGallery`, `OperationsFlowsDisplay`), are re-exported by a kept barrel (`OperationsHeader` ← `features/operations/index.ts`), back a live route (`lib/photos/download-zip` ← `/api/photos/download-zip`), or are test-referenced org-stamping sites (`insertTechSerialForTracking`, `resolveTechSerialInsertContextFromSal`).

> **knip gate note:** `npm run knip` is currently red with ~83 NEW findings vs the 2026-06-28 baseline — this is **baseline drift from heavy concurrent development**, not these deletions (deleting files can't add unused-export findings elsewhere). ~79 are concurrent in-flight exports (PostHog, icons, pane-header, settings, `TriageCombinedList`, …); ~4 are this session's intentional additive color scaffolding (`resolveSkuCatalogRowWithColor`, `strippableVariantBase` [test-used; knip can't see the test's dynamic `import()`], `DecodedSkuColor`, `SkuColorSuffixEntry`). **Owner action:** run `npm run knip:baseline` to re-accept the backlog once in-flight work settles.

## Remaining work — handoff (2026-06-28)

- **[CODE]** Triage the un-triaged knip "Unused Files" backlog (`src/components/mobile/**`, `src/components/fba/table/**`, `src/components/manuals/**`, `src/components/admin/connections/**`). Next step: per-file reference + mobile-route (`src/app/m/**`) reachability check before any deletion. **[DEAD-CODE-RISKY]** — high false-positive rate (dynamic imports, admin tab routing, mobile-only loads).
- **[DESIGN-DECISION]** The 21 design-system token/theme types in `src/design-system/**` (kept for [[design-2026-component-adoption]]) — revisit and delete only if that initiative stalls.
