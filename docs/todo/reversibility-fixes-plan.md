# Reversibility fixes — implementation plan

> **Status:** ~78% (updated 2026-07-10). Phases 1–4 shipped (label scan-back, warranty
> reversibility, soft-delete restores, state-machine back-edges + tests). **Phase 5 safe subset
> shipped 2026-07-10:** 5.4 (Ecwid mirror deactivate pass w/ complete-fetch guard, 9/9 tests),
> 5.7 (`POST /api/replenishment/tasks/[id]/release` — IN_PROGRESS→REQUESTED, 409 on wrong state,
> audited), 5.9 (QC re-pass auto-resolves the matching open failure tag; advisories: resolve note
> overwrites the original, and it can close a human-opened tag of the same mode). **Remaining
> Phase 5 (owner-decision-gated external side-effects):** 5.1 Zoho void/cancel, 5.3 Square catalog
> delete/archive, 5.6 Zoho purchase-receive delete, 5.8 manual-server file move-back; 5.2 eBay
> revoke + 5.5 Nango revoke are code-shaped but credential/design-gated. Also shipped adjacent:
> F11 returns/undo now rides `transition()` with a `RETURNED→SHIPPED` back-edge.

Closes the forward/reverse asymmetries found by the deep sweep (2026-06-13), **after** adversarial verification removed 5 false positives. 34 confirmed gaps, grouped into 5 phases by cohesion + risk. Builds on the three shipped reversibility fixes (R-label round-trip, Zendesk link/unlink, Ecwid per-line link/unlink).

