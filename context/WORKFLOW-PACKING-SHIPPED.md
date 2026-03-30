# Packing Station & Shipped Orders — Complete Flow

## Overview
The packing station is where packers scan orders after tech testing, upload photos, and mark orders as shipped. Orders flow: Tech Station → Packing Station → Shipped Dashboard.

---

## Packing Station UI

### StationPacking (`src/components/station/StationPacking.tsx`)

**Props:**
```typescript
{ userId, userName, staffId, todayCount, goal, onComplete, embedded }
```

**Core State:**
```typescript
activeOrder: { orderId, productTitle, qty, condition, tracking } | null
activeFba: { fnsku, productTitle, shipmentRef, plannedQty, combinedPackScannedQty, isNew } | null
```

**Scan Flow:**
1. User scans barcode into `inputValue`
2. On submit, calls `looksLikeFnsku(value)` to detect type
3. **If FBA/FNSKU detected:**
   - POST `/api/fba/items/scan` with `{ fnsku, staff_id, station: 'PACK_STATION' }`
   - Sets `activeFba` state, triggers `onComplete()`
4. **If regular tracking:**
   - POST `/api/packing-logs` with tracking number
   - Resolves `trackingType` from response
   - If type is 'ORDERS' → sets `activeOrder` state
5. Dispatches `usav-refresh-data` custom event
6. Clears input, maintains focus for next scan

---

## Packing Log API Endpoints

### Web Packing: `POST /api/packing-logs`
**File:** `src/app/api/packing-logs/route.ts`

**Request:**
```json
{
  "trackingNumber": "1Z999AA10123456784",
  "photos": ["https://..."],
  "packerId": 4,
  "packerName": "Tuan",
  "createdAt": "03/28/2026 14:30:00"
}
```

**Scan Classification:**
```typescript
classification = classifyScan(scanInput)
// Returns: { trackingType: 'ORDERS' | 'SKU' | 'FBA' | 'FNSKU', normalizedInput, skuBase?, skuQty? }
```

**Three Paths:**

#### Path A: Order Found
1. Normalize tracking to 3 formats: canonical, last-8 digits, last-18 alphanumeric
2. Query `orders` table (3 fallback attempts):
   - Primary: exact normalized match via `shipment_id` FK
   - Fallback 1: last-8 suffix match
   - Fallback 2: 18-char key match
3. If found:
   - UPDATE `orders.status = 'shipped'`
   - INSERT `packer_logs` row with `shipment_id`
   - UPSERT `work_assignments` (type=PACK, status=DONE)
   - INSERT `photos` if present
   - INSERT `station_activity_logs` (PACK_COMPLETED)
   - Invalidate cache tags: `['packing-logs', 'orders', 'shipped']`

#### Path B: Order Not Found
1. Upsert to `orders_exceptions` table
2. Resolve shipment via `resolveShipmentId()` (may create new shipping_tracking_numbers)
3. Check for duplicate packer_logs
4. INSERT packer_logs with `shipment_id=null, scan_ref={tracking}`
5. Store photos, create SAL
6. Return warning: "Order not found. Added to exceptions queue."

#### Path C: Non-Order Scans (SKU/FNSKU)
1. INSERT packer_logs with `shipment_id=null, scan_ref={normalizedInput}`
2. If SKU type with quantity: upsert `sku_stock` table, increment stock
3. Return success with `skuUpdated` flag

---

### Mobile Packing Session: `POST /api/packing-logs/start-session`

**Request:**
```json
{
  "trackingNumber": "...",
  "packedBy": 4,
  "trackingType": "ORDERS",
  "scanRef": "..."
}
```

**Flow:**
1. Normalize tracking to canonical + key-18 format
2. Query orders via shipment_id FK
3. INSERT packer_logs row
4. Return packerLogId, shipmentId, orderId

---

### Mobile Packing Update: `POST /api/packing-logs/update`

