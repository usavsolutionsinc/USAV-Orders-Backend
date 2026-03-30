# Deep Scan Findings

Second-pass analysis covering utility duplication, API route patterns, React patterns, and DB access.

---

## CRITICAL — Duplicate functions with conflicting logic

### 1. Three `normalizeSku()` implementations with different behavior

| File | Logic | Effect |
|------|-------|--------|
| `src/utils/sku.ts` | Removes leading zeros | `"007" → "7"` |
| `src/lib/favorites/sku-favorites.ts` | Lowercase + strip special chars | `"SKU-007" → "sku007"` |
| `src/app/api/repair/square-payment-link/route.ts` | Uppercase + trim | `"sku-007" → "SKU-007"` |

**Risk:** Same SKU normalizes to three different values depending on context. Favorites won't match inventory, payment links won't match favorites.

### 2. Two `useRepairs()` hooks with same name, different signatures

| File | Signature | Fetches |
|------|-----------|---------|
| `src/hooks/useRepairs.ts` | `useRepairs(search?, tab?)` | `/api/repair-service` |
| `src/hooks/useRepairQueries.ts` | `useRepairs(page, limit)` | `/api/repair-service` |

Both fetch the same endpoint. The barrel `src/hooks/index.ts` exports the `useRepairQueries` version, but direct imports of `useRepairs.ts` get a different function. Ambiguous at import time.

### 3. Four `formatPhoneNumber()` implementations

| File | Format |
|------|--------|
| `src/components/repair/RepairTable.tsx:15` | `000-000-0000` |
| `src/components/repair/RepairDetailsPanel.tsx:265` | `(000) 000-0000` |
| `src/components/repair/RepairAgreement.tsx:20` | `(000) 000-0000` |
| `src/app/api/repair-service/print/[id]/route.tsx:68` | `(000) 000-0000` |

**Risk:** RepairTable displays phone as `000-000-0000` while all other repair components use `(000) 000-0000`. Visual inconsistency within the same feature.

### 4. Four `normalizeIdentifier()` implementations for manuals

| File | Logic |
|------|-------|
| `src/lib/product-manuals.ts:29` | Uppercase + strip non-alphanumeric + remove leading zeros |
| `src/app/api/manuals/resolve/route.ts:4` | Same as above but defined locally |
| `src/app/api/manuals/recent/route.ts:4` | Same as above but defined locally |
| `src/app/api/manuals/upsert/route.ts:4` | Uppercase + strip + remove leading zeros (slightly different) |

**Risk:** The helper exists in `product-manuals.ts` but three routes define their own local copy.

### 5. Two `normalizeFnsku()` duplicates

| File |
|------|
| `src/components/fba/StationFbaInput.tsx:61` |
| `src/components/fba/FbaQuickAddFnskuModal.tsx:24` |

Both do: `trim().toUpperCase().replace(/[^A-Z0-9]/g, '')` — identical logic already available as `normalizeTrackingCanonical()` in `tracking-format.ts`.

### 6. Two `parseSerialRows()` + `patchSerialNumberInData()` duplicates

| File |
|------|
| `src/components/shipped/details-panel/ShippingInformationSection.tsx:50` |
| `src/components/shipped/details-panel/blocks/SerialNumberFieldBlock.tsx:18` |

Exact same function duplicated in parent and child component.

---

## HIGH — Duplicate utility functions

### 7. Duplicate `number.ts` and `_number.ts`

| File | Exports |
|------|---------|
| `src/utils/number.ts` | Only `parsePositiveInt` |
| `src/utils/_number.ts` | `parsePositiveInt` + `formatCurrency`, `formatNumber`, `formatPercent`, `clamp`, `round`, `formatBytes` |

`number.ts` is a strict subset of `_number.ts`. Five API files import from `number.ts`.

### 8. 9+ inline date formatters across components

Components define local formatters instead of importing from `utils/date.ts` or `utils/_date.ts`:

| File | Function |
|------|----------|
| `src/app/manuals/page.tsx:18` | `formatDate()` |
| `src/components/work-orders/types.ts:106` | `formatDate()` |
| `src/components/work-orders/LocalPickupTable.tsx:54` | `formatPickupDate()` |
| `src/components/work-orders/LocalPickupTable.tsx:65` | `formatTimestamp()` |
| `src/components/station/ReceivingLinesTable.tsx:52` | `formatCompactDate()` |
| `src/components/station/ReceivingLinesTable.tsx:65` | `formatExpandedDate()` |
| `src/components/station/ReceivingLogs.tsx:48` | `formatDbTime()` |
| `src/components/support/SupportDashboard.tsx:48` | `formatDateTime()` |
| `src/components/admin/FeaturesManagementTab.tsx:58` | `formatDateTime()` |

### 9. Three week-navigation hooks with ~80% shared logic

| Hook | File |
|------|------|
| `useShippedTableData` | `src/hooks/useShippedTableData.ts` |
| `useTechLogs` | `src/hooks/useTechLogs.ts` |
| `usePackerLogs` | `src/hooks/usePackerLogs.ts` |

All three compute `weekRange`, `queryKey`, handle `weekOffset`, set stale times based on current-vs-historical, and subscribe to Ably for invalidation. Only the fetch URL and event name differ.

---

## HIGH — API route patterns

### 10. Duplicate API endpoints for same table

**Manuals:** Two separate endpoint trees doing the same thing:
- `/api/manuals/upsert`, `/api/manuals/resolve`, `/api/manuals/recent`
- `/api/product-manuals/upsert`, `/api/product-manuals/search`

**Packer logs:** Two separate endpoints:
- `/api/packerlogs` — complex query with raw SQL
- `/api/packing-logs` — simpler query, different format

Both return packing activity data. Clients use whichever endpoint they were written against.

### 11. Unsafe JSON body parsing in 92% of routes

Safe pattern (used in 5 routes):
```typescript
const body = await req.json().catch(() => null);
if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
```

Unsafe pattern (used in ~160 routes):
```typescript
const body = await req.json(); // throws on malformed body
```

The unsafe routes are wrapped in try/catch, but the error message is generic "500 Failed to ..." instead of "400 Invalid JSON".

### 12. No rate limiting on 172 of 196 routes

Only 24 routes have rate limiting. High-traffic endpoints like `/api/orders`, `/api/shipped`, `/api/assignments`, `/api/staff` are unprotected.

### 13. Inconsistent API error response shapes

| Pattern | Example |
|---------|---------|
| `{ error, details }` | `/api/orders/add`, `/api/sku-stock` |
| `{ success: false, error }` | `/api/scan-tracking`, `/api/receiving-lines` |
| `{ success: true, assignments: [], fallback }` | `/api/assignments` on DB unavailable |
| `{ ok: true, response }` | `/api/ai/chat` |
| Raw array/object | `/api/staff`, `/api/product-manuals` |

---

## MEDIUM — React pattern inconsistencies

### 14. Mixed fetch + useQuery for same data

Some components use `useQuery` with TanStack for data fetching (with caching, stale-while-revalidate), while adjacent components fetch the same endpoint with raw `fetch()` in `useEffect` (no caching). Examples:
- Repair data: `useRepairs()` hook with `useQuery` vs `RepairDetailsPanel.tsx` using raw `fetch()`
- FBA data: `FbaFnskuChecklist.tsx` uses 10+ raw `fetch()` calls in handlers

### 15. Orphaned window events (listeners with no dispatchers)

8 events have `addEventListener` calls but no corresponding `dispatchEvent`:
- `fba-board-selection`
- `fba-board-select-by-day`
- `fba-board-deselect-by-day`
- `fba-board-fnsku-select-result`
- `fba-board-selection-count`
- `fba-bulk-assign`
- `fba-print-focus-plan`
- `dashboard-focus-search`

1 event is dispatched but never listened to:
- `open-receiving-details`

### 16. localStorage key naming inconsistency

