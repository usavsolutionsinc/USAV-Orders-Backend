# FBA (Amazon) Workflow — Complete Flow

## Overview
FBA workflow manages Amazon FBA shipments from plan creation through FNSKU scanning, verification, and shipment closing. Items flow: PLANNED → READY_TO_GO → LABEL_ASSIGNED → SHIPPED.

---

## FBA Page (`src/app/fba/page.tsx`)

**Tabs:** combine (default), shipped
**State:**
- `board` — pending items from `/api/fba/board`
- `weekOffset` — week pagination
- `searchQuery` — FNSKU search overlay
- `staffId` — resolved from URL param or staff directory (cached)
- `stationTheme` — staff-specific color theme

**Data Flow:**
1. Fetches `/api/fba/board` on mount
2. Board aggregates items into `pending` (packed + awaiting)
3. Filters items by week using `isItemInWeek(item, startStr, endStr)`
4. Supports URL params: `?staffId=5&tab=combine&r=1` (r = refresh trigger)

---

## FBA Board Table (`src/components/fba/FbaBoardTable.tsx`)

**FbaBoardItem Interface:**
```typescript
{
  item_id, fnsku, expected_qty, actual_qty, item_status,
  display_title, asin, sku, item_notes,
  shipment_id, shipment_ref, amazon_shipment_id,
  due_date, shipment_status, destination_fc,
  tracking_numbers: [{ link_id, tracking_id, tracking_number, carrier, status_category }],
  condition, shipment_ids[]
}
```

**Status Sort Order:**
1. READY_TO_GO
2. PACKING
3. PLANNED
4. OUT_OF_STOCK
5. LABEL_ASSIGNED
6. SHIPPED

**Selection System:**
- Tracks `selectedIds` (Set<number>)
- Emits events: `fba-board-selection`, `fba-board-selection-count`
- Listens: `fba-board-toggle-all`, `fba-board-select-by-day`, `fba-board-select-by-fnsku`, `fba-board-deselect-item`

---

## FBA Sidebar (`src/components/fba/sidebar/FbaSidebar.tsx`)

**Responsibilities:**
- Staff selector (StaffSelector component)
- Plan queue display (FbaPlanQueueItem list)
- Selection counts and metadata
- Tab switching (combine/shipped)
- FNSKU quick-add modal trigger
- View dropdown

**Realtime:** Subscribes to Ably channels for `fba_shipments`, `fba_shipment_items`, `fba_shipment_tracking` table changes.

**Staff Resolution:**
```typescript
const staffIdNum = staffIdFromUrl ?? staffDirectory[0]?.id ?? null;
// Uses cached staff directory — no green flash on load
```

---

## FBA FNSKU Checklist (`src/components/fba/FbaFnskuChecklist.tsx`)

**Purpose:** Manages item plans (daily shipment schedules), selection, and printing.

**Key Concepts:**
- **Plan:** A shipment scheduled for a specific date
- **Print Queue:** Items in PACKING/READY_TO_GO/LABEL_ASSIGNED/SHIPPED status
- **Checklist View:** Shows items NOT in print queue (PLANNED status)

**PlanItem:**
```typescript
{
  id, fnsku, display_title, product_title, asin, sku,
  expected_qty, status, notes,
  ready_by_staff_id, ready_by_name,
  verified_by_staff_id, verified_by_name
}
```

**Selection Persistence:** localStorage key `fba-plan-checklist-selection:{planId}`

**Staff Theme Pills:**
```typescript
staffRolePillClass(staffId, displayName) {
  // Resolves staff ID from staffId or name → getStaffThemeById → Tailwind classes
  const resolvedId = staffId ?? getStaffIdByName(displayName);
  const theme = getStaffThemeById(resolvedId);
  const c = stationThemeColors[theme];
  return `${c.light} ${c.text} border ${c.border}`;
}
```

---

## FBA Station Input (`src/components/fba/StationFbaInput.tsx`)

**Purpose:** Bulk FNSKU scanning interface for pack stations.

**Modes:**
1. **Scan Mode** — matches FNSKUs against today's plan
2. **Select Mode** — picks items by FNSKU from board

**Quantity Logic:**
- `normalizeFnsku()` — strips whitespace, uppercase, removes non-alphanumerics
- `todayShipmentQtyByFnskuFromJson()` — parses expected quantities
- Repeat scan of found item → don't add qty (use stepper)
- Paste/bulk scan → sum quantities
- New FNSKU → catalog-found starts at 0, unknown starts at 1
- Max: 9999 per item

