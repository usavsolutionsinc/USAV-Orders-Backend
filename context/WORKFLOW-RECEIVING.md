# Receiving Workflow — Complete Flow

## Overview
Receiving handles inbound packages from vendors (purchase orders) and customer returns. Items flow through: scan tracking → auto-match Zoho PO → unbox & classify → QA → disposition.

---

## Receiving Page (`src/app/receiving/page.tsx`)
Simple wrapper rendering `ReceivingDashboard` in a gradient background.

---

## Receiving Modes

### Mode 1: Bulk Scan (`Mode1BulkScan.tsx`)
**Purpose:** Rapid barcode scanning of incoming packages.

**Flow:**
1. Barcode input with auto-focus management
2. Scan tracking number → POST `/api/receiving-entry`
3. Flash success/error feedback
4. Recent scans list (localStorage cached)
5. Fire-and-forget Zoho enrichment

**Events:**
- `receiving-entry-added` — new entry added
- `receiving-focus-scan` — focus input

### Mode 2: Unboxing (`Mode2Unboxing.tsx`)
**Purpose:** Classification panel for pending entries.

**Queue:** Items with `qa_status = 'PENDING'`

**Classification Fields:**
- Package type: Purchase Order or Return
- Return fields: platform (AMZ, EBAY_DRAGONH, EBAY_USAV, EBAY_MK, FBA, WALMART, ECWID), reason
- Condition grade: BRAND_NEW, USED_A, USED_B, USED_C, PARTS
- QA status: PENDING, PASSED, FAILED_DAMAGED, FAILED_INCOMPLETE, FAILED_FUNCTIONAL, HOLD
- Disposition: ACCEPT, HOLD, RTV, SCRAP, REWORK
- Needs testing + technician assignment
- Target channel: ORDERS or FBA
- Zoho confirmation checkbox
- Photo grid (realtime polling from mobile app)

**On Confirm:** PATCH `/api/receiving-logs` with classification data

### Mode 3: Local Pickup (`Mode3LocalPickup.tsx`)
**Purpose:** Receiving items from local vendors/pickups.

**Flow:**
1. Search products by title/SKU (GET `/api/sku-stock`)
2. Select item, enter quantity
3. Generate synthetic tracking: `LOCAL-{sku}-{timestamp}`
4. POST `/api/receiving-entry` + `/api/local-pickups`
5. Condition selection + received-by staff selector

### Zoho PO Manager (`ZohoPOManager.tsx`)
**Purpose:** Match received items to Zoho Purchase Orders.

**Layout:**
- Left: PO list with status filter (issued, paid) + search
- Right: PO detail with line items

**Flow:**
1. Browse/search Zoho POs
2. Select PO → view line items
3. Enter `quantity_received` + `condition_grade` per line
4. Submit to `/api/zoho/purchase-orders/receive`
5. Creates receiving_lines from PO data

### Zoho Inbound Status Banner (`ZohoInboundStatusBanner.tsx`)
- Displays Zoho health (circuit breaker state)
- Shows limiter reservoir, queue size, active count
- Manual sync button: POST `/api/zoho/purchase-orders/sync`
- Color: teal=healthy, amber=circuit open

---

## API Endpoints

### Create Receiving Entry: `POST /api/receiving-entry`

**Request:**
```json
{
  "trackingNumber": "1Z999AA10123456784",
  "carrier": "UPS",                        // optional — auto-detected
  "conditionGrade": "BRAND_NEW",            // optional
  "qaStatus": "PENDING",                    // default PENDING
  "dispositionCode": "HOLD",               // optional
  "isReturn": false,                        // default false
  "returnPlatform": null,                   // AMZ, EBAY_DRAGONH, EBAY_USAV, EBAY_MK, FBA, WALMART, ECWID
  "returnReason": null,
  "needsTest": true,                        // default true
  "assignedTechId": null,
  "targetChannel": null,                    // ORDERS or FBA
  "zohoPurchaseReceiveId": null,
  "zohoWarehouseId": null
}
```

**Flow:**

**Step 1: Parse & Validate**
- Trim and validate tracking number
- Detect carrier from tracking if not provided (uses same carrier detection as shipping)
- Resolve receiving table schema (dynamic column support)

**Step 2: Insert Receiving**
```sql
INSERT INTO receiving (
  receiving_tracking_number, carrier,
  condition_grade, qa_status, disposition_code,
  is_return, return_platform, return_reason,
  needs_test, assigned_tech_id,
  target_channel, zoho_purchase_receive_id, zoho_warehouse_id
) VALUES (...) RETURNING *
```

**Step 3: Zoho Auto-Match (3-tier fallback)**
Non-fatal — wrapped in try/catch so entry always succeeds.

**Tier 1:** Search local `receiving_lines` for matching `zoho_purchase_receive_id` or tracking in notes
```sql
SELECT * FROM receiving_lines
WHERE zoho_purchase_receive_id = $1
  OR notes ILIKE '%' || $trackingNumber || '%'
```
If match: UPDATE `receiving_lines.receiving_id = newReceivingId`

