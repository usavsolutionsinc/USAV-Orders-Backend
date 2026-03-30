# API Routes Reference

60+ API route groups organized by domain. All under `src/app/api/`.

## Orders & Fulfillment (`/api/orders/*`)

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/orders/add` | Create order from external source |
| POST | `/api/orders/assign` | Assign order to tech/packer |
| POST | `/api/orders/start` | Mark order as in-progress |
| POST | `/api/orders/verify` | Verify order details |
| POST | `/api/orders/skip` | Skip order in queue |
| POST | `/api/orders/check-shipped` | Check if shipped |
| POST | `/api/orders/delete` | Remove order |
| GET | `/api/orders/next` | Get next unassigned order for a tech |
| GET | `/api/orders/recent` | Fetch recent orders |
| GET | `/api/orders/integrity-check` | Audit data consistency |

## Tech Station (`/api/tech/*`)

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/tech/scan` | Unified scan (TRACKING/FNSKU/SKU/REPAIR) |
| POST | `/api/tech/scan-tracking` | Legacy tracking scan |
| POST | `/api/tech/scan-fnsku` | FNSKU scan |
| POST | `/api/tech/scan-sku` | SKU scan |
| POST | `/api/tech/scan-repair-station` | Repair scan |
| POST | `/api/tech/serial` | Add/remove/update serials |
| POST | `/api/tech/add-serial` | Legacy serial add |
| POST | `/api/tech/update-serials` | Bulk serial update |
| POST | `/api/tech/undo-last` | Undo last action |
| POST | `/api/tech/delete` | Delete scan + cascade |
| POST | `/api/tech/delete-tracking` | Delete tracking scan |
| GET | `/api/tech/logs` | Tech session logs |
| GET | `/api/tech/orders-without-manual` | Orders needing manual lookup |

## Packing (`/api/packing-logs/*`)

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/packing-logs/start-session` | Start packing session |
| POST | `/api/packing-logs/update` | Log packing action |
| POST | `/api/packing-logs/save-photo` | Save packing photo |
| GET | `/api/packing-logs/details` | Session details |
| GET | `/api/packing-logs/photos` | Session photos |
| GET | `/api/packerlogs` | Packer log history |

## Shipped Orders (`/api/shipped/*`)

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/shipped` | List shipped orders |
| POST | `/api/shipped/submit` | Mark order shipped |
| GET | `/api/shipped/[id]` | Shipped order details |
| GET | `/api/shipped/search` | Search shipped |
| GET | `/api/shipped/lookup-order` | Find by order ID |
| GET | `/api/shipped/debug` | Debug shipping state |

## FBA / Amazon (`/api/fba/*`)

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/fba/fnskus/search` | Search FNSKUs |
| POST | `/api/fba/fnskus/validate` | Validate FNSKU |
| POST | `/api/fba/fnskus/bulk` | Bulk FNSKU operations |
| GET | `/api/fba/items/queue` | Item queue |
| POST | `/api/fba/items/scan` | Scan item |
| POST | `/api/fba/items/ready` | Mark ready |
| POST | `/api/fba/items/verify` | Verify item |
| POST | `/api/fba/labels/bind` | Bind label to item |
| GET | `/api/fba/shipments` | List shipments |
| POST | `/api/fba/shipments/close` | Close shipment |
| POST | `/api/fba/shipments/mark-shipped` | Mark as shipped |
| GET | `/api/fba/shipments/today` | Today's shipments |
| GET | `/api/fba/shipments/[id]/items` | Shipment items |
| GET | `/api/fba/board` | Kanban board state |
| GET | `/api/fba/stage-counts` | Count by stage |
| GET | `/api/fba/logs` | FNSKU event logs |
| POST | `/api/fba/print-queue` | Add to print queue |

## Receiving (`/api/receiving*`)

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/receiving-entry` | Start receiving entry |
| GET | `/api/receiving` | Match shipments |
| GET | `/api/receiving/pending-unboxing` | Unboxed items |
| POST | `/api/receiving-lines` | Line item operations |
| GET | `/api/receiving-logs/search` | Search receiving history |
| GET | `/api/receiving-photos` | Receiving photos |
| GET | `/api/receiving-tasks` | Task list |

## Repair Service (`/api/repair*`)

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/repair-service/start` | Start repair intake |
| POST | `/api/repair-service/next` | Get next repair |
| POST | `/api/repair-service/repaired` | Mark repaired |
| GET | `/api/repair-service/[id]` | Repair details |
| GET | `/api/repair-service/out-of-stock` | OOS repairs |
| POST | `/api/repair/submit` | Submit repair (external) |
| POST | `/api/repair/search` | Search repairs |

## Staff & Assignments

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/staff` | Staff list (supports `?active=true`, `?role=`, `?presentToday=true`) |
| GET | `/api/staff/schedule` | Weekly schedule |
| GET | `/api/staff-goals` | Performance metrics |
| GET | `/api/assignments/next` | Next assignment |
| GET | `/api/assignments/sku-search` | SKU search for assignment |

## Integration Syncs (QStash Scheduled)

| Route | Schedule | Purpose |
|-------|----------|---------|
| `POST /api/qstash/shipping/sync-due` | Every 2 hours | Carrier tracking sync |
| `POST /api/qstash/ebay/refresh-tokens` | Hourly | eBay token refresh |
| `POST /api/qstash/ebay/sync` | Periodic | eBay order sync |
| `POST /api/qstash/google-sheets/transfer-orders` | 3x daily (8:30 AM, 10 AM, 2 PM PST) | Google Sheets sync |
| `POST /api/qstash/zoho/orders/ingest` | Periodic | Zoho order sync |
| `POST /api/qstash/replenishment/sync` | Periodic | Stock replenishment |
| `POST /api/qstash/schedules/bootstrap` | Manual (after deploy) | Register all schedules |

## External Integration APIs

| Route Group | Purpose |
|-------------|---------|
| `/api/ebay/*` | eBay accounts, token refresh, order search/sync |
| `/api/ecwid/*` | Ecwid products, search, sync |
| `/api/zoho/*` | Zoho health, OAuth, items, orders, PO/PReceive |
| `/api/google-sheets/*` | Google Sheets append, transfer orders |
| `/api/shipping/*` | UPS, FedEx, USPS tracking |

## Realtime & Webhooks

| Route | Purpose |
|-------|---------|
| `GET /api/realtime/token` | Ably auth token endpoint |
| `POST /api/webhooks/realtime-db` | DB change webhook receiver |
| `POST /api/webhooks/ups` | UPS tracking webhook |

## Utilities

| Route | Purpose |
|-------|---------|
| `GET /api/db/ping` | Database health check |
| `POST /api/setup-db` | Initialize schema |
| `POST /api/drizzle-setup` | Drizzle setup |
| `POST /api/diagnose-migration` | Migration diagnostics |
| `GET /api/get-title-by-sku` | SKU title lookup |
