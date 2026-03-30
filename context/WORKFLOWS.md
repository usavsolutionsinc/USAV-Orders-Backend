# Business Workflows

## Order Lifecycle (Tech -> Packer -> Shipped)

### 1. Order Creation
- Imported from eBay, Ecwid, Zoho, Google Sheets, or manually added
- Stored in `orders` table with SKU, quantity, tracking reference
- Linked to `shipping_tracking_numbers` via `shipmentId`

### 2. Tech Station (`/tech/[id]`)
- Tech scans carrier tracking number -> resolves to `shipping_tracking_numbers`
- Scans FNSKU -> creates `fba_fnsku_logs` + `station_activity_logs`
- Adds serial numbers -> `tech_serial_numbers` with `contextStationActivityLogId` FK
- Can undo/delete scans with cascading cleanup
- Unmatched scans stored in `orders_exceptions`
- Entry point: `POST /api/tech/scan` (unified) or legacy per-type endpoints

### 3. Packing Station (`/packer/[id]`)
- Packer scans orders/FNSKUs -> logged in `packer_logs`
- Can upload photos -> stored in `photos` table
- Marks as shipped -> updates order status, sets `is_shipped = true`
- Batch ship available via management UI

### 4. Dashboard (`/dashboard`)
- Shows all orders with filters (all, unassigned, assigned, need to order)
- Assignment UI: assign tech + packer per order or bulk
- Quick-assign: "Assign Left Unassigned" button for remaining orders
- Details panel shows order info, tracking, serial numbers

---

## FBA Workflow (`/fba`)

### 1. Plan Creation
- Create FBA shipment plan -> `fba_shipments` (PLANNED status)
- Add FNSKUs to plan -> `fba_shipment_items` (PLANNED status)

### 2. Tech Processing
- Tech scans FNSKUs at station -> item moves to READY_TO_GO
- Logged in `fba_fnsku_logs` with `source_stage = 'TECH'`
- Creates `station_activity_logs` entry

### 3. Packer Verification
- Packer verifies & labels items -> moves to BOXED
- Logged with `source_stage = 'PACK'`

### 4. Shipment Closing
- Ship coordinator closes shipment -> status = SHIPPED
- All items marked SHIPPED
- Tracking entered for the FBA shipment

### Board View
- Kanban board at `/fba` shows pending items by week
- Sidebar: staff selector, workspace scan field, plan management
- Theming: each staff member has a unique color theme

---

## Receiving Workflow (`/receiving`)

### 1. Inbound Package Arrival
- Tracking scanned -> `receiving` row created
- Matched to Zoho PO via `receiving_lines`
- Zoho sync pre-stages expected line items

### 2. Line Item Processing
Status progression:
```
EXPECTED -> ARRIVED -> MATCHED -> UNBOXED -> AWAITING_TEST -> IN_TEST -> PASSED/FAILED -> DONE
```

### 3. QA & Disposition
- Each `receiving_line` has QA status: PENDING, PASSED, FAILED_DAMAGED, FAILED_INCOMPLETE, FAILED_FUNCTIONAL, HOLD
- Disposition codes: ACCEPT, HOLD, RTV, SCRAP, REWORK
- Assigned to tech via `work_assignments` (entity_type='RECEIVING')
- Disposition changes logged in `dispositionAudit` (JSONB)

### 4. Final Disposition
- ACCEPTED: goes to stock or FBA
- RTV/SCRAP: logged and removed from inventory

---

## Repair Service Workflow (`/repair`)

### 1. Intake (`POST /api/repair-service/start`)
- Customer info captured (name, phone, email)
- Product and issue selected (from favorites or custom)
- Intake form signed -> signature stored in `documents` table
- Ticket number generated

### 2. Service
- Technician pulls next ticket from queue
- Performs repair, documents outcome
- Marks REPAIRED or OUT_OF_STOCK

### 3. Return
- Customer pickup or ship-back
- Status updated, ticket closed

---

## Work Assignments (`/work-orders`)

Unified assignment system across all entity types:
- `work_assignments.entity_type`: ORDER, REPAIR, FBA_SHIPMENT, RECEIVING, SKU_STOCK
- `work_assignments.work_type`: TEST, PACK, REPAIR, QA, RECEIVE, STOCK_REPLENISH
- Status: OPEN -> ASSIGNED -> IN_PROGRESS -> DONE or CANCELED
- Dashboard at `/work-orders` for managers

---

## Staff System

### Staff Directory
- 8 staff members: Michael(1), Thuc(2), Sang(3), Tuan(4), Thuy(5), Cuong(6), Kai(7), Lien(8)
- Roles: technician, packer, receiving, sales
- Constants in `src/utils/staff.ts`

### Tech IDs (display order): [1, 2, 3, 6] (Michael, Thuc, Sang, Cuong)
### Packer IDs (display order): [4, 5] (Tuan, Thuy)
### Default bulk assign: Cuong (tech=6) + Thuy (packer=5)

### Staff Theming
Each staff member has a unique color theme (defined in `src/utils/staff-colors.ts`):
- Michael(1)=green, Thuc(2)=blue, Sang(3)=purple, Tuan(4)=black
- Thuy(5)=red, Cuong(6)=yellow, Kai(7)=lightblue, Lien(8)=pink

Theme resolution: `getStaffThemeById(staffId)` -> StationTheme string -> Tailwind classes via `stationThemeColors[theme]`

### Staff Cache
- `src/lib/staffCache.ts` — singleton cache, one fetch per page load
- `useActiveStaffDirectory()` hook wraps the cache
- `getPresentStaffForToday()` — schedule-aware variant

---

## Integration Syncs

### eBay
- Hourly token refresh via QStash
- Order sync: exceptions-first, then bulk
- Multi-account support via `ebay_accounts` table

### Zoho Inventory
- Sales orders, packages, shipments import
- Item/SKU master data sync
- Purchase order creation and receipt matching
- OAuth auto-refresh

### Google Sheets
- Transfer orders sync 3x daily (8:30 AM, 10 AM, 2 PM PST)
- Apps Script Web App for data entry
- Service account auth

### Shipping Carriers
- UPS, FedEx, USPS tracking integration
- 2-hourly sync via QStash
- Webhook receivers for real-time updates
- Carrier detection in `src/lib/shipping/resolve.ts`

### Ecwid/Square
- Product catalog sync
- Order import
- Repair payment links via Square