**Tier 2:** Search Zoho by tracking number
- Calls Zoho API to find POs containing this tracking
- If found: sync PO line items into `receiving_lines`

**Tier 3:** Search Zoho POs directly by tracking suffix
- Broader search if Tier 2 misses
- Syncs any matching PO data

**Step 4: Create Work Assignment (if needsTest)**
```sql
INSERT INTO work_assignments (
  entity_type, entity_id, work_type,
  assigned_tech_id, status, priority
) VALUES ('RECEIVING', $receivingId, 'TEST', $techId, 'ASSIGNED', 100)
```

**Step 5: Surgical Cache Update**
- Prepends new record to current week's Redis cache
- TTL: 2 minutes for current week
- Avoids full cache invalidation

**Step 6: Publish Realtime**
- `receiving-log-changed` event via Ably

**Response:**
```json
{
  "success": true,
  "record": { ... },
  "zoho_match": {
    "strategy": "tier1_local",
    "matched_lines": 3,
    "zoho_po_ids": ["PO-00123"]
  }
}
```

---

### Receiving Lines CRUD: `/api/receiving-lines`

**GET /api/receiving-lines**

**Parameters:**
- `id` — fetch single line
- `receiving_id` — fetch all lines for a package
- `limit` (200, max 500), `offset` — pagination
- `search` — search item_name, sku, zoho_purchaseorder_id
- `qa_status` — filter by QA status
- `disposition` — filter by disposition

**POST /api/receiving-lines**
```json
{
  "receiving_id": 123,                    // nullable
  "zoho_item_id": "required",
  "zoho_line_item_id": null,
  "zoho_purchase_receive_id": null,
  "zoho_purchaseorder_id": null,
  "item_name": "Widget",
  "sku": "WDG-001",
  "quantity_received": 10,
  "quantity_expected": 15,
  "qa_status": "PENDING",                // default
  "disposition_code": "HOLD",            // default
  "condition_grade": "BRAND_NEW",        // default
  "disposition_audit": [],               // JSONB array of changes
  "notes": null,
  "needs_test": true,                    // default
  "assigned_tech_id": null
}
```

**PATCH /api/receiving-lines**
```json
{
  "id": 456,                             // required
  "qa_status": "PASSED",
  "disposition_code": "ACCEPT",
  "quantity_received": 10
}
```

**Update Rules:**
- Text fields: nullable
- receiving_id: can be set to null
- quantity_received/quantity_expected: normalized to finite integers
- qa_status/disposition_code/condition_grade: must be in allowed enum sets
- needs_test: if cleared (false), still requires assigned_tech_id present
- Returns 404 if line not found

**DELETE /api/receiving-lines?id=456**

---

### List/Search Receiving: `GET /api/receiving`

**Parameters:** weekStart, weekEnd, search, qa_status, limit, offset

**Response:** Array of receiving entries with joined line item counts and Zoho match metadata.

---

## Receiving Assignment Logic (`src/lib/receiving/assignment-upsert.ts`)

**Function:** `upsertReceivingAssignment(db, params)`

**Logic:**
- If `needsTest=false` OR `assignedTechId=null`:
  ```sql
  UPDATE work_assignments
  SET status = 'CANCELED'
  WHERE entity_type = 'RECEIVING'
    AND entity_id = $receivingId
    AND work_type = 'TEST'
    AND status IN ('ASSIGNED', 'IN_PROGRESS')
  ```

- If `needsTest=true` AND `assignedTechId` present:
  - If existing assignment: UPDATE assigned_tech_id, notes
  - If none: INSERT new (entity_type='RECEIVING', work_type='TEST', status='ASSIGNED')

---

## State Transitions

### QA Status Flow
```
PENDING ──→ PASSED      (move to inventory)
       ──→ FAILED_DAMAGED     ──→ RTV/SCRAP/REWORK
       ──→ FAILED_INCOMPLETE  ──→ RTV/SCRAP/REWORK
       ──→ FAILED_FUNCTIONAL  ──→ RTV/SCRAP/REWORK
       ──→ HOLD               ──→ (awaiting decision)
```

### Disposition Flow
```
HOLD (default) ──→ ACCEPT  (move to stock or FBA)
               ──→ RTV     (return to vendor)
               ──→ SCRAP   (discard)
               ──→ REWORK  (fix and re-assess)
```

### Inbound Workflow Status (receiving_lines)
```
EXPECTED → ARRIVED → MATCHED → UNBOXED → AWAITING_TEST → IN_TEST → PASSED/FAILED → DONE
```
Each transition logged in `disposition_audit` JSONB array.

---

## Database Tables

| Table | Operation | Purpose |
|-------|-----------|---------|
| `receiving` | Insert, Update | Inbound package header (tracking, carrier, qa, disposition) |
| `receiving_lines` | Insert, Update, Delete | Line items from Zoho PO or manual entry |
| `work_assignments` | Insert, Update | TEST assignments for items needing QA |
| `station_activity_logs` | Insert | Receiving activity audit trail |
| `photos` | Insert | Receiving photos (entity_type='RECEIVING') |
| `staff` | Read | Tech assignment validation |