---

## FBA Workspace Context (`src/contexts/FbaWorkspaceContext.tsx`)

**State:**
```typescript
{
  selection: {
    ownerId: string | null,
    selectedItems: FbaBoardItem[],
    planIds: number[],
    shipmentIds: number[],
    readyCount, pendingCount, needsPrintCount,
    activePlanId: number | null
  },
  trackingByPlan: Record<number, { amazon: string, ups: string }>,
  clearSelectionVersion: number
}
```

**Methods:**
- `setSelection(ownerId, payload)` — set active selection, auto-populate tracking
- `clearSelection(ownerId?)` — clear (owner-guarded)
- `patchTracking(planId, patch)` — update tracking numbers for a plan

---

## API Endpoints

### Scan Item: `POST /api/fba/items/scan`

**Request:**
```json
{ "fnsku": "X0ABCD1234", "staff_id": 5, "station": "PACK_STATION" }
```

**Transaction Flow:**
1. Normalize and validate FNSKU (trim, uppercase, alphanumeric-only)
2. Verify staff exists
3. Upsert FNSKU into `fba_fnskus` catalog (stub if new)
4. Find open `fba_shipment_items`:
   ```sql
   SELECT fsi.*, fs.shipment_ref
   FROM fba_shipment_items fsi
   JOIN fba_shipments fs ON fs.id = fsi.shipment_id
   WHERE fsi.fnsku = $1
     AND fs.status != 'SHIPPED'
     AND fsi.status != 'SHIPPED'
   ORDER BY
     CASE fsi.status WHEN 'PACKING' THEN 1 WHEN 'PLANNED' THEN 2
       WHEN 'READY_TO_GO' THEN 3 ELSE 4 END,
     fs.created_at ASC
   LIMIT 1
   ```
5. If item found:
   - Increment `actual_qty + 1`
   - Transition PLANNED/PACKING → READY_TO_GO
   - Set `verified_by_staff_id` (idempotent)
   - Update shipment counters
6. INSERT `fba_fnsku_logs` (PACK/READY event)
7. INSERT `station_activity_logs`
8. Calculate lifecycle summary

**Response:**
```json
{
  "success": true,
  "fnsku": "X0ABCD1234",
  "fnsku_log_id": 456,
  "product_title": "...", "asin": "...", "sku": "...",
  "shipment_ref": "FBA-03/28/26",
  "actual_qty": 3, "expected_qty": 5,
  "status": "READY_TO_GO",
  "is_new": false,
  "summary": {
    "tech_scanned_qty": 5, "pack_ready_qty": 3,
    "shipped_qty": 0, "available_to_ship": 3
  }
}
```

---

### Mark Ready: `POST /api/fba/items/ready`

**Request:**
```json
{ "shipment_id": 10, "fnsku": "X0ABCD1234", "staff_id": 2, "station": "TECH" }
```

