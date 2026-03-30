# Tech Station Workflow — Complete Flow

## Overview
The tech station is where technicians scan tracking numbers, FNSKUs, and serial numbers for orders. All activity flows through `station_activity_logs` (SAL) as the single source of truth.

## Entry Points

### Unified Scan Endpoint: `POST /api/tech/scan`
**File:** `src/app/api/tech/scan/route.ts`

**Request:**
```json
{
  "value": "1Z999AA10123456784",  // or FNSKU like "X0ABCD1234"
  "techId": 2,
  "type": "TRACKING",             // optional — auto-detected if omitted
  "idempotencyKey": "uuid"        // optional — prevents duplicate processing
}
```

**Response:**
```json
{
  "success": true,
  "found": true,
  "orderFound": true,
  "salId": 12345,
  "scanSessionId": "session-uuid",
  "order": { "order_id": "...", "product_title": "...", "sku": "...", ... },
  "summary": { "tech_scanned_qty": 3, "pack_ready_qty": 2, "shipped_qty": 1 },
  "shipment": { "shipment_ref": "FBA-03/28/26", ... }
}
```

---

## Step-by-Step Flow

### Step 1: Input Validation & Rate Limiting
- Rate limit: 120 requests/60s per route
- Validates `value` and `techId` exist
- Returns 429 if rate exceeded, 400 if missing params

### Step 2: Scan Type Detection
Uses `looksLikeFnsku(value)` from `src/lib/scan-resolver.ts`:
- Pattern: `^(X0[A-Z0-9]{8}|B0[A-Z0-9]{8})$`
- If matches → FNSKU path
- If explicit `body.type === 'FNSKU'` → FNSKU path
- Otherwise → TRACKING path

### Step 3: Idempotency Check
- Reads idempotency key from header or body
- Queries idempotency cache table
- Returns cached 200 response if hit exists (prevents duplicate DB inserts on retry)

### Step 4: Staff Resolution
**File:** `src/lib/tech/resolveStaffIdFromTechParam.ts`
1. Try parse as numeric → `SELECT id FROM staff WHERE id = $1`
2. If no match → fall back to `TECH_EMPLOYEE_IDS` mapping ('1'→'TECH001', etc.)
3. Query `SELECT id FROM staff WHERE employee_id = $1`
4. Return staff.id or 404

---

## FNSKU Path (FBA Scans)

### Step 5a: Catalog Ensure
- Looks up FNSKU in `fba_fnskus` table
- If missing → INSERTs stub row with NULL metadata
- Returns catalog row + `catalogCreated` flag

### Step 5b: Open FBA Item Resolution
```sql
SELECT fsi.*, fs.shipment_ref, fs.amazon_shipment_id
FROM fba_shipment_items fsi
JOIN fba_shipments fs ON fs.id = fsi.shipment_id
WHERE fsi.fnsku = $1
  AND fs.status != 'SHIPPED'
  AND fsi.status != 'SHIPPED'
ORDER BY
  CASE fsi.status
    WHEN 'PLANNED' THEN 1
    WHEN 'READY_TO_GO' THEN 2
    WHEN 'LABEL_ASSIGNED' THEN 3
    ELSE 4
  END,
  fs.created_at ASC
LIMIT 1
```
Priority: oldest shipment, PLANNED items first.

### Step 5c: Station Activity Log (SAL) Creation
**File:** `src/lib/station-activity.ts`
```sql
INSERT INTO station_activity_logs (
  station, activity_type, staff_id, fnsku,
  fba_shipment_id, fba_shipment_item_id, metadata
) VALUES (
  'TECH', 'FNSKU_SCANNED', $staffId, $fnsku,
  $openItem.shipmentId, $openItem.itemId,
  '{"product_title": "...", "sku": "...", "asin": "..."}'::jsonb
) RETURNING id
```

### Step 5d: FBA Log Creation
**File:** `src/lib/fba/createFbaLog.ts`
```sql
INSERT INTO fba_fnsku_logs (
  fnsku, source_stage, event_type, staff_id,
  station_activity_log_id, fba_shipment_id,
  fba_shipment_item_id, quantity, station
) VALUES (
  $fnsku, 'TECH', 'SCANNED', $staffId,
  $salId, $shipmentId, $itemId, 1, 'TECH_STATION'
) RETURNING id
```

