# Build Plan — Complete Shipment Status Migration
> Generated: 2026-03-11  
> Based on: `2026-03-10_drop_text_tracking_cols_PLAN.md` + `2026-03-11_shipment_status_migration_DECISION.md`

---

## Current State Snapshot

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 0 | Fix lowercase backfill bug (tech_serial_numbers) | ✅ SQL written |
| Phase 1 | Add `scan_ref` to `packer_logs`, backfill | ✅ SQL written |
| Phase 2 | Update all WRITE paths to populate `shipment_id` | 🔶 Partially done |
| Phase 3 | Update all READ paths to JOIN via `shipment_id` | 🔶 Partially done |
| Phase 4 | Drop `shipping_tracking_number` text columns | ⏳ SQL written, not run |
| Phase 5 | Remove `orders.is_shipped` + derive from `stn` | ❌ Not started (~50 locations) |

### Already complete (do not redo)
- `packing-logs-queries.ts` — reads via `shipment_id` JOIN ✅
- `tech-logs-queries.ts` — reads via `shipment_id` JOIN ✅
- `packerlogs/route.ts` GET — uses `shipment_id` JOIN ✅
- `packing-logs/route.ts` GET — uses `shipment_id` JOIN ✅
- `packerlogs/route.ts` POST — uses `resolveShipmentId()` ✅
- Drizzle `schema.ts` — `packer_logs` + `tech_serial_numbers` already have FK columns, text col removed ✅

---

## Step 1 — Complete Phase 2 writes in `packing-logs/route.ts` POST

**File:** `src/app/api/packing-logs/route.ts`

### 1a. Replace fuzzy order lookup (line ~178)

**Current (removes text col dependency but order lookup is still fuzzy):**
```sql
WHERE shipping_tracking_number IS NOT NULL
  AND shipping_tracking_number != ''
  AND RIGHT(regexp_replace(COALESCE(shipping_tracking_number, ''), '\D', '', 'g'), 8) = $1
```

**Replace with (join through normalized stn):**
```sql
SELECT o.id, o.order_id, o.shipping_tracking_number, o.shipment_id,
       o.product_title, o.condition, o.quantity, o.sku
FROM   orders o
JOIN   shipping_tracking_numbers stn ON stn.id = o.shipment_id
WHERE  stn.tracking_number_normalized = $1
```
Where `$1` = `normalizeTrackingNumber(scanInput)`.

Fallback for orders not yet linked to `stn`: keep a second query on `orders.shipping_tracking_number` normalized match if `shipment_id` lookup returns nothing.

### 1b. Remove `SET is_shipped = true` (line ~251–254)

```sql
-- REMOVE:
UPDATE orders SET is_shipped = true, ... WHERE id = $1 AND is_shipped = false
```

`is_shipped` will be derived from `shipping_tracking_numbers` in Phase 5. This UPDATE is now a no-op once Phase 5 is done. Remove it here so no new writes happen.

If a side-effect is needed (e.g. signaling that packing is complete), that is already captured by the `packer_logs` row being created.

---

## Step 2 — Complete Phase 2 writes in `packing-logs/update/route.ts`

**File:** `src/app/api/packing-logs/update/route.ts`

### Remove `SET is_shipped = true` block (lines ~134–160)

```typescript
// REMOVE the entire block:
// 3. Update orders table - set is_shipped to true only if not already shipped.
UPDATE orders SET is_shipped = true, ... WHERE id = $1 AND is_shipped = false
console.log('   Set is_shipped = true');
```

Also remove the `SELECT ... is_shipped` from the pre-check query on line ~111 (no longer needed once the update is gone).

---

## Step 3 — Complete Phase 2 writes in `work-orders/route.ts`

**File:** `src/app/api/work-orders/route.ts`

### 3a. Remove `SET is_shipped = true` (line ~700)

```typescript
// REMOVE:
if (isShipped) {
  await pool.query(`UPDATE orders SET is_shipped = true WHERE id = $1`, [orderId]);
}
```

### 3b. Replace `is_shipped` filter in GET query (line ~172)

```sql
-- BEFORE:
WHERE (o.is_shipped = false OR o.is_shipped IS NULL)

-- AFTER (derive from stn):
LEFT JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
WHERE NOT COALESCE(stn.is_carrier_accepted OR stn.is_in_transit
                   OR stn.is_out_for_delivery OR stn.is_delivered, false)
```