**Flow (Tech marks item ready):**
1. Validate inputs and staff
2. Verify shipment exists and not SHIPPED
3. Upsert `fba_shipment_items`:
   - Existing: increment `actual_qty`, transition PLANNED → READY_TO_GO
   - New: create with `actual_qty=1, status=READY_TO_GO`
   - Set `ready_by_staff_id`, `ready_at` (idempotent — COALESCE, won't overwrite)
4. INSERT `fba_fnsku_logs` (PACK/READY)
5. INSERT `station_activity_logs`
6. Roll up shipment counters
7. Advance shipment status: PLANNED → READY_TO_GO if no PLANNED items remain

---

### Verify Item: `POST /api/fba/items/verify`

**Request:**
```json
{ "shipment_id": 10, "fnsku": "X0ABCD1234", "staff_id": 4 }
```

**Flow (Packer confirms item):**
1. Find item by shipment_id + fnsku
2. Verify status NOT PLANNED or SHIPPED
3. UPDATE `verified_by_staff_id`, `verified_at` (idempotent — COALESCE)
4. INSERT `fba_fnsku_logs` (PACK/VERIFIED, quantity=0)
5. Does NOT change status enum

---

### List Shipments: `GET /api/fba/shipments`

**Parameters:** status (comma-separated), q (search), limit (100), offset

**Response:**
```json
{
  "shipments": [{
    "id": 10,
    "shipment_ref": "FBA-03/28/26",
    "amazon_shipment_id": "FBA17ABC123",
    "destination_fc": "PHX7",
    "due_date": "2026-03-28",
    "status": "READY_TO_GO",
    "total_items": 5, "ready_items": 3, "shipped_items": 0,
    "total_expected_qty": 50, "total_actual_qty": 30,
    "tracking_numbers": [{ "tracking_number": "...", "carrier": "UPS", "is_delivered": false }],
    "assigned_tech_name": "Michael",
    "assigned_packer_name": "Thuy"
  }]
}
```

---

### Create Shipment: `POST /api/fba/shipments`

**Request:**
```json
{
  "shipment_ref": "FBA-03/28/26",
  "destination_fc": "PHX7",
  "due_date": "2026-03-28",
  "created_by_staff_id": 1,
  "assigned_tech_id": 2,
  "assigned_packer_id": 5,
  "items": [
    { "fnsku": "X0ABCD1234", "expected_qty": 10, "product_title": "...", "asin": "...", "sku": "..." }
  ]
}
```

**Flow:**
1. Normalize inputs (due_date defaults to today)
2. Auto-generate shipment_ref if missing: `FBA-MM/DD/YY`
3. INSERT `fba_shipments` row
4. Create/update `work_assignments` for QA
5. For each item:
   - Upsert `fba_fnskus` catalog
   - INSERT/UPDATE `fba_shipment_items`

---

### Close Shipment: `POST /api/fba/shipments/close`

**Request:**
```json
{ "shipment_id": 10, "staff_id": 1, "force": false }
```

**Flow:**
1. Verify staff and shipment
2. If not `force`: block if any items still PLANNED
3. Transition ALL non-SHIPPED items → SHIPPED
4. Set `shipped_by_staff_id`, `shipped_at` on each item
5. For each shipped item:
   - INSERT `fba_fnsku_logs` (SHIP/SHIPPED)
6. UPDATE `fba_shipments`: status=SHIPPED, shipped_at=NOW()
7. Refresh all counters

---

## FBA Log Creation (`src/lib/fba/createFbaLog.ts`)

Single entry point for all `fba_fnsku_logs` inserts:

```typescript
createFbaLog(db, {
  fnsku: string,
  sourceStage: 'TECH' | 'PACK' | 'SHIP' | 'ADMIN',
  eventType: 'SCANNED' | 'READY' | 'VERIFIED' | 'BOXED' | 'ASSIGNED' | 'SHIPPED' | 'UNASSIGNED' | 'VOID' | 'LABEL_ASSIGNED' | 'PACKER_VERIFIED',
  staffId: number | null,
  stationActivityLogId?: number | null,
  fbaShipmentId?: number | null,
  fbaShipmentItemId?: number | null,
  quantity?: number,  // default 1
  station?: string | null,
  notes?: string | null,
  metadata?: Record<string, unknown>
})
```

---

## FBA Item Status Flow

```
PLANNED ──→ PACKING ──→ READY_TO_GO ──→ LABEL_ASSIGNED ──→ SHIPPED
                              │
                        (can be verified — not a status change,
                         just sets verified_by_staff_id)
```

**Status Priority in Scan Matching:**
PACKING > PLANNED > READY_TO_GO > LABEL_ASSIGNED

**Shipment Status Advancement:**
- PLANNED → READY_TO_GO: when no items remain PLANNED
- READY_TO_GO → SHIPPED: when close endpoint called

---

## Custom Events (`src/lib/fba/events.ts`)

### Board Selection Events
```
fba-board-selection              — selected items payload
fba-board-selection-count        — count + metadata
fba-board-toggle-all             — select/deselect all
fba-board-select-by-day          — filter by due_date
fba-board-select-by-fnsku        — select specific FNSKU
fba-board-fnsku-select-result    — result of FNSKU selection
fba-board-deselect-item          — deselect single item
fba-board-deselect-by-day        — deselect day group
```

### Plan Lifecycle Events
```
fba-plan-created                 — new plan created
fba-print-focus-plan             — focus specific plan
fba-print-queue-refresh          — refresh print queue
fba-print-shipped                — plan shipped
fba-print-sidebar-ready          — sidebar initialized
```

### Catalog Events
```
fba-open-quick-add-fnsku         — open quick-add modal
fba-fnsku-saved                  — FNSKU saved to catalog (FBA_FNSKU_SAVED_EVENT)
```

### Global Events
```
usav-refresh-data                — global data refresh
dashboard-refresh                — dashboard-specific refresh
fba-fnsku-station-scanned        — FNSKU scanned at station (from tech)
```

---

## Realtime (Ably Channels)

FBA components subscribe to:
- `public.fba_shipments` — shipment INSERT/UPDATE
- `public.fba_shipment_items` — item INSERT/UPDATE
- `public.fba_shipment_tracking` — tracking INSERT/UPDATE

---

## Database Tables

| Table | Operation | Purpose |
|-------|-----------|---------|
| `fba_fnskus` | Read, Upsert | FNSKU catalog (fnsku PK, product_title, asin, sku, isActive) |
| `fba_shipments` | Insert, Update | Shipment plans (status, counters, staff assignments) |
| `fba_shipment_items` | Insert, Update | Items in shipments (expected_qty, actual_qty, status lifecycle) |
| `fba_fnsku_logs` | Insert | Immutable lifecycle event log (source_stage, event_type, quantity) |
| `station_activity_logs` | Insert | Central audit trail (links to fba_fnsku_logs via FK) |
| `work_assignments` | Insert, Update | QA assignments for shipments |
| `staff` | Read | Staff validation |

---

## Complete FBA Flow

```
1. CREATE SHIPMENT
   ├─ POST /api/fba/shipments
   ├─ INSERT fba_shipments (status=PLANNED)
   ├─ INSERT fba_shipment_items (status=PLANNED, expected_qty per FNSKU)
   └─ Upsert fba_fnskus catalog entries

2. TECH SCANS FNSKUs
   ├─ POST /api/tech/scan { type: 'FNSKU', value: 'X0ABCD1234' }
   ├─ Find open fba_shipment_items for FNSKU
   ├─ INSERT station_activity_logs (FNSKU_SCANNED)
   ├─ INSERT fba_fnsku_logs (TECH/SCANNED)
   └─ Return lifecycle summary

3. TECH MARKS READY
   ├─ POST /api/fba/items/ready { shipment_id, fnsku }
   ├─ UPDATE fba_shipment_items (PLANNED → READY_TO_GO)
   ├─ Set ready_by_staff_id, ready_at
   ├─ INSERT fba_fnsku_logs (PACK/READY)
   └─ Roll up shipment counters

4. PACKER SCANS AT PACK STATION
   ├─ POST /api/fba/items/scan { fnsku, station: 'PACK_STATION' }
   ├─ Increment actual_qty
   ├─ Transition to READY_TO_GO if PLANNED/PACKING
   ├─ INSERT fba_fnsku_logs (PACK/READY)
   └─ Update shipment counters

5. PACKER VERIFIES
   ├─ POST /api/fba/items/verify { shipment_id, fnsku }
   ├─ Set verified_by_staff_id, verified_at (idempotent)
   ├─ INSERT fba_fnsku_logs (PACK/VERIFIED, qty=0)
   └─ Status unchanged (just logging)

6. SHIPMENT AUTO-ADVANCES
   └─ When no PLANNED items remain → shipment status = READY_TO_GO

7. CLOSE SHIPMENT
   ├─ POST /api/fba/shipments/close { shipment_id }
   ├─ Transition all items → SHIPPED
   ├─ For each: INSERT fba_fnsku_logs (SHIP/SHIPPED)
   ├─ UPDATE fba_shipments (status=SHIPPED, shipped_at)
   └─ Refresh all counters

8. LIFECYCLE QUERY
   └─ Any time: SELECT SUM(quantity) FROM fba_fnsku_logs GROUP BY source_stage, event_type
      → tech_scanned_qty, pack_ready_qty, shipped_qty, available_to_ship
```

---

## Error Handling

| Error | Status | Cause |
|-------|--------|-------|
| Invalid FNSKU format | 400 | Empty or non-alphanumeric after normalization |
| Staff not found | 404 | Invalid staff_id |
| Shipment not found | 404 | Invalid shipment_id |
| Shipment already SHIPPED | 400 | Cannot modify shipped shipment |
| Items still PLANNED (close) | 400 | Must use force=true or ready all items first |
| Item status invalid for verify | 400 | Cannot verify PLANNED or SHIPPED items |
| Transaction failure | 500 | DB error with ROLLBACK |