**Request:**
```json
{
  "shippingTrackingNumber": "...",
  "trackingType": "ORDERS",
  "packDateTime": "03/28/2026 14:30:00",
  "packedBy": 4,
  "packerPhotosUrl": ["https://blob.vercel.store/..."],
  "orderId": 12345
}
```

**Transaction Steps:**

**Step 1: Resolve Shipment**
- `resolveShipmentId(trackingNumber)` → finds or creates shipping_tracking_numbers row

**Step 2: Insert/Update packer_logs**
```sql
INSERT INTO packer_logs (shipment_id, scan_ref, tracking_type, created_at, packed_by)
VALUES ($1, $2, $3, $4, $5)
RETURNING id
```

**Step 3: Create Station Activity Log**
- Type='PACK', activityType='PACK_COMPLETED'
- Metadata: { photos_count, tracking_type }

**Step 4: Insert Photos**
```sql
INSERT INTO photos (entity_type, entity_id, url, taken_by_staff_id, photo_type)
VALUES ('PACKER_LOG', $packerLogId, $url, $staffId, 'box_label')
ON CONFLICT (entity_type, entity_id, url) DO NOTHING
```

**Step 5: Update Orders Status**
```sql
UPDATE orders SET status = 'shipped'
WHERE shipment_id = $1 AND (status IS NULL OR status != 'shipped')
RETURNING id, order_id
```
Fallback: tracking suffix match if shipment_id=NULL

**Step 6: Upsert Work Assignment**
```sql
INSERT INTO work_assignments (
  entity_type, entity_id, work_type,
  assigned_packer_id, completed_by_packer_id,
  status, priority, notes, completed_at
) VALUES ('ORDER', $1, 'PACK', $2, $2, 'DONE', 100, 'Auto-completed on mobile pack scan', NOW())
ON CONFLICT (entity_type, entity_id, work_type)
WHERE status IN ('ASSIGNED', 'IN_PROGRESS')
DO UPDATE SET completed_by_packer_id=$2, status='DONE', completed_at=NOW()
```

---

### Photo Upload: `POST /api/packing-logs/save-photo`

**Request:**
```json
{
  "photo": "base64-encoded-image",
  "orderId": "12345",
  "packerId": 4,
  "photoIndex": 0,
  "packerLogId": 98765
}
```

**Flow:**
1. Decode base64 → Buffer
2. Generate path: `packer_photos/packer_{packerId}/{orderId}_{photoIndex+1}.jpg`
3. Upload to Vercel Blob with public access
4. INSERT into photos table (entity_type='PACKER_LOG')
5. Return blob URL + photo ID

---

## Shipped Orders

### shipping_tracking_numbers Table (Core Schema)
```sql
tracking_number_raw TEXT NOT NULL,
tracking_number_normalized TEXT NOT NULL UNIQUE,
carrier TEXT NOT NULL,

-- Status lifecycle
latest_status_category TEXT,  -- LABEL_CREATED, ACCEPTED, IN_TRANSIT, OUT_FOR_DELIVERY, DELIVERED, EXCEPTION
is_label_created BOOLEAN DEFAULT false,
is_carrier_accepted BOOLEAN DEFAULT false,
is_in_transit BOOLEAN DEFAULT false,
is_delivered BOOLEAN DEFAULT false,
has_exception BOOLEAN DEFAULT false,
is_terminal BOOLEAN DEFAULT false,

-- Timestamps
label_created_at TIMESTAMPTZ,
carrier_accepted_at TIMESTAMPTZ,
delivered_at TIMESTAMPTZ,

-- Polling
last_checked_at TIMESTAMPTZ,
next_check_at TIMESTAMPTZ,
check_attempt_count INTEGER DEFAULT 0,
latest_payload JSONB
```

**Key Concept:** `is_shipped` is **derived** — an order is "shipped" when it has a tracking number with carrier acceptance, NOT a stored boolean on orders.