### 3c. Remove `isShipped` from PATCH body handling (lines ~672–700)

`isShipped` PATCH parameter is no longer meaningful — status is derived. Remove the body param, the `if (isShipped)` block, and update `AssignmentConfirmPayload` type.

---

## Step 4 — Complete Phase 2 writes in sync/import routes

### 4a. `src/lib/ebay/sync.ts` (lines ~129, ~160, ~176)

```sql
-- REMOVE all:
is_shipped = true,
-- and:
is_shipped,
```

eBay sync sets `is_shipped = true` when it sees a "Shipped" status from eBay. After migration, shipped status will come from `shipping_tracking_numbers` via the carrier polling job. Remove the SET.

### 4b. `src/app/api/ecwid/sync-exception-tracking/route.ts` (line ~187)

```sql
-- REMOVE:
is_shipped = true,
```

### 4c. `src/app/api/google-sheets/sync-shipstation-orders/route.ts` (line ~285)

```sql
-- REMOVE:
is_shipped = true,
```

ShipStation-sourced orders that already have a carrier scan in `shipping_tracking_numbers` will be correctly identified as shipped via the FK join.

### 4d. `src/app/api/google-sheets/execute-script/route.ts` (line ~63)

```typescript
// REMOVE:
.set({ isShipped: true })
```

### 4e. `src/app/api/orders/add/route.ts` (lines ~20, ~61, ~72)

Remove `isShipped = false` from default params, and `is_shipped` from INSERT.

### 4f. `src/app/api/shipped/submit/route.ts`

Remove `is_shipped` from the INSERT.

### 4g. `src/lib/orders-exceptions.ts` (lines ~168, ~186, ~192)

Remove `is_shipped` from SELECT and the CASE expression that updates it.

---

## Step 5 — Update READ filters that gate on `is_shipped`

These routes use `is_shipped` to determine if an order is pending/shipped. Replace with the derived `stn` expression.

### Derived "not yet shipped" expression (reusable):
```sql
LEFT JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id

-- "Not shipped" gate:
NOT COALESCE(
  stn.is_carrier_accepted OR stn.is_in_transit
  OR stn.is_out_for_delivery OR stn.is_delivered,
  false
)

-- "Is shipped" gate:
COALESCE(
  stn.is_carrier_accepted OR stn.is_in_transit
  OR stn.is_out_for_delivery OR stn.is_delivered,
  false
)
```

### Files to update:

| File | Line(s) | Change |
|------|---------|--------|
| `src/app/api/orders/route.ts` | ~123, ~125 | Replace `is_shipped = true` / `false` filters |
| `src/app/api/orders/next/route.ts` | ~73 | Replace `o.is_shipped IS NOT TRUE` gate |
| `src/app/api/orders/check-shipped/route.ts` | ~10, ~12 | Replace `is_shipped` filter |
| `src/app/api/orders/recent/route.ts` | ~46 | Remove `COALESCE(o.is_shipped, false)` from SELECT |
| `src/app/api/orders/backfill/ebay/route.ts` | ~49 | Replace `WHERE is_shipped = FALSE` |
| `src/app/api/work-orders/route.ts` | ~172 | Done in Step 3b |
| `src/app/api/google-sheets/execute-script/route.ts` | ~53 | Replace `WHERE o.is_shipped = false` |
| `src/app/api/shipped/lookup-order/route.ts` | ~25 | Replace `AND is_shipped = true` |
| `src/app/api/shipped/debug/route.ts` | ~15, ~46, ~58 | Replace `is_shipped` predicates with `stn.is_delivered` |
| `src/app/api/check-tracking/route.ts` | ~22, ~77 | Remove `is_shipped` from SELECT; compute from stn |
| `src/app/api/debug-tracking/route.ts` | ~29, ~74 | Remove `is_shipped` from SELECT; compute from stn |
| `src/app/api/orders/verify/route.ts` | ~25, ~58 | Remove `is_shipped`; return `shipped: stn.is_delivered` |
| `src/app/api/scan-tracking/route.ts` | ~78, ~101, ~117, ~135 | Remove `is_shipped`; return `shipped` from stn |
| `src/app/api/tech/scan-tracking/route.ts` | ~173, ~322, ~361, ~408, ~451 | Remove `is_shipped`; compute from stn |
| `src/app/api/tech-logs/route.ts` | ~110 | Remove `o.is_shipped` from SELECT; return from stn JOIN |
| `src/app/api/tech/orders-without-manual/route.ts` | ~60, ~88 | Remove `is_shipped`; compute from stn |
| `src/app/api/ebay/search/route.ts` | ~33, ~45 | Remove `o.is_shipped`; compute from stn |
| `src/lib/neon/orders-queries.ts` | ~121, ~171, ~174, ~228, ~274, ~277, ~379, ~404, ~442, ~483, ~499, ~509, ~529, ~542, ~596, ~610 | Replace all `is_shipped` reads/writes with derived expression |

