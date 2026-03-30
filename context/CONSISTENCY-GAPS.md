# Consistency Gaps & Improvement Opportunities

Cross-reference analysis of the entire codebase. Organized by severity.
Items marked RESOLVED have been fixed.

---

## CRITICAL — Multiple implementations causing potential bugs

### 1. Scan Classification: 3 Separate Systems — RESOLVED
`classifyScan()` in `packer.ts` now delegates to `classifyInput()` from `scan-resolver.ts` and
`looksLikeFnsku()` for FNSKU detection. `detectStationScanType()` already delegated to `classifyInput()`.
All three systems now share the same underlying carrier/tracking detection.

### 2. Tracking Normalization: 3 Duplicate Implementations — RESOLVED
Canonical implementation lives in `src/lib/tracking-format.ts`. Both `shipping/normalize.ts` and
`utils/tracking.ts` now re-export from `tracking-format.ts` instead of having their own copies.

### 3. Carrier Detection: 4+ Implementations — RESOLVED
Single `detectCarrier()` in `src/lib/tracking-format.ts` using the most comprehensive pattern set
(from scan-resolver.ts). Inline `detectCarrier()` functions removed from:
- `src/app/api/fba/shipments/mark-shipped/route.ts`
- `src/app/api/fba/shipments/[id]/tracking/route.ts`
Both now import from `tracking-format.ts`. `shipping/normalize.ts` re-exports a typed wrapper.

---

## HIGH — Inconsistencies causing maintenance burden

### 4. Cache Tag Naming Mismatch — RESOLVED
All `'packerlogs'` cache tags and `'api:packerlogs'` Redis key prefixes replaced with `'packing-logs'`
and `'api:packing-logs'` across all files:
- `src/app/api/packerlogs/route.ts`
- `src/app/api/packing-logs/route.ts`
- `src/app/api/packing-logs/update/route.ts`
- `src/app/api/orders/assign/route.ts`
- `src/app/api/orders/check-shipped/route.ts`

### 5. FBA Log Creation: Raw Inserts Kept Intentionally
Raw `INSERT INTO fba_fnsku_logs` is the correct pattern. Each FNSKU scan creates a new log row
to track duplicate scans — two scans of the same product on the same day is meaningful data
(e.g., two units shipped). The `createFbaLog()` helper can be used for new code, but existing
raw inserts are correct and intentional.

### 6. Manual Transaction Handling in 84 Files
Raw `BEGIN`/`COMMIT`/`ROLLBACK` scattered across 84 files instead of using a centralized helper.

**Status:** Not yet addressed. Recommend wrapping new code in a `withTransaction()` helper
and migrating hot paths incrementally.

### 7. Staff Data: 6+ Files Fetch `/api/staff` Directly — RESOLVED
All 6 files now use `getActiveStaff()` from `@/lib/staffCache`:
- `FeaturesManagementTab.tsx` — uses `useQuery` + `getActiveStaff()`
- `OrdersManagementTab.tsx` — uses `useQuery` + `getActiveStaff()`
- `Mode2Unboxing.tsx` — uses `getActiveStaff()` in `useStaff()` hook
- `Mode3LocalPickup.tsx` — uses `getActiveStaff()` in `useEffect`
- `RepairIntakeForm.tsx` — uses `getActiveStaff()` with client-side role filter
- `useReceivingDetailForm.ts` — uses `getActiveStaff()` with client-side role filter

---

## MEDIUM — Cleanup opportunities

### 8. Remaining Hardcoded Staff Values — RESOLVED
- `DashboardDetailsStack.tsx` — `[4, 5]` replaced with `PACKER_IDS` from `@/utils/staff`
- `useStaffNameMap.ts` — `STAFF_NAME_OVERRIDES = { 7: 'Kai' }` replaced with `STAFF_NAMES`

### 9. Ably Channel Constants Duplicated — RESOLVED
All 8 files with hardcoded channel names now import from `src/lib/realtime/channels.ts`:
- `useShippedTableData.ts` — `getOrdersChannelName()`, `getStationChannelName()`
- `useRealtimeInvalidation.ts` — `getOrdersChannelName()`, `getRepairsChannelName()`
- `useTechLogs.ts` — `getStationChannelName()`
- `usePackerLogs.ts` — `getStationChannelName()`
- `useRepairs.ts` — `getRepairsChannelName()`
- `ReceivingLogs.tsx` — `getStationChannelName()`
- `PendingOrdersTable.tsx` — `getOrdersChannelName()`
- `UnshippedTable.tsx` — `getOrdersChannelName()`

### 10. Three DB Client Patterns
| Pattern | File | Usage |
|---------|------|-------|
| Raw `pool.query()` | `src/lib/db.ts` | Most API routes |
| `neonClient` + `transaction()` | `src/lib/neon-client.ts` | Rarely used |
| Drizzle ORM | `src/lib/drizzle/` | Schema definitions, some queries |

**Status:** Not yet addressed. Low risk but adds cognitive overhead.

### 11. Tracking Lookup Precedence — PARTIALLY RESOLVED
Standardized packing-logs route to match tech/scan priority order: `exact → key18 → last8`.
Previously packing-logs used `exact → last8 → key18` which could produce different results.

A fully shared `resolveOrderByTracking()` function is deferred — each lookup site has unique
query shapes and JOIN requirements that make a one-size-fits-all function impractical.

---

## LOW — Nice-to-have improvements

### 12. No Centralized Orders Repository
61 files contain scattered raw SQL against the `orders` table.

**Status:** Not yet addressed. Recommend incremental migration.

### 13. Inconsistent Error Response Shapes
Some routes return `{ error }`, others `{ success, message }`, others `{ error: { code, message } }`.

**Status:** Not yet addressed.

### 14. Mixed Date Handling
Mix of `new Date()`, `dayjs`, and SQL `NOW()`. Timezone handling varies.

**Status:** Not yet addressed.

---

## Summary

| # | Issue | Status |
|---|-------|--------|
| 1 | Scan classification consolidation | RESOLVED |
| 2 | Tracking normalization consolidation | RESOLVED |
| 3 | Carrier detection consolidation | RESOLVED |
| 4 | Cache tag naming (`packerlogs` → `packing-logs`) | RESOLVED |
| 5 | FBA log creation (raw inserts) | KEPT INTENTIONALLY |
| 6 | Manual transaction handling | NOT YET ADDRESSED |
| 7 | Staff data direct fetches → cache | RESOLVED |
| 8 | Hardcoded staff values | RESOLVED |
| 9 | Ably channel constants | RESOLVED |
| 10 | Three DB client patterns | NOT YET ADDRESSED |
| 11 | Tracking lookup precedence | PARTIALLY RESOLVED |
| 12 | No centralized orders repo | NOT YET ADDRESSED |
| 13 | Inconsistent error shapes | NOT YET ADDRESSED |
| 14 | Mixed date handling | NOT YET ADDRESSED |