### shipment_tracking_events Table
Append-only carrier event log:
```sql
shipment_id BIGINT REFERENCES shipping_tracking_numbers(id),
normalized_status_category TEXT NOT NULL,
event_occurred_at TIMESTAMPTZ,
event_city TEXT, event_state TEXT,
signed_by TEXT, exception_code TEXT,
payload JSONB NOT NULL
```

---

### List Shipped: `GET /api/shipped`

**Parameters:** q, page, limit (50), weekStart, weekEnd, packedBy, testedBy, missingTrackingOnly, shippedFilter

**Caching:**
- Upstash Redis, key: `api:shipped + {all params}`
- TTL: 300s (5 minutes)
- Cache tags: `['shipped']`
- Stale-while-revalidate: 60s

**Response:**
```json
{
  "shipped": [{ "id", "order_id", "product_title", "shipping_tracking_number", "packed_by", "tested_by", ... }],
  "page": 1, "limit": 50, "count": 50
}
```

### Create Shipped: `POST /api/shipped/submit`
Creates new shipped order entry from intake form:
```sql
INSERT INTO orders (order_id, product_title, condition, sku, status, created_at)
VALUES ($1, $2, $3, $4, 'shipped', NOW())
```
Combines reason + title: `"{reason} - {product_title}"`

---

## Order Assignment

### `POST /api/orders/assign`
**File:** `src/app/api/orders/assign/route.ts`

**Request:**
```json
{
  "orderId": 123,           // or "orderIds": [123, 456]
  "testerId": 2,            // assign tech (0 to unassign)
  "packerId": 4,            // assign packer (0 to unassign)
  "shipByDate": "2026-03-30",
  "shippingTrackingNumber": "1Z...",
  "outOfStock": "reason",
  "notes": "...",
  "itemNumber": "...",
  "condition": "Used-A"
}
```

**Transaction Steps:**

**Step 1: Upsert Work Assignments**
For TEST (tech):
```sql
SELECT id FROM work_assignments
WHERE entity_type='ORDER' AND entity_id=$1 AND work_type='TEST'
  AND status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS')
ORDER BY CASE status WHEN 'ASSIGNED' THEN 1 WHEN 'IN_PROGRESS' THEN 2 WHEN 'OPEN' THEN 3 END
LIMIT 1
-- Then UPDATE assigned_tech_id, status='ASSIGNED'
-- Or INSERT new row
```

For PACK (packer):
```sql
-- Same pattern but only ASSIGNED/IN_PROGRESS (no OPEN)
```

If staffId === null: Cancel active assignment (status='CANCELED')

**Step 2: Update Deadline**
If shipByDate provided → update or create work_assignment with deadline_at

**Step 3: Upsert Tracking**
1. Check duplicates on other orders
2. Detect carrier from tracking number
3. INSERT/UPDATE shipping_tracking_numbers
4. UPDATE orders SET shipment_id = new shipping_tracking_numbers.id

**Step 4: Update Order Fields**
```sql
UPDATE orders SET order_id=$1, out_of_stock=$2, notes=$3, item_number=$4, condition=$5
WHERE id IN (...)
```

**Step 5: Handle Out-of-Stock**
If FEATURE_REPLENISHMENT enabled and outOfStock changed:
- Create replenishment request or clear existing

**Step 6: Invalidate & Publish**
- Cache tags: orders, shipped, orders-next, tech-logs, packerlogs, packing-logs, need-to-order
- Realtime: OrderChanged, OrderAssignmentsUpdated events

---

## UI Components

### PackerTable (`src/components/PackerTable.tsx`)
**Purpose:** Packer's weekly work summary with deduplication.

**Deduplication Logic:**
- Non-FBA records: tracking number as key (last scan wins)
- FBA records: keep all (`fba:${record.id}` as key)
- Deduped records are primary display