---

## Step 6 — Update TypeScript interfaces and hooks

### 6a. `src/lib/neon/orders-queries.ts`
- Remove `is_shipped?: boolean` and `is_shipped: boolean` from interfaces (lines ~28, ~50)
- Remove `isShipped?: boolean` from params (line ~73)
- Remove `isShipped: 'is_shipped'` from field map (line ~610)
- Add `shipment_status?: string | null`, `is_shipped?: boolean` (derived, not persisted)

### 6b. `src/lib/neon/orders-table-structure.ts`
- Remove `is_shipped: boolean` from `OrderRecord` (line ~28)
- Remove `IS_SHIPPED: 'is_shipped'` from `ORDER_COLUMNS` (line ~72)
- Add derived fields: `shipment_status?`, `is_packed?`, `is_delivered?`, `carrier?`

### 6c. `src/hooks/useTechLogs.ts`
- Remove `is_shipped?: boolean` (line ~28)

### 6d. `src/hooks/useUpNextData.ts`
- Lines ~106, ~110: replace `!order.is_shipped` filter with `!order.is_shipped` from derived field
  (no code change needed if derived `is_shipped` is surfaced from the API — just verify the API response includes it)

### 6e. `src/hooks/useStationTestingController.ts`
- Line ~409: remove `is_shipped: data.order.isShipped ?? false`

### 6f. `src/utils/orders.ts`
- Line ~13: remove `{ name: 'is_shipped', type: 'BOOLEAN', notNull: true, default: 'false' }` from column definition list

---

## Step 7 — Update UI components

These components display a shipped/pending badge based on `is_shipped`. After migration they will receive `isShipped` as a derived boolean from the API (no visual change needed — just interface type updates).

| File | Lines | Change |
|------|-------|--------|
| `src/components/TechSearchPanel.tsx` | ~16, ~106, ~110 | Remove `is_shipped: boolean` from interface; receive from API as derived field |
| `src/components/ShippedSidebar.tsx` | ~326–327 | No logic change; receives `is_shipped` from API response |
| `src/components/UpdateManualsView.tsx` | ~19, ~37, ~81 | Remove `is_shipped: boolean`; receive `isShipped` from derived API field |
| `src/components/TechTable.tsx` | ~98 | `is_shipped: !!record.is_shipped` — no change needed if API returns it |
| `src/components/admin/OrdersManagementTab.tsx` | ~51, ~54, ~85 | No logic change; receives `is_shipped` from API |
| `src/components/admin/ManualAssignmentSidebarPanel.tsx` | ~25, ~281 | Remove `is_shipped: boolean`; receive from API |
| `src/components/admin/ManualAssignmentTab.tsx` | ~25, ~408 | Remove `is_shipped: boolean`; receive from API |
| `src/components/admin/ManualAssignmentTable.tsx` | ~16 | Remove `isShipped?: boolean` |
| `src/components/work-orders/WorkOrderAssignmentCard.tsx` | ~21, ~131, ~172 | Remove `isShipped` from payload; remove `handleMarkShipped` setting it |
| `src/components/work-orders/WorkOrdersDashboard.tsx` | ~203, ~231 | Remove `isShipped` from `AssignmentConfirmPayload`; remove PATCH call |
| `src/components/PackerTable.tsx` | ~95 | Remove `is_shipped: true` from optimistic patch |
| `src/components/station/upnext/OrderCard.tsx` | ~96 | Remove `is_shipped: !!order.is_shipped` from mapped shape |

