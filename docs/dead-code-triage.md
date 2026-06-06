# Dead Code Triage Log

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
| `firebase-debug.log` | RootJunk | High | Manual + ls | deleted (this wave) | 1.6k lines, generated artifact. Removed from disk. |
| `receiving_lines_cleanup_backup_*.json` (both) | RootJunk | High | Manual + ls | deleted (this wave) | ~11.5k lines each. One-off backup during receiving schema work. Removed from disk. |
| `Repair Service HTML` | RootJunk | High | Manual + ls | deleted (this wave) | No extension, suspicious name at root. Removed from disk. |
| `get-all-ebay-tokens.js`<br>`get-ebay-tokens.js` | Script | High | Manual + README | deleted (this wave) | Old token helper scripts. Superseded by proper eBay account management + refresh jobs. Removed from disk. |
| `test-packing-flow.sh` | Script | High | Manual | deleted (this wave) | One-off test script at root. Removed from disk. |
| `src/app/design-demo/` | Component | High | Self-documenting + knip + no imports | deleted (this wave) | The page itself says: "Throwaway route — not imported by the app. Delete src/app/design-demo anytime." No production code imports from it. Git-deleted. |
| Root `*_PLAN.md` files (ARCHITECTURE_PLAN.md, COMPONENT_DEDUP_PLAN.md, FBA_*, etc.) | Docs | Medium | Manual | archived (this wave) | Moved via git mv to `docs/archive/plans/`. Added explanatory README. |

**Wave 1 completed**: 2026-06 — First safe surface cleanup wave executed (root junk, apps/desktop, design-demo, archived plans). Committed as "chore(hygiene): introduce dead code cleanup plan + tooling + first surface wave".

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
| `src/components/receiving/Mode1BulkScan.tsx` | Component | Medium | knip | new | Old bulk scan mode. Current receiving uses workspace + triage modes. |
| `src/components/receiving/Mode2Unboxing.tsx` | Component | Medium | knip | new | Superseded by unboxing workspace. |
| `src/components/receiving/Mode3LocalPickup.tsx` | Component | Medium | knip | new | Check against current local pickup flow. |
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
| `src/app/api/setup-db/route.ts` | Route | Medium | plan-docs + auth-coverage.md + README | new | Heavy schema bootstrap. Triple-gated but still dangerous. Prefer deletion or 410. |
| `src/app/api/drizzle-setup/route.ts` | Route | Medium | same | new | Historical. |
| `src/app/api/migrate-process/route.ts` | Route | Medium | same | new | Historical. |
| `src/app/api/diagnose-migration/route.ts` | Route | Medium | same | new | Diagnostic. |
| `src/app/api/setup-source-db/route.ts` | Route | Medium | same | new | Historical. |
| `src/lib/setup-guard.ts` | Lib | Low | — | new | Only needed while the above routes exist. Can be deleted with them. |

---

## Inventory V2 Dual Paths (Phase 4 — long-term)

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