**Grouping:** By date (PST YYYY-MM-DD), filtered by week range (Mon-Fri)

**Search:** Fuzzy across product_title, order_id, shipping_tracking_number, scan_ref, sku, condition, account_source

**Week Navigation:** weekOffset (0=current, 1=last week, etc.)

**Events:**
- Listens: `packer-log-added`, `usav-refresh-data`
- Dispatches: `open-shipped-details`

### TechTable (`src/components/TechTable.tsx`)
**Purpose:** Technician's testing log with serial merging.

**Serial Merging:**
```typescript
mergeSerialNumbers(a, b) {
  // Split by comma, trim, uppercase, deduplicate, rejoin
  return Array.from(new Set([...a.split(','), ...b.split(',')])).join(', ');
}
```

**FBA Detection:**
- source_kind === 'fba_scan'
- account_source === 'fba'
- has fnsku
- order_id === 'FBA'

**Deduplication (different from PackerTable):**
- FBA: keep all (no merge)
- Same tracking: merge serials, prefer tech_serial over tech_scan, keep best condition/SKU

**Events:**
- Listens: `tech-log-removed`
- Removes from display via `removedRowKeys` Set

### DashboardShippedTable (`src/components/shipped/DashboardShippedTable.tsx`)
**Purpose:** Main shipped orders list with filtering, search, date grouping.

**Features:**
- Week offset navigation
- FBA/SKU/ORDERS filtering
- Sticky date header while scrolling
- Click to open ShippedDetailsPanel
- Keyboard navigation (up/down arrows)

**FBA Detection:**
```typescript
isFbaPackerRecord(record) {
  return /^FBA[0-9A-Z]{8,}$/i.test(record.scan_ref) ||
    record.tracking_type === 'FBA' || record.tracking_type === 'FNSKU';
}
```

### ShippedDetailsPanel (`src/components/shipped/ShippedDetailsPanel.tsx`)
**Purpose:** Side panel for viewing/editing a single shipped order.

**Features:**
- Editable fields: order_id, tracking, item_number, ship_by_date, notes
- Photo gallery
- Delete with arm/confirm pattern
- Context-aware (dashboard, queue, station, packer)

### AdminDetailsStack (`src/components/shipped/stacks/AdminDetailsStack.tsx`)
**Purpose:** Bulk assignment panel for admin.

**Features:**
- Tester/packer selection with staff-themed buttons
- "Apply To Selected" for bulk assignment
- Shows single order details when 1 selected

### OrdersManagementTab (`src/components/admin/OrdersManagementTab.tsx`)
**Purpose:** Admin orders list with filters and bulk actions.

**Filters:** all, unassigned, assigned, need to order
**Bulk Actions:** Select multiple → assign tech/packer → Apply
**Quick Assign:** "Assign Left Unassigned: Cuong + Thuy" button (DEFAULT_TECH_ID + DEFAULT_PACKER_ID)

---

## Caching Strategy

### Cache Tags for Invalidation
```
Order Changes:     'orders', 'shipped', 'orders-next'
Packing Activity:  'packing-logs', 'packerlogs', 'packer-logs'
Testing Activity:  'tech-logs'
Inventory:         'need-to-order'
```

### Redis Cache Keys
```
api:packing-logs:{staffId}:{limit}:{offset}
api:packerlogs:{staffId}:{limit}:{offset}:{weekStart}:{weekEnd}
api:shipped:{query}:{page}:{limit}:{weekStart}:{weekEnd}:{packedBy}:{testedBy}
```

### Prepend-to-Cache Pattern
When a new packer_logs row is created:
1. Get cached array for current week
2. Prepend new record
3. Slice to 1000 items max
4. Set back to Redis (120s TTL)
5. Avoids full invalidation — keeps UI instant

---

## Realtime Events