Three conventions mixed:
- Hyphens: `last-tech-station-href`, `command-bar-recent`
- Underscores: `fba_unknown_fnskus`, `auth_token`, `selected_sku_id`
- Colons: `fba:today_plan`, `fba:pending_catalog`, `dashboard:selected-order`

### 17. Race condition in RepairIntakeForm

`src/components/repair/RepairIntakeForm.tsx:101-111` — `useEffect` fetches `/api/repair/issues` without mount guard. `setSkuIssues` can fire after unmount when `favoriteSkuId` changes rapidly. Same file correctly uses the mount-guard pattern at line 89-95 for the staff fetch.

---

## MEDIUM — DB access patterns

### 18. Mixed Drizzle + raw SQL for same tables

| Table | Drizzle | Raw SQL |
|-------|---------|---------|
| `staff` | INSERT (api/staff POST) | SELECT (api/staff GET, 4+ other files) |
| `customers` | Full CRUD (customerRepository.ts) | Full CRUD (customer-queries.ts) |
| `admin_features` | Schema defined | All queries are raw SQL |
| `packer_logs` | INSERT (api/packerlogs POST) | SELECT (api/packerlogs GET, api/packing-logs) |

### 19. `SELECT *` in 50+ queries

Production queries selecting all columns instead of only what's needed:
- `src/lib/neon/fba-queries.ts:143` — `SELECT * FROM fba_shipments`
- `src/lib/neon/receiving-queries.ts:102,112,122` — `SELECT * FROM receiving`
- `src/lib/neon/sku-queries.ts:66,74` — `SELECT * FROM sku_stock`
- `src/app/api/work-orders/route.ts:189` — `SELECT * FROM work_assignments` in LATERAL

---

## Summary — what to fix by impact

| Priority | Issue | Fix | Status |
|----------|-------|-----|--------|
| **P0** | 3 conflicting `normalizeSku` | Repair route uses `formatSku`, favorites renamed to `normalizeSkuForLookup` | RESOLVED |
| **P0** | 2 `useRepairs` hooks, same name | `useRepairs.ts` renamed to `useRepairsTable` | RESOLVED |
| **P1** | 4 `formatPhoneNumber` copies | Created `src/utils/phone.ts`, all 3 inline copies import it | RESOLVED |
| **P1** | 4 `normalizeIdentifier` copies | 3 routes now import from `product-manuals.ts` | RESOLVED |
| **P1** | 2 `normalizeFnsku` copies | Both import `normalizeFnsku` alias from `tracking-format.ts` | RESOLVED |
| **P1** | 2 `parseSerialRows` copies | Extracted to `serial-helpers.ts`, both components import | RESOLVED |
| **P1** | `number.ts` duplicate of `_number.ts` | `number.ts` now re-exports from `_number.ts` | RESOLVED |
| **P2** | 9 inline date formatters | Added `formatMediumDate`/`formatMediumDateTime` to `_date.ts`, 5 of 9 consolidated (4 have unique formats) | PARTIALLY RESOLVED |
| **P2** | Duplicate manual endpoints | Deprecate `/api/manuals/*`, keep `/api/product-manuals/*` | NOT YET ADDRESSED |
| **P2** | Unsafe JSON parsing | Add `.catch()` to `req.json()` calls | NOT YET ADDRESSED |
| **P2** | 3 week-navigation hooks duplicated | Extract `useWeekNavigation` base hook | NOT YET ADDRESSED |
| **P3** | Orphaned window events | Removed `fba-bulk-assign` dead listener; `open-receiving-details` kept (needs listener, not removal) | PARTIALLY RESOLVED |
| **P3** | Race condition in RepairIntakeForm | Added mount guard to `useEffect` for `/api/repair/issues` fetch | RESOLVED |
| **P3** | localStorage key naming | Standardize on one convention | NOT YET ADDRESSED |
| **P3** | `SELECT *` queries | Specify columns | NOT YET ADDRESSED |
| **P3** | Mixed Drizzle + raw SQL | Document preferred pattern per table | NOT YET ADDRESSED |