### Step 5e: Lifecycle Summary
Aggregates from `fba_fnsku_logs` for this FNSKU:
- `tech_scanned_qty`: SUM(quantity) WHERE source_stage='TECH' AND event_type='SCANNED'
- `pack_ready_qty`: SUM(quantity) WHERE source_stage='PACK' AND event_type IN ('READY','VERIFIED','BOXED')
- `shipped_qty`: SUM(quantity) WHERE source_stage='SHIP' AND event_type='SHIPPED'
- `available_to_ship`: min(tech_scanned, pack_ready) - shipped
- Excludes event_type='VOID'

### Step 5f: Cache Invalidation & Publish
- Invalidates cache tags: `orders`, `orders-next`, `tech-logs`
- Publishes `publishTechLogChanged()` via Ably

---

## TRACKING Path (Order Scans)

### Step 6a: Tracking Resolution
**File:** `src/lib/scan-resolver.ts` — `classifyInput(raw)`
- Tests against 52+ regex patterns for carrier detection
- Carriers: UPS (1Z+16), FedEx (9621+29, 399+9, 96+20), USPS (92+18-20), DHL, Amazon (TBA+12), OnTrac, LaserShip, GSO
- Normalizes to `key18` (last 18 alphanumeric) and `last8` (last 8 digits)

### Step 6b: Order Lookup
```sql
SELECT o.id, o.order_id, o.product_title, o.sku, o.status, ...
FROM orders o
JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
WHERE ...
```
Three priority fallback attempts:
1. **Priority 0:** Exact `shipment_id` match
2. **Priority 1:** `key18` suffix match on `tracking_number_normalized`
3. **Priority 2:** `last8` digits match

### Step 6c: Order NOT Found
1. Creates/updates `orders_exceptions` row with exception reason
2. Creates SAL with `metadata.order_found = false`
3. Creates `station_scan_sessions` row for session tracking
4. Returns `{ found: false, orderFound: false }` — UI shows inline microcopy, not modal error

### Step 6d: Order Found
1. Creates SAL with order context and `metadata.order_found = true`
2. Fetches existing serials via `getSerialsBySalId()`
3. Publishes `publishOrderTested()` event
4. Returns order payload with serial list

---

## Serial Number Insertion

### Endpoint: `POST /api/tech/serial` (action: 'add')
**File:** `src/lib/tech/insertTechSerialForTracking.ts`

### Step 7a: Serial Normalization
- Trim, uppercase, validate not empty

### Step 7b: Context Resolution
**File:** `src/lib/tech/resolveTechSerialInsertContextFromSal.ts`
- Gets latest SAL for this tech (TRACKING_SCANNED, FNSKU_SCANNED, or SERIAL_ADDED)
- Extracts: shipmentId, ordersExceptionId, fnsku, fnsku_log
- If context is SERIAL_ADDED → walks back to the original scan SAL

### Step 7c: Serial Type Inference
- If serial starts with X0 or B0 → type='FNSKU'
- Else if context has fnsku → type='FNSKU'
- Else → type='SERIAL'

### Step 7d: Duplicate Detection
- Queries existing TSN rows for this context (by context_station_activity_log_id or fallback FK)
- If duplicate found + account_source != 'fba' → 400 error
- FBA account source allows duplicates (same FNSKU multiple times)

### Step 7e: TSN Insert
```sql
INSERT INTO tech_serial_numbers (
  shipment_id, orders_exception_id, serial_number, serial_type,
  tested_by, fnsku, fnsku_log_id, fba_shipment_id,
  fba_shipment_item_id, context_station_activity_log_id
) VALUES (...) RETURNING id
```

### Step 7f: SAL Insert
```sql
INSERT INTO station_activity_logs (
  station, activity_type, staff_id, tech_serial_number_id,
  metadata
) VALUES ('TECH', 'SERIAL_ADDED', $staffId, $tsnId,
  '{"serial": "...", "serial_type": "..."}'::jsonb
)
```