---

## Step 8 — Update Drizzle `schema.ts`

```typescript
// src/lib/drizzle/schema.ts — remove from orders table:
isShipped: boolean('is_shipped').notNull().default(false),   // ← DELETE THIS LINE
```

Also remove the comment on line ~330:
```typescript
// Shipped table - DEPRECATED: Now using orders table with is_shipped = true
```
→ becomes:
```typescript
// Shipped table - DEPRECATED: Shipped status derived from shipping_tracking_numbers via shipment_id
```

---

## Step 9 — Run database migrations

Run in this order. Each is idempotent (`IF EXISTS` guards included).

```bash
# 1. (If not already applied)
psql $DATABASE_URL -f src/lib/migrations/2026-03-10_phase0_fix_lowercase_tracking.sql

# 2. (If not already applied)
psql $DATABASE_URL -f src/lib/migrations/2026-03-10_phase1_add_scan_ref.sql

# 3. Phase 4 — only after Steps 1–4 (write paths) are deployed
psql $DATABASE_URL -f src/lib/migrations/2026-03-10_phase4_drop_text_tracking_cols.sql

# 4. Phase 5 — only after Steps 5–8 are deployed and verified
psql $DATABASE_URL -f src/lib/migrations/2026-03-11_phase5_drop_orders_is_shipped.sql
```

**Gate check before Phase 4:**
```sql
-- Must return 0
SELECT COUNT(*) FROM packer_logs
WHERE tracking_type = 'ORDERS' AND shipment_id IS NULL;
```

**Gate check before Phase 5:**
```bash
# Must return nothing
rg "is_shipped|isShipped" src/ --type ts -l
```

---

## Step 10 — Verify derived status in key UI surfaces

After migration, confirm these surfaces show correct data from derived fields:

| Surface | Field to verify | Source |
|---------|----------------|--------|
| `PendingOrdersTable` | Orders without carrier scan show as pending | `stn.is_carrier_accepted = false` |
| `UpNextOrder` / `OrderCard` | Only non-shipped orders appear | derived `is_shipped = false` |
| `TechSearchPanel` | Shipped/Pending badge reflects real carrier status | `stn.latest_status_category` |
| `ShippedSidebar` | Shipped badge for delivered orders | `stn.is_delivered = true` |
| `WorkOrderAssignmentCard` | "Mark Shipped" button removed or disabled | `isShipped` no longer writable |
| `/api/orders/next` | Only returns non-shipped orders | derived filter via stn |

---

## Execution Order Summary

```
Step 1  → packing-logs/route.ts POST: fix order lookup + remove SET is_shipped
Step 2  → packing-logs/update/route.ts: remove SET is_shipped block
Step 3  → work-orders/route.ts: remove SET is_shipped + update GET filter
Step 4  → sync/import routes (6 files): remove all SET is_shipped
          ── deploy & verify Steps 1–4 ──
Step 9a → run Phase 4 SQL (drop shipping_tracking_number from packer_logs + tech_serial_numbers)
Step 5  → API routes (16 files): replace is_shipped filters with stn-derived expression
Step 6  → TypeScript interfaces + hooks (7 files)
Step 7  → UI components (14 files)
Step 8  → schema.ts: remove isShipped from orders table definition
          ── deploy & verify Steps 5–8 ──
Step 9b → run Phase 5 SQL (drop orders.is_shipped)
Step 10 → smoke test all key UI surfaces
```

---

## Risk Notes

| Risk | Mitigation |
|------|-----------|
| Orders with no `shipment_id` appear as "shipped" after migration | Derived `is_shipped` returns `false` when `stn` is NULL — safe |
| Orders shipped before `stn` polling populated carrier status | These will show as "not shipped" until next poll cycle — acceptable transient state |
| `WorkOrderAssignmentCard` "Mark Shipped" button broken after removing `isShipped` PATCH | Remove the button or repurpose it to trigger a carrier refresh instead |
| `orders/check-shipped` route used by external callers | Keep route; replace `is_shipped` predicate with `stn.is_delivered = true` |
| Phase 4 SQL run before all WRITE paths updated | Phase 4 SQL has a guard that aborts if unlinked ORDERS packer rows exist |
