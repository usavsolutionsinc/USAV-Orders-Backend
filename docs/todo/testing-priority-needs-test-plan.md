# Testing Priority + Per-Line Needs-Test + Tech-Station Inbox — Plan

## Goal

1. **Shared priority** between unbox and test — if an order is urgent to unbox, it's urgent to test (same signal, no duplication).
2. A **manual priority toggle** in the testing line panel (override / mark-urgent).
3. A **per-PO-line needs-test yes/no toggle** (cables = no test, devices = yes), reusing the existing column.
4. A **tech-primary-station inbox bell** for unboxed returns awaiting test + unboxed orders ready to ship.

## Two orthogonal axes (the core model)

| Axis | Question it answers | Mechanism | Scope |
|---|---|---|---|
| **Priority** | "How soon?" (sort order) | One rank scale: **auto** (platform tiers + unfound, rank 1–5) + **rank-0 override** (`is_priority`) | Carton (`receiving`) |
| **Needs-test** | "At all?" (queue membership) | Existing `receiving_lines.needs_test` boolean | Per PO line |

They never cross: priority orders the queue; needs-test decides who's in the testing queue. A rank-0 carton of cables tops the unbox rail but its `needs_test=false` cable lines never reach the tester.

### Priority has two inputs, one column

`receiving.is_priority` (new boolean) is set by **either**:
- **Auto / pending-order match** — `lookup-po` already computes `findPendingOrderSkuMatches`; persist that result (`UPDATE receiving SET is_priority = true`) in addition to the existing `priority_unbox` Ably push.
- **Manual** — the toggle in the testing/unbox panel PATCHes the same column.

Platform/unfound urgency stays exactly as-is (ranks 1–5, derived from `source_platform`); `is_priority` just adds **rank 0** on top.

---

## Phase 1 — Tier-0 integration (lowest risk, visible everywhere first)

Reuses the single existing rank scale — no parallel badge system.

1. **`src/lib/receiving/scan-priority.ts`**
   - Add `'priority'` to `PriorityTierKey`, `'red'` to `PriorityTone`.
   - Prepend `{ key: 'priority', label: 'Priority', rank: 0, tone: 'red' }` to `PRIORITY_TIERS`.
   - Add `is_priority?: boolean | null` to `PriorityRowLike`.
   - In `priorityTierOf`, short-circuit: `if (row.is_priority) return 'priority';` before platform logic.
2. **`RECEIVING_PRIORITY_RANK_SQL`** (`src/app/api/receiving-lines/route.ts`) — prepend `WHEN r.is_priority THEN 0` to the CASE.
3. Keep the platform CASE as a **secondary** ORDER BY term so priority rows sub-sort by platform: `ORDER BY <rank-with-priority>, <platform-rank>, <recency>`.

Result: `TriagePriorityPanel` health tiles, aging/position chips, and the rail sort all pick up a red "Priority" tile automatically (they iterate `PRIORITY_TIERS` / `summarizePriorityQueue`). Platform + unfound urgency preserved beneath.

## Phase 2 — Persist the shared flag

4. **Migration + Drizzle**: `receiving.is_priority boolean NOT NULL DEFAULT false` (`schema.ts:891`).
5. **Auto-set**: in `lookup-po/route.ts` (~1112, where `pendingOrderSkus.length > 0` fires `publishPriorityUnbox`), add `UPDATE receiving SET is_priority = true`. Ably push stays as the live nudge; the column makes it durable for the test side.
6. **Manual PATCH**: `receiving-logs` PATCH (carton-level, ~331) already handles `needs_test`; add `is_priority` the same way.

## Phase 3 — Panel controls (testing workspace)

7. **Priority toggle** in `TechTestingWorkspace.tsx` (~1229, near notes) → PATCH `receiving-logs {is_priority}`. Red priority chip via receiving display-chip primitives (no inline tone map).
8. **Per-line needs-test toggle** on each PO line → existing `patchLine({ needs_test })` (PATCH `/api/receiving-lines` already supports it).
   - ⚠️ Guard: clearing `true→false` requires `assigned_tech_id` — set it to the current tech when toggling off. PARTS condition still auto-clears.

## Phase 4 — Queues honor both axes

9. **Sort** (priority): both the unbox/incoming view and the testing queue (`work-orders route ~316`) order by the same rank-0 CASE so unbox and test agree.
10. **Filter** (needs-test): testing workspace line enumeration drops `needs_test=false` lines (they skip test → ACCEPT/stock), so priority cable cartons don't park cables in the tester's queue. `work-orders` currently gates on carton-level `r.needs_test` only — extend to honor per-line `rl.needs_test`.

## Phase 5 — Tech-station inbox bell

11. `getPrimaryTechStaffIds()` in `staff-stations-queries.ts` (`station='TECH' AND is_primary=true`).
12. `GET /api/inbox/tech-queue` → **unboxed priority returns awaiting test** (`is_return && unboxed_at && rl.needs_test && not-yet-tested`) + **unboxed orders ready to ship** (line `DONE` + pending-order match). Returns `{ items, counts }`.
13. Publishers `publishReturnPendingTest` / `publishOrderReadyShip` mirror `publishWarrantyClaimNotification`'s `staffIds[]` fan-out; fired from `mark-received` (unbox done) and `lookup-po` (order match).
14. `ActivityInboxContext`: add kinds `return_pending_test` / `order_ready_ship`; seed from the GET on mount; **refetch on Ably push** (survives reload; no polling → flat Neon cost). Two new render cases in `ActivityInboxPopover`.

## Gates

- `tsc` + `build`.
- New `GET /api/inbox/tech-queue` into the auth/permission manifest.
- Confirm no polling interval added (event-driven refetch only).

## Reuse (not rebuilt)

`scan-priority.ts` tier scale + `summarizePriorityQueue` + `TriagePriorityPanel`; `receiving_lines.needs_test` + its PATCH guard + PARTS auto-clear; `patchLine`; `publishEvent` / `getInboxChannelName` / `staffIds[]` fan-out; receiving display chips; `ActivityInboxContext`.

## Open decision

Priority lives on the **carton** (`receiving`) — urgency enters via a tracking scan covering the whole box. If single-line urgency is later needed (one device in a mixed PO), promote to a per-line `receiving_lines.is_priority` and have the carton flag be the OR of its lines.