### Window Events (Client-Side)
```typescript
'usav-refresh-data'              // Global data refresh
'packer-log-added'               // New packer log (prepend to PackerTable)
'open-shipped-details'           // Open details panel
'close-shipped-details'          // Close details panel
'navigate-shipped-details'       // Up/down navigation in panel
'dashboard-refresh'              // Dashboard-specific refresh
```

### Ably Events (Server → Client)
```typescript
publishPackerLogChanged({ packerId, action: 'insert', packerLogId, row, source })
publishOrderChanged({ orderIds, source })
publishOrderAssignmentsUpdated({ orderId, testerId, packerId, testerName, packerName, deadlineAt })
```

---

## Complete Order Flow Diagram

```
1. ORDER CREATED
   ├─ INSERT orders (id, order_id, product_title, sku, condition)
   ├─ shipment_id = NULL initially
   └─ status = NULL

2. ADMIN ASSIGNS TECH + PACKER
   ├─ POST /api/orders/assign { testerId, packerId, orderId }
   ├─ INSERT/UPDATE work_assignments (TEST + PACK)
   └─ Optional: set deadline_at, tracking

3. TECH TESTS ITEM
   ├─ Scan tracking at tech station
   ├─ INSERT station_activity_logs (TRACKING_SCANNED)
   ├─ Add serials → INSERT tech_serial_numbers
   └─ Publish tech-log-added event

4. PACKER SCANS AT PACK STATION
   ├─ Scan tracking → POST /api/packing-logs
   ├─ Classify: ORDERS / FBA / SKU
   │
   ├─ IF ORDERS + FOUND:
   │  ├─ UPDATE orders SET status='shipped'
   │  ├─ INSERT packer_logs (shipment_id)
   │  ├─ UPSERT work_assignments (PACK → DONE)
   │  └─ INSERT photos, station_activity_logs
   │
   ├─ IF ORDERS + NOT FOUND:
   │  ├─ INSERT orders_exceptions
   │  └─ INSERT packer_logs (scan_ref only)
   │
   └─ IF SKU:
      └─ UPSERT sku_stock (increment)

5. PHOTOS UPLOAD (Mobile)
   ├─ POST /api/packing-logs/save-photo (per photo)
   ├─ Upload to Vercel Blob
   └─ INSERT photos (PACKER_LOG)

6. SHIPPED VIEW
   ├─ GET /api/shipped (paginated, filtered)
   ├─ DashboardShippedTable groups by date
   └─ ShippedDetailsPanel for drill-down

7. CARRIER TRACKING (Background)
   ├─ QStash job: POST /api/qstash/shipping/sync-due (every 2h)
   ├─ Calls UPS/FedEx/USPS APIs
   ├─ INSERT shipment_tracking_events
   └─ UPDATE shipping_tracking_numbers (status flags)
```

---

## Database Tables Summary

| Table | Operation | Purpose |
|-------|-----------|---------|
| `orders` | Read, Update | Order lookup, status='shipped' |
| `packer_logs` | Insert, Update | Packing scan audit trail |
| `work_assignments` | Insert, Update | PACK assignment → DONE |
| `photos` | Insert | Packing photos (Vercel Blob URLs) |
| `shipping_tracking_numbers` | Read, Insert, Update | Tracking master |
| `shipment_tracking_events` | Insert | Carrier event log |
| `station_activity_logs` | Insert | PACK_COMPLETED audit |
| `orders_exceptions` | Insert | Unmatched scans |
| `sku_stock` | Upsert | SKU inventory updates |
| `staff` | Read | Packer validation |

---

## Error Handling

| Error | Status | Cause |
|-------|--------|-------|
| Missing trackingNumber/packerId | 400 | Required params absent |
| Invalid packer ID | 400 | Staff lookup failed |
| Duplicate tracking on another order | 409 | Tracking already linked |
| Order not found | 200 (warning) | Added to exceptions queue |
| Transaction failure | 500 | DB error with ROLLBACK |
| Blob upload failure | 500 | Vercel Blob error |