### Step 7g: Order Status History
Appends to `orders.status_history` JSONB:
```json
{
  "status": "serial_added",
  "timestamp": "...",
  "user": "Thuc",
  "serial": "ABC123",
  "serial_type": "SERIAL",
  "previous_status": "assigned"
}
```
Non-blocking — wrapped in try-catch.

### Step 7h: Realtime Publish
- Invalidates: tech-logs, orders-next cache tags
- Publishes: publishTechLogChanged, publishOrderTested

---

## Serial CRUD: `POST /api/tech/serial`

### Action: add
Full flow as described in Step 7 above.

### Action: remove
1. Deletes SERIAL_ADDED SAL rows referencing TSN
2. Deletes TSN row
3. Publishes update event
4. Returns updated serial list

### Action: update
1. Accepts desired final serial list
2. Normalizes + deduplicates input
3. Queries existing TSN rows for SAL
4. Deletes removed serials (cascading SAL delete)
5. Inserts new serials (creates SERIAL_ADDED SAL for each)
6. Returns updated serial list

### Action: undo
1. Queries last TSN row: `ORDER BY id DESC LIMIT 1`
2. Deletes SERIAL_ADDED SAL referencing TSN
3. Deletes TSN row
4. Returns removed serial name

---

## Delete Scan: `POST /api/tech/delete`

Cascade delete entire scan session. Transaction-wrapped.

**Delete Order:**
1. Delete SERIAL_ADDED SAL rows (references TSN via tech_serial_number_id)
2. Delete TSN rows (context_station_activity_log_id = salId)
3. Delete fba_fnsku_logs rows (station_activity_log_id = salId)
4. Delete anchor SAL row

Cache invalidation: `tech-logs`, `orders-next`, `shipped`, `orders`
Realtime publish: `publishTechLogChanged` with action='delete'

---

## Tech Logs Query: `GET /api/tech/logs`

**Parameters:** techId (required), weekStart, weekEnd, limit (max 2000, default 500), offset

**Caching:**
- Current week: 30s TTL
- Historical: 1h TTL
- Key: `api:tech-logs-v2:{techId}:{weekStart}:{weekEnd}:{limit}:{offset}`

**Query:**
```sql
SELECT sal.*, stn.tracking_number_raw, ff.product_title, ff.asin,
  STRING_AGG(tsn.serial_number, ', ') as serial_number,
  o.order_id, o.product_title, o.sku, o.condition, ...
FROM station_activity_logs sal
LEFT JOIN shipping_tracking_numbers stn ON stn.id = sal.shipment_id
LEFT JOIN fba_fnskus ff ON ff.fnsku = sal.fnsku
LEFT JOIN fba_fnsku_logs ffl ON ffl.station_activity_log_id = sal.id
LEFT JOIN orders o ON o.shipment_id = sal.shipment_id
LEFT JOIN LATERAL (
  SELECT * FROM work_assignments wa
  WHERE wa.entity_type='ORDER' AND wa.entity_id = o.id
  ORDER BY ...
  LIMIT 1
) wa ON true
LEFT JOIN tech_serial_numbers tsn ON tsn.context_station_activity_log_id = sal.id
WHERE sal.station = 'TECH'
  AND sal.activity_type IN ('TRACKING_SCANNED', 'FNSKU_SCANNED')
  AND sal.staff_id = $techId
  AND sal.created_at BETWEEN $start AND $end
GROUP BY sal.id, stn.id, ff.fnsku, ffl.id, o.id, wa.id
ORDER BY sal.created_at DESC
```

**Computed Fields:**
- `source_kind`: 'fba_scan' (FNSKU_SCANNED), 'tech_serial' (has TSN), 'tech_scan' (else)
- `shipping_tracking_number`: COALESCE(stn.tracking_number_raw, sal.scan_ref, sal.fnsku)

---

## UI Components

### StationTesting (`src/components/station/StationTesting.tsx`)

**Props:**
```typescript
{ userId, userName, staffId, onTrackingScan, todayCount, goal, onComplete, embedded, onViewManual }
```