## Principles (carry over from the shipped work)
1. **Reverse mirrors the forward path** — same lookup/scan resolution, not a parallel impl.
2. **A dedicated reverse endpoint owns any "downgrade"** an invariant otherwise forbids (cf. `recomputeCartonSourceLink` owning the carton zoho_po→unmatched downgrade).
3. **Revert is explicit about state** — every reverse states what status/links it restores; never orphan a record or leave a stuck state.
4. **Audit + idempotency on every new mutation** (`recordAudit`, idempotency key) — matches house route conventions.
5. **State-machine reverses go through `transition()`** where a legal back-edge already exists (`src/lib/inventory/state-machine.ts:70-75` already declares them; they're just unwired).

## Already-reversible (verifier-refuted — no work)
- Un-favorite a SKU → `favorites/[id]/route.ts:65` DELETE.
- Un-split an FBA shipment → `fba/shipments/[id]/route.ts:203`.
- `receiving_lines.workflow_status` test-event reverse → `recordTestVerdict.ts:221`.
- `L-{id}` label scan-back → handled by `src/proxy.ts:92` rewrite (not a 404).
- Ecwid unpair → `pairing-queries.ts:469`.

---

## Phase 1 — Label scan-back ("if I can generate it I can scan it back")
Squarely the original objective. Low-risk, no DB migrations; pure routing/encoding fixes in `barcode-routing.ts` / `printProductLabel.ts`. **Add a single test file** `src/lib/barcode-routing.test.ts` asserting every generated handle round-trips through `routeScan`.

### 1.1 [HIGH] `REP-{id}` repair label 404s on scan-back
- **Gap**: `routeScan` maps `REP-{id}` → `/repair/{id}` (`barcode-routing.ts:181-184`) but there is no `/repair/[id]` route — only `/repair/page.tsx` which forwards query params. Real deep-link is `/walk-in?openRepair={id}` (desktop) / `/m/rs/{id}` (mobile).
- **Fix**: change the `REP-` branch redirect to the working contract. Mirror the receiving handles which target `/m/*`: emit `redirect: /m/rs/{id}` (mobile scan surface) and have desktop `routeScan` consumers fall back to `/walk-in?openRepair={id}`. Confirm `/m/rs/[id]` exists (the walk-in deep-link references it); if scan happens on desktop, map to `/walk-in?openRepair={id}`.
- **Files**: `src/lib/barcode-routing.ts:181-184`; verify `src/app/m/rs/[id]/page.tsx` exists; `src/app/repair/page.tsx` (optionally accept `?openRepair=` passthrough).
- **Revert semantics**: n/a (read-only navigation).
- **Risk**: low. **Test**: `routeScan('REP-42').redirect` resolves to a real route.

### 1.2 [HIGH] `U-{alphanumeric serial}` product label mis-routes to `/inventory`
- **Gap**: `buildUnitPayload` (`printProductLabel.ts:63-64`) encodes `serialUnitHandle(serialNumber)` = `U-{serial}`, but `routeScan`'s `U-` branch is `/^U-(\d+)$/` digits-only (`barcode-routing.ts:173`) and `resolveUnitRefs` treats `U-{n}` as a numeric `serial_units.id` (`handling-unit-queries.ts:262`). An alphanumeric manufacturer serial (`U-CN1A2B3`) matches neither → falls to the leading-letter **bin** fallback → `/inventory`.
- **Fix (preferred)**: don't put a raw physical serial behind the `U-` prefix. `serialUnitHandle` is for the numeric `serial_units.id`. In `buildUnitPayload`, when only a physical serial is available, encode the **GS1 unit form** (`gs1UnitAi`/`/01/{gtin}/21/{serial}`) which `routeScan` already resolves to a unit, or encode the bare serial (no prefix) and let the serial-search path resolve it. If we must keep `U-`, broaden `routeScan` `U-` to `^U-(.+)$` AND make `resolveUnitRefs` resolve the suffix as `serial_units.id` OR `normalized_serial`.
- **Files**: `src/lib/print/printProductLabel.ts:63-66`; `src/lib/barcode-routing.ts:173`; `src/lib/neon/handling-unit-queries.ts:262-263` (resolveUnitRefs).
- **Risk**: medium (touches a shared print + scan path). Verify the Tech "Pass+Print" (`TechDashboard.tsx:146`) and receiving print (`ReceivingDashboard.tsx:168`) still print + scan back.
- **Test**: `U-CN1A2B3` resolves to a unit, not a bin.

### 1.3 [MEDIUM] SKU-only label with a letter-prefixed SKU mis-routes to bin — **DEFERRED**
- **Gap**: `buildUnitPayload` SKU-only fallback encodes the raw SKU; `routeScan` sends a letter-prefixed SKU (`HP-PSU`) to the **bin** branch → `/inventory?bin=HP-PSU`.
- **Why deferred**: adversarial verification (2026-06-13) showed the app has **no SKU-scan destination** — `type:'sku'` from a scan navigates nowhere (no `?sku=` page; `useGlobalWedgeScanner` only navigates on a `redirect`; nothing acts on a sku wedge-scan event; `/api/scan/resolve` has no sku branch). An `S-` handle would classify correctly but can't complete a round-trip, and adds a latent `scan/resolve` prefixed-lookup wart. The real fix is a **SKU/product-detail scan landing page** (a feature), then point the SKU label at it. The `S-` handle was tried + reverted to avoid shipping a no-op handle. Re-open once a SKU destination exists.

### 1.4 [LOW] `mobileQrUrl` advertises un-routable `'k'` / `'l'` kinds
- **Gap**: `mobileQrUrl` signature allows `'k'`→`/m/k/{id}` and `'l'`→`/m/l/{id}` (`barcode-routing.ts:277-291`), but `routeScan` has no `'k'` branch and `/m/k` has no page. **No callers today.**
- **Fix**: remove `'k'` (and `'l'` if unused after 1.1) from the `mobileQrUrl` kind union — a generator that can't be scanned back shouldn't exist. (Dead-code hygiene; cf. removing dead `saveZendeskTicket`.)
- **Risk**: none. **Test**: types compile; no callers.

---

## Phase 2 — Warranty claim full reversibility
Cohesive subsystem (`linkage.ts` / `mutations.ts` / `transitions.ts`). Mirrors the **already-shipped** warranty Zendesk link/unlink, so the pattern (DELETE route + `unlink*` helper + audit + event) is established. No migration. Add reverse verbs + a restore. **Decision needed: what each reverse restores status to.**

### 2.1 [HIGH] Unlink an RMA from a claim
- **Gap**: `POST .../rma` sets `warranty_claims.rma_id` (`linkage.ts:143,188`); no DELETE; all link paths 409 if `rma_id` set, so a wrong RMA is permanent. The `ON DELETE SET NULL` FK cascade is **dormant** because RMAs are soft-cancelled, never hard-deleted.
- **Fix**: add `DELETE /api/warranty/claims/[id]/rma` → new `unlinkRma(claimId)` in `linkage.ts`: `UPDATE warranty_claims SET rma_id = NULL`, append a claim event (`RMA_UNLINKED`), `recordAudit`. Mirror `unlinkClaimTicket`.
- **Revert**: clears `rma_id` only (the RMA authorization row is untouched — it stays cancellable independently). Does **not** change claim status.
- **Files**: `warranty/claims/[id]/rma/route.ts` (+DELETE); `lib/warranty/linkage.ts`; claim-events vocabulary.

### 2.2 [HIGH] Detach a repair handoff
- **Gap**: `handoffToRepair` (`linkage.ts:225`) sets `repair_service_id` + advances `APPROVED→IN_REPAIR`; no detach; only exit from `IN_REPAIR` is logging a FIXED outcome.
- **Fix**: add `DELETE .../repair-handoff` → `detachRepairHandoff(claimId)`: clear `repair_service_id`, revert status `IN_REPAIR→APPROVED` **via `transition()`** (add the legal back-edge to `WARRANTY_LIFECYCLE`), event + audit. **Decide**: should detach also cancel the spawned `repair_service` row, or leave it? (Recommend: leave it; offer it as an option — cf. "ticket stays in Zendesk".)
- **Files**: `warranty/claims/[id]/repair-handoff/route.ts`; `linkage.ts`; `transitions.ts` (back-edge).

### 2.3 [HIGH] Restore a soft-deleted claim
- **Gap**: `softDeleteClaims` sets `deleted_at` (`mutations.ts:344`); single + bulk DELETE routes; **no restore** — a mis-click bulk-delete permanently hides the claim + trail.
- **Fix**: `restoreClaims(ids)` in `mutations.ts` (`deleted_at = NULL`), `POST /api/warranty/claims/[id]/restore` + bulk variant, event + audit. Surface an "Undo"/Trash view in the warranty UI (deleted-but-recoverable list).
- **Files**: `mutations.ts`; new restore routes; warranty UI (a trash/undo affordance).

### 2.4 [MEDIUM] Reverse warranty status verbs
- **Gap**: `WARRANTY_LIFECYCLE` (`transitions.ts:18`) is strictly forward; no reopen/unsubmit/unapprove/un-deny; `DENIED`/`CLOSED` terminal.
- **Fix**: add guarded back-edges to the lifecycle graph + verb routes: `reopen` (`CLOSED/DENIED → SUBMITTED`), `unsubmit` (`SUBMITTED → LOGGED`), `unapprove` (`APPROVED → SUBMITTED`, blocked if already handed to repair). Reuse the existing verb-route pattern under `claims/[id]/`.
- **Decision needed**: which transitions to expose (full matrix vs. just `reopen`) and whether reopen is permission-gated higher (`warranty.manage`).

---

## Phase 3 — Soft-delete / lifecycle restore
Each is a small, isolated reverse: a `un*`/`reopen` query + a route action. Low-medium risk; mostly no migration (columns exist). Pattern is uniform → batch them.

| # | Sev | Fix | Forward | Reverse to add |
|---|---|---|---|---|
| 3.1 | HIGH | `repair_service` uncancel/reopen | `cancelRepair` → `status='Cancelled'` (`repair-service-queries.ts:243`) | `reopenRepair` restoring prior status; **needs prior-status capture** (today cancel doesn't stash it) → store `status_before_cancel` (small migration) OR default reopen to a safe status (e.g. `Received`). Route on `repair-service/[id]` (PATCH `action='reopen'`). |
| 3.2 | HIGH | `handling_units` dissolve/void H-box | `createHandlingUnit` (`handling-unit-queries.ts:236`); `[id]` route is GET-only | `DELETE /api/handling-units/[id]` → `dissolveHandlingUnit`: only when empty (no member units) OR cascade-unassign members first (`handling_unit_id = NULL`), then delete the row. Owns the "unassign all then delete" so no orphan units. |
| 3.3 | MED | `staff_todos` unarchive | `archiveStaffTodo` → `archived_at=now` (`staff-todos-queries.ts:259`) | `unarchiveStaffTodo` (`archived_at=NULL`) + PATCH `action='unarchive'` on `staff-todos/route.ts:105`. |
| 3.4 | MED | `local_pickup_orders` unvoid | `void` → `status='VOIDED'` (terminal) | `reopen` (`VOIDED → DRAFT`, clear `voided_at/voided_by`) route; keep the DRAFT-only hard-delete as-is. |
| 3.5 | MED | `workflow_definitions` discard draft | draft INSERT (`studio/definitions/draft/route.ts:60`) | `DELETE /api/studio/definitions/[id]` for never-published drafts (`is_active=false` AND not superseding) → delete row + cascade nodes/edges. Guards against deleting a published/active version. |
| 3.6 | LOW | cycle-count campaign reopen | `close` → `status='closed'` (`cycle-counts/campaigns/[id]/route.ts:83`) | accept `action='reopen'` (`closed → open`, clear `closed_at`), permission-gated. |
| 3.7 | LOW | `local_pickup_items` un-flag | upsert on `receiving_id` (`local-pickups/route.ts:211`) | `DELETE /api/local-pickups?receiving_id=` to clear the pickup flag without deleting the parent receiving. |

---

## Phase 4 — Inventory state-machine walk-back
**Highest correctness sensitivity** (touches `serial_units.current_status` + allocations). The unifying insight: `src/lib/inventory/state-machine.ts:70-76` **already declares** the legal back-edges (`re-pick`, `re-stage`, `unload`, `abandon`, `restock` RETURNED→STOCKED, PICKED→ALLOCATED) — they're just never invoked, because live forward paths do **raw UPDATEs** bypassing `transition()`. So the work is: **add reverse endpoints that go through `transition()`**, and (separately) migrate the raw-UPDATE forward paths onto `transition()` so the graph is the single gate.

### 4.1 [HIGH] Returns intake undo + missing SHIPPED guard
- **Gap**: `processReturnsIntake` flips `current_status='RETURNED'` **unconditionally** (`returns.ts:161`) — a mis-scanned STOCKED/never-shipped unit is permanently RETURNED; the open SHIPPED allocation is irreversibly closed.
- **Fix (two parts)**: (a) **Guard** the forward: only accept a unit into the returns lane if it's in a returnable state (`SHIPPED`/`ALLOCATED`), else reject with a clear error. (b) **Undo**: `DELETE /api/returns/intake` (or `?unit=`) walking `RETURNED → prior` via `transition()` and reopening the allocation — paralleling the R-label round-trip (scan the same unit back out).
- **Risk**: high — allocation reopen must restore the exact prior linkage. Gate behind the existing inventory flag.

### 4.2 [HIGH] RMA disposition never restocks
- **Gap**: ACCEPT/REWORK inserts a NOTE only (`rma/[id]/disposition/route.ts:60`); the declared `RETURNED→STOCKED` restock edge (`state-machine.ts:76`) is never performed → accepted returns stuck in RETURNED forever.
- **Fix**: on an ACCEPT disposition, perform `transition(unit, RETURNED→STOCKED)` (+ location), emit `RESTOCKED` inventory event. Add a dedicated restock action if disposition shouldn't auto-restock.

### 4.3 [HIGH] `tech/test-result` has no reset
- **Gap**: raw UPDATE advances `IN_TEST/GRADED/IN_REPAIR` forward-only (`tech/test-result/route.ts:109`); a mis-tap can't be corrected.
- **Fix**: add `action='reset'` → `transition()` back to `IN_TEST`/`RECEIVED`; migrate the forward writes onto `transition()` so back-edges are reachable.

### 4.4 [MEDIUM] Per-unit un-pick
- **Gap**: pick/scan advances `ALLOCATED→PICKED` per unit (`pick/scan/route.ts:148`); only reverse is releasing the **whole order**. The `PICKED→ALLOCATED` "re-pick" edge is declared but unused.
- **Fix**: `POST /api/pick/unscan` (or `?unit=`) → `transition(PICKED→ALLOCATED)` for one unit, restoring the allocation.

### 4.5 [MEDIUM] Un-putaway
- **Gap**: putaway sets `STOCKED` + location (`putaway/route.ts:135`); no walk-back; `move` only re-points location, never status.
- **Fix**: `DELETE/POST` un-putaway → status back to pre-stock (`TESTED`/`RECEIVED`), clear `current_location`. May need a declared `STOCKED→TESTED` edge added to the graph.

### 4.6 [LOW] Route fulfillment raw-UPDATEs through `transition()`
- **Gap**: `pack/ship:255`, `fba .../ship-units:150`, `pick/scan` all raw-UPDATE and bypass `transition()`, so the guarded reverse graph is dead.
- **Fix (refactor)**: migrate these forward writes onto `transition()`. Larger; do **after** 4.1–4.5 prove the pattern. Makes every future reverse "free".

---

## Phase 5 — Integration un-sync / disconnect (external side-effects)
**Highest risk** — these call external APIs and touch money/listings/credentials. Each needs its own careful design + likely a confirm. Do last.

### 5.1 [HIGH] Zoho void/cancel sales order (+ invoice/payment)
- **Gap**: `ZohoInventoryClient` has `createSalesOrder/confirmSalesOrder/createInvoice/...` but no `voidSalesOrder/cancelSalesOrder/voidInvoice/deletePayment` (`:25-185`). A cancelled/refunded channel order leaves Zoho confirmed, **double-committing stock**.
- **Fix**: add `voidSalesOrder`/`markSalesOrderVoid` (+ invoice void) client methods; wire `OrderSyncService` to void Zoho when a channel order cancels/refunds. **Design decision**: void vs. cancel vs. delete per Zoho's allowed transitions; idempotency; partial-fulfillment handling.

### 5.2 [HIGH] eBay disconnect revoke + token wipe
- **Gap**: connect upserts encrypted tokens (`ebay/callback/route.ts:116`); only reverse is `PUT is_active=false` (`ebay/accounts/route.ts:47`) — **no row delete, no eBay revoke**, refresh token at rest forever.
- **Fix**: `DELETE /api/ebay/accounts/[id]` → call eBay OAuth **revoke** endpoint + delete (or null-credential) the `ebay_accounts` row. Add `ebay_accounts` to the integration-delete provider list.

### 5.3 [HIGH] Ecwid→Square catalog delete/archive
- **Gap**: sync only creates/updates Square objects for enabled products (`ecwid-square/sync.ts:258`); disabled/deleted Ecwid products leave **orphan sellable Square listings**.
- **Fix**: reconcile pass — for products no longer enabled, call Square `/catalog/object` delete or archive (set `present_at_all_locations=false`). Track the Square object id mapping to target the delete.

### 5.4 [MEDIUM] Ecwid product mirror deactivate pass
- **Gap**: `sync-ecwid-products` only inserts/reactivates `is_active=true` (`:84-96`); never deactivates rows whose Ecwid product disappeared. The soft-deactivate (`sku-catalog-queries.ts:1161`) exists but is never called by the sync.
- **Fix**: after upserting the fetched set, deactivate `is_active=false` for ecwid `sku_platform_ids` **not** in the latest fetch (reconcile-missing). Reuse `deleteSkuPlatformId`.

### 5.5 [MEDIUM] Nango revoke on disconnect
- **Gap**: `recordNangoConnection` stores the marker (`nango/connected/route.ts:54`); reverse only deletes the **local** marker; `forgetNangoConnection` (`nango.ts:117`) is **dead** and explicitly doesn't revoke in Nango.
- **Fix**: wire `forgetNangoConnection` into the integration-delete path AND call Nango's connection-delete API so the external grant is revoked, not abandoned.

### 5.6 [MEDIUM] Zoho granular purchase-receive delete
- **Gap**: `createPurchaseReceive` writes a discrete Zoho `purchasereceives` record (`zoho.ts:873`); no `deletePurchaseReceive`, no DELETE on `receiving/[id]` → over-received qty can't be undone in Zoho. (The coarse `mark-received-po` path **is** symmetric.)
- **Fix**: add `deletePurchaseReceive(id)` client method + an un-receive path that deletes the Zoho record and clears `zoho_purchase_receive_id`.

### 5.7 [MEDIUM] Replenishment un-claim
- **Gap**: `claimTask` → `IN_PROGRESS` + `assigned_staff_id` (`replenishment/tasks/[id]/claim`); only non-forward is destructive `cancel`. No clean hand-back.
- **Fix**: `POST .../release` → `IN_PROGRESS → REQUESTED`, clear `assigned_staff_id`.

### 5.8 [MEDIUM] Manual-server unassign (physical file move-back)
- **Gap**: `assign` physically moves the file into the item folder AND upserts a DB row (`manual-server/assign/route.ts:19`); reverse (`product-manuals DELETE`) only soft-deactivates the DB row — **the file stays in the item folder** (no `unassignManualServerManual` writer).
- **Fix**: add `unassignManualServerManual` (server `/manuals/unassign` move-back) + call it from the product-manual DELETE so DB + filesystem revert together.

### 5.9 [MEDIUM] Auto-resolve failure tag on QC re-pass
- **Gap**: a failed QC step opens `unit_failure_tags` (`checklist/route.ts:184`); the **same** endpoint never resolves it on a later pass (guarded `if (passed===false)` only). The only auto-resolve keys off repair completion — a different trigger.
- **Fix**: add a `passed===true →` branch that resolves the matching open tag for that step (mirror the forward trigger), so a false-fail corrected by re-test clears.

---

## Migrations needed
- **3.1** `repair_service.status_before_cancel TEXT` (to restore prior status on reopen) — *or* skip and reopen to a fixed safe status.
- Phase 4 may add declared edges to `state-machine.ts` (code, not DB) and possibly `STOCKED→TESTED`.
- Everything else reuses existing columns (`deleted_at`, `archived_at`, `voided_at`, `rma_id`, `repair_service_id`, `is_active`, status enums).

## Testing strategy
- **Phase 1**: pure-function tests in `barcode-routing.test.ts` — every `*Handle()` round-trips through `routeScan`; assert no generator emits an un-routable payload (a guard test that fails if a new handle prefix lacks a `routeScan` branch).
- **Phases 2–5**: per-reverse, assert (a) forward then reverse returns the entity to its prior state, (b) reverse is idempotent, (c) reverse refuses when preconditions aren't met (e.g. dissolve a non-empty H-box). Where a DB is required, follow the existing `node:test` + stubbed-deps pattern (cf. `resolver.test.ts`).
- **Route-auth**: re-emit `docs/security/route-permissions.json` after each new route (`npm run audit-route-auth -- --emit`).

## Suggested sequencing
1. **Phase 1** (label scan-back) — fastest, on-theme, low-risk, one test file. ~½ day.
2. **Phase 3** (soft-delete restores) — uniform small reverses, high user value (undo mis-clicks). ~1 day.
3. **Phase 2** (warranty reversibility) — cohesive, pattern already shipped. ~1 day + UI.
4. **Phase 4** (inventory walk-back) — correctness-sensitive; do behind flags, verify allocation reopen carefully. ~2 days.
5. **Phase 5** (integration un-sync) — external side-effects; one integration at a time, each with its own review/confirm. ~3+ days.

## Open decisions (need owner input before building the affected phase)
- **2.2** repair-handoff detach: cancel the spawned `repair_service` row, or leave it?
- **2.4** warranty status reverses: full back-matrix or just `reopen`? Higher permission?
- **3.1** repair reopen: capture prior status (migration) or reopen to a fixed status?
- **4.1** returns guard: hard-reject a non-returnable unit, or accept-with-warning?
- **5.1** Zoho SO: void vs. cancel vs. delete, and partial-fulfillment behavior.