---

## Zoho Integration

### Auto-Match Flow
When a tracking number is scanned:
1. **Local match:** Check if receiving_lines already exist for this tracking
2. **Zoho tracking search:** Query Zoho API for POs containing this tracking number
3. **Zoho PO search:** Broader search by tracking suffix
4. If any match: sync PO line items into `receiving_lines` with `receiving_id` linked

### PO Receive Flow (from Zoho PO Manager)
1. User selects PO from Zoho list
2. Enters quantity_received per line item
3. POST `/api/zoho/purchase-orders/receive`
4. Creates receiving_lines linked to Zoho PO
5. Optionally creates receiving entry if tracking provided

---

## Caching

### Redis Cache
- Key: `api:receiving-logs:{weekKey}`
- TTL: 2 min (current week), longer for past weeks
- Surgical updates: prepend new records to existing cache (no full invalidation)

### Cache Invalidation
- On new receiving entry: prepend to current week cache
- On line item change: invalidate receiving-lines cache tag
- On QA/disposition change: invalidate specific receiving entry cache

---

## Realtime Events

### Ably
- `receiving-log-changed` — new entry or status update

### Window Events
- `receiving-entry-added` — sidebar notifies mode 1 of new entry
- `receiving-focus-scan` — focus barcode input
- `usav-refresh-data` — global refresh

---

## Complete Receiving Flow

```
1. PACKAGE ARRIVES
   ├─ Mode 1: Scan tracking number
   ├─ POST /api/receiving-entry
   ├─ INSERT receiving (qa_status=PENDING)
   └─ Auto-match to Zoho PO (3-tier, non-fatal)

2. ZOHO MATCH (if found)
   ├─ Sync PO line items → INSERT receiving_lines
   ├─ Link: receiving_lines.receiving_id = receiving.id
   └─ Pre-populate: item_name, sku, quantity_expected, zoho_purchaseorder_id

3. UNBOXING (Mode 2)
   ├─ Select pending entry from queue
   ├─ Classify: package type, condition, QA status
   ├─ Set disposition code
   ├─ Assign technician if needs testing
   ├─ PATCH /api/receiving-logs
   └─ Log change in disposition_audit JSONB

4. QA TESTING (if needs_test=true)
   ├─ work_assignment created (entity_type=RECEIVING, work_type=TEST)
   ├─ Tech assigned, status=ASSIGNED
   ├─ Tech tests → updates qa_status (PASSED/FAILED_*)
   └─ work_assignment → status=DONE

5. DISPOSITION
   ├─ ACCEPT → move to inventory (orders or FBA channel)
   │  ├─ If target_channel=ORDERS → available for fulfillment
   │  └─ If target_channel=FBA → available for FBA shipments
   │
   ├─ RTV → return to vendor
   │  └─ Logged, removed from active inventory
   │
   ├─ SCRAP → discard
   │  └─ Logged, removed from active inventory
   │
   └─ REWORK → fix and re-assess
      └─ Cycles back to QA

6. ZOHO PO MANAGER (Alternative Entry)
   ├─ Browse Zoho POs → select one
   ├─ Enter quantity_received per line
   ├─ POST /api/zoho/purchase-orders/receive
   └─ Creates receiving_lines with Zoho metadata
```

---

## Error Handling

| Error | Status | Cause |
|-------|--------|-------|
| Missing trackingNumber | 400 | Required field absent |
| Invalid qa_status/disposition/condition | 400 | Not in allowed enum |
| Receiving line not found | 404 | Invalid ID |
| Zoho API failure | 200 (non-fatal) | Zoho match is best-effort |
| Duplicate tracking | 200 | Creates entry anyway (may duplicate) |
| DB error | 500 | Transaction failure |

---

## Enums Reference

### qa_status_enum
- `PENDING` — awaiting classification
- `PASSED` — item meets quality standards
- `FAILED_DAMAGED` — physical damage
- `FAILED_INCOMPLETE` — missing parts
- `FAILED_FUNCTIONAL` — doesn't work
- `HOLD` — on hold for decision

### disposition_enum
- `ACCEPT` — add to inventory
- `HOLD` — awaiting classification (default)
- `RTV` — return to vendor
- `SCRAP` — discard
- `REWORK` — repair/fix and re-assess

### condition_grade_enum
- `BRAND_NEW` — factory sealed
- `USED_A` — like new, minor signs of use
- `USED_B` — good, noticeable wear
- `USED_C` — fair, significant wear
- `PARTS` — for parts only

### return_platform (string values)
- `AMZ` — Amazon
- `EBAY_DRAGONH` — eBay (DragonH account)
- `EBAY_USAV` — eBay (USAV account)
- `EBAY_MK` — eBay (MK account)
- `FBA` — Amazon FBA return
- `WALMART` — Walmart
- `ECWID` — Ecwid/website