**Input Modes (StationInputMode):**
- `tracking` — force TRACKING scan type
- `fba` — force FNSKU scan type
- `serial` — force SERIAL scan type
- `repair` — force REPAIR scan type

**Mode Button Behavior:**
- Click to arm mode (manual override)
- Click again to disarm (return to auto-detect)
- If text in field + arming → submit immediately with forced type
- Single-shot: after submit, returns to auto mode

**Active Order Display:**
- Visible for 2 minutes after qty complete (auto-hide timer)
- Shows order details + serial list
- Can reopen via "reopen" button after auto-hide

### useStationTestingController (`src/hooks/useStationTestingController.ts`)

**Core State:**
- `inputValue`: scan input
- `activeOrder`: current order card
- `isLoading`: request in-flight
- `errorMessage`, `resolvedManuals`

**Key Refs:**
- `lastScannedOrderRef`: enables "reopen card" after auto-hide
- `scanSessionIdRef`: session anchor for serial adds
- `completedOrderHideTimerRef`: 2-minute auto-hide timer

**Scan Type Resolution:**
```typescript
resolveScanType(val, contextOrder) {
  base = detectStationScanType(val)
  // If order incomplete + base=TRACKING → route to SERIAL instead
  // Prevents tracking patterns from clearing incomplete card
  // Allows explicit tracking mode to override
}
```

**Partial Serial Resolution:**
When serial < 11 chars and existing serials present:
1. Try suffix match against known serials
2. If single match → use full canonical serial
3. If ambiguous (multiple matches) → error "require full serial"
4. If no match → store raw partial

**Idempotency:**
- Generates UUID via `crypto.randomUUID()` or timestamp fallback
- Passed to all scan endpoints to prevent duplicate processing

**Events Fired:**
- `tech-log-added` — prepends new scan to TechTable
- `fba-fnsku-station-scanned` — notifies FBA workspace
- `usav-refresh-data` — global data invalidation
- `tech-last-manual-updated` — publishes resolved manuals to localStorage

**Events Listened:**
- `tech-undo-applied` — updates serial list after undo
- `tech-log-removed` — clears activeOrder if matching scan deleted

---

## Database Tables Touched

| Table | Operation | Purpose |
|-------|-----------|---------|
| `staff` | Read | Tech validation |
| `orders` | Read, Update | Order lookup, status history |
| `shipping_tracking_numbers` | Read, Join | Tracking resolution |
| `work_assignments` | Read, Join | Deadline/assignment info |
| `station_activity_logs` | Insert, Read, Delete | Central event ledger |
| `tech_serial_numbers` | Insert, Read, Delete | Serial tracking |
| `fba_fnskus` | Read, Insert | FNSKU catalog |
| `fba_shipment_items` | Read, Update | Open item resolution, status bump |
| `fba_shipments` | Join | Shipment metadata |
| `fba_fnsku_logs` | Insert, Read, Delete | FBA lifecycle tracking |
| `orders_exceptions` | Insert, Read | Unmatched tracking |
| `station_scan_sessions` | Insert | Session anchoring |

---

## Error Handling

| Error | Status | Cause |
|-------|--------|-------|
| Rate limit exceeded | 429 | >120 requests/60s |
| Missing value/techId | 400 | Required params absent |
| Staff not found | 404 | Invalid techId |
| FNSKU not in catalog | 400 | (performTechFnskuScan path) |
| Duplicate serial (non-FBA) | 400 | Same serial in same context |
| No scan context | 400 | No SAL anchor for serial |
| JSON parse error | 400 | Malformed request body |
| DB error | 500 | Transaction failure |

---

## Key Design Patterns

1. **SAL as Source of Truth** — All queries join via SAL for data consistency
2. **Context Resolution** — Serial inserts resolve context from latest SAL, not from body
3. **Duplicate Handling** — FBA allows duplicates, non-FBA rejects
4. **Idempotency** — UUID key + cached responses prevent duplicate processing
5. **Transaction Safety** — BEGIN/COMMIT/ROLLBACK for all multi-table operations
6. **Window Events** — tech-log-added, tech-log-removed for live UI updates without page reload
7. **Caching** — 30s current week, 1h historical, invalidated on any scan/serial change
