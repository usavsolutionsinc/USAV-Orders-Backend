# Database Schema & Access

## Engine
PostgreSQL (Neon serverless) with connection pooling.

## Access Methods

### 1. Drizzle ORM
- Schema: `src/lib/drizzle/schema.ts` (~49KB, 50+ tables)
- Client: `src/lib/drizzle/db.ts`
- Migrations: `drizzle-kit generate` / `drizzle-kit push`
- Config: `drizzle.config.ts`
- Inferred types: `Order`, `NewOrder`, `Staff`, etc.

### 2. Raw pg Pool
- Client: `src/lib/db.ts` (default export `pool`)
- Enhanced: `src/lib/neon-client.ts` — `query<T>`, `queryOne<T>`, `queryCount`, `transaction()`
- Tagged-template SQL for complex joins and aggregations

## Core Tables

### Orders & Fulfillment

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `orders` | Fulfillment lifecycle | id, orderId, shipmentId→shipping_tracking_numbers, status, sku, condition, quantity |
| `shipping_tracking_numbers` | Carrier tracking | id, trackingNumber, carrier, isShipped, syncedAt |
| `tech_serial_numbers` | Serial test records | id, serialNumber, serialType, testedBy→staff, contextStationActivityLogId→SAL |
| `packer_logs` | Packing history | id, shipmentId, scanRef, trackingType, packedBy→staff |
| `station_activity_logs` | Central event ledger | id, station, activityType, shipmentId, fnsku, staffId, metadata (JSON) |
| `orders_exceptions` | Unmatched scans | id, shippingTrackingNumber, sourceStation, exceptionReason, status |

### Staff & Assignments

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `staff` | Employees | id, name, role, employeeId, active |
| `work_assignments` | Assignment queue | id, entityType (enum), entityId, workType (enum), assignedTechId, status, deadlineAt |

### FBA (Amazon)

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `fba_fnskus` | FBA catalog | fnsku (PK), productTitle, asin, sku, isActive |
| `fba_shipments` | Shipment plans | id, shipmentRef, amazonShipmentId, status, assignedTechId, assignedPackerId |
| `fba_shipment_items` | Items in shipments | id, shipmentId (FK), fnsku (FK), expectedQty, actualQty, status |
| `fba_fnsku_logs` | FNSKU lifecycle events | id, fnsku, sourceStage, eventType, staffId, stationActivityLogId→SAL |

### Receiving

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `receiving` | Inbound packages | id, receivingTrackingNumber, carrier, qaStatus, dispositionCode, assignedTechId |
| `receiving_lines` | Line items | id, receivingId (FK), zohoItemId, sku, quantityReceived, workflowStatus |

### Repair

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `repair_service` | Repair tickets | id, ticketNumber, productTitle, issue, serialNumber, status, statusHistory |

### Inventory & Integrations

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `items` | Zoho inventory items | id, zohoItemId, sku, upc, quantityAvailable |
| `zoho_locations` | Warehouse locations | id, zohoLocationId, name, isPrimary |
| `item_location_stock` | Stock by location | id, itemId (FK), locationId (FK), quantityAvailable |
| `sales_orders` | Zoho sales orders | id, zohoSoId, referenceNumber, channel, status, lineItems (JSONB) |
| `ebay_accounts` | eBay auth tokens | id, accountName, accessToken, refreshToken, tokenExpiresAt |
| `customers` | Order customers | id, zohoContactId, email, phone, shippingAddress |
| `replenishment_requests` | Stock replenishment | id, itemId, sku, quantityNeeded, status |

### Support Tables

| Table | Purpose |
|-------|---------|
| `photos` | Polymorphic photos (entityType + entityId) |
| `documents` | Signed agreements (signatures) |
| `sync_cursors` | Incremental sync state per resource |

## Enums

```sql
qa_status_enum:          PENDING, PASSED, FAILED_DAMAGED, FAILED_INCOMPLETE, FAILED_FUNCTIONAL, HOLD
disposition_enum:        ACCEPT, HOLD, RTV, SCRAP, REWORK
condition_grade_enum:    BRAND_NEW, USED_A, USED_B, USED_C, PARTS
work_entity_type_enum:   ORDER, REPAIR, FBA_SHIPMENT, RECEIVING, SKU_STOCK
work_type_enum:          TEST, PACK, REPAIR, QA, RECEIVE, STOCK_REPLENISH
assignment_status_enum:  OPEN, ASSIGNED, IN_PROGRESS, DONE, CANCELED
inbound_workflow_status: EXPECTED, ARRIVED, MATCHED, UNBOXED, AWAITING_TEST, IN_TEST, PASSED, FAILED, RTV, SCRAP, DONE
```

## Caching Layer

### In-Memory (`src/lib/cache.ts`)
- TTL-based (default 5 min), keyed by domain + id
- Domains: 'order', 'staff', 'sku', 'shipping', 'fba-shipment'
- Window events for cross-component invalidation

### Upstash Redis (`src/lib/cache/upstash-cache.ts`)
- Distributed cache for multi-instance deployments
- TTL: 1 hour (staff), 30 min (goals)

### Staff Cache (`src/lib/staffCache.ts`)
- Module-level singleton: one fetch per page load
- `getActiveStaff()` — all active staff
- `getPresentStaffForToday()` — staff scheduled today
- `invalidateStaffCache()` — reset after mutations

## Incremental Sync Pattern
`sync_cursors` table tracks `lastSyncedAt` per resource type. Used by eBay, Zoho, and shipping sync jobs to avoid full re-fetches.
