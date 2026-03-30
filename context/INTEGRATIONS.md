# External Integrations

## eBay (`src/lib/ebay/`)

### Purpose
Import eBay orders into fulfillment pipeline.

### Files
- `src/lib/ebay/token-refresh.ts` — OAuth token management
- `src/app/api/ebay/*` — Account management, search, sync endpoints
- `src/app/api/qstash/ebay/refresh-tokens` — Hourly token refresh (QStash)
- `src/app/api/qstash/ebay/sync` — Order sync job

### Data Flow
1. eBay orders fetched via API
2. Matched to existing `orders` or created as new
3. Unmatched scans stored in `orders_exceptions` for manual review
4. Multi-account via `ebay_accounts` table (accessToken, refreshToken, tokenExpiresAt)

### Auth
- OAuth 2.0 with refresh token flow
- Tokens stored in `ebay_accounts` table
- Auto-refresh hourly via QStash

### Env Vars
```
EBAY_APP_ID, EBAY_CERT_ID, EBAY_REFRESH_TOKEN_*
```

---

## Zoho Inventory (`src/lib/zoho/`)

### Purpose
Master data source for inventory items, sales orders, purchase orders.

### Files
- `src/lib/zoho/core.ts` — Base API client
- `src/lib/zoho/ZohoInventoryClient.ts` — High-level operations
- `src/lib/zoho/httpClient.ts` — HTTP transport
- `src/lib/zoho/types.ts` — Zoho data models
- `src/app/api/zoho/*` — Health, OAuth, items sync, orders ingest, PO/PReceive

### Data Flow
1. `items` table synced from Zoho item catalog
2. `sales_orders` imported with line items (JSONB)
3. Purchase orders created/matched for receiving workflow
4. Location stock tracked via `item_location_stock`
5. Customers imported as contacts

### Sync Strategy
- Incremental fetch via `sync_cursors.lastSyncedAt`
- QStash scheduled: `POST /api/qstash/zoho/orders/ingest`

### Env Vars
```
ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_ORG_ID
```

---

## Google Sheets (`src/lib/google-auth.ts`)

### Purpose
Manual order entry via Google Sheets, synced to fulfillment.

### Files
- `src/lib/google-auth.ts` — Service account authentication
- `src/app/api/google-sheets/*` — Append, transfer orders, sync
- `src/app/api/qstash/google-sheets/transfer-orders` — 3x daily sync

### Schedule
- 8:30 AM PST, 10:00 AM PST, 2:00 PM PST

### Env Vars
```
GOOGLE_PRIVATE_KEY, GOOGLE_CLIENT_EMAIL
```

---

## Shipping Carriers (`src/lib/shipping/`)

### Purpose
Track shipment status across UPS, FedEx, USPS.

### Files
- `src/lib/shipping/types.ts` — Carrier type definitions
- `src/lib/shipping/providers/ups.ts` — UPS API
- `src/lib/shipping/providers/fedex.ts` — FedEx API
- `src/lib/shipping/providers/usps.ts` — USPS TrackField API
- `src/lib/shipping/resolve.ts` — Carrier detection from tracking number
- `src/lib/shipping/sync-shipment.ts` — Sync logic
- `src/lib/shipping/normalize.ts` — Tracking normalization

### Sync
- Every 2 hours via QStash: `POST /api/qstash/shipping/sync-due`
- Webhooks: `POST /api/webhooks/ups`
- Updates `shipping_tracking_numbers.syncedAt`

### Env Vars
```
UPS_CLIENT_ID, UPS_CLIENT_SECRET
FEDEX_CLIENT_ID, FEDEX_CLIENT_SECRET
CONSUMER_KEY (USPS), CONSUMER_SECRET
```

---

## Ably Realtime (`src/lib/realtime/`)

### Purpose
Live dashboard updates without polling.

### Files
- `src/lib/realtime/ably-key.ts` — Ably API client
- `src/lib/realtime/channels.ts` — Channel name constants
- `src/lib/realtime/publish.ts` — Server-side event publishing
- `src/lib/realtime/db-events.ts` — Database changelog events
- `src/contexts/AblyContext.tsx` — React context provider
- `src/hooks/useAblyChannel.ts` — Client subscription hook
- `src/app/api/realtime/token` — Auth token endpoint

### Channels
- `orders:changes` — Order status updates
- `repair:changes` — Repair ticket updates
- `station:changes` — Station activity
- `db:schema:table` — Table-level changes
- `db:schema:table:rowId` — Row-level changes

### Events Published
- Order created/updated/assigned/completed
- Tech scan/serial added/removed
- Packing logged
- Repair intake/completion
- Station activity created

### Env Vars
```
ABLY_API_KEY
```

---

## Ecwid/Square (`src/lib/ecwid-square/`)

### Purpose
Product catalog sync and repair payment processing.

### Data Flow
- Product catalog: Ecwid <-> Square two-way sync
- Order import from Ecwid (every 15 min)
- Repair payment links generated via Square

### Env Vars
```
ECWID_STORE_ID, ECWID_API_TOKEN
SQUARE_ACCESS_TOKEN, SQUARE_LOCATION_ID
```

---

## Vercel Blob

### Purpose
Photo storage for packing, receiving, and repair workflows.

### Usage
- Upload via `POST /api/packing-logs/save-photo`
- URL stored in `photos.url` column
- Polymorphic: entityType (PACKER_LOG, RECEIVING, REPAIR_SERVICE) + entityId

### Env Vars
```
BLOB_READ_WRITE_TOKEN
```

---

## Upstash (Redis + QStash)

### Redis — Distributed Cache
- `src/lib/cache/upstash-cache.ts`
- Staff cache, goals cache
- TTL: 1 hour (staff), 30 min (goals)

### QStash — Job Scheduling
- `src/lib/qstash.ts` — Client setup
- Bootstrap: `POST /api/qstash/schedules/bootstrap`
- No Vercel cron dependency

### Env Vars
```
KV_REST_API_TOKEN, QSTASH_TOKEN
```

---

## AI/LLM (`src/lib/ai/`)

### Purpose
Internal AI assistant for operations queries.

### Files
- `src/lib/ai/ops-assistant.ts` — Main logic
- `src/lib/ai/intent-router.ts` — Request classification
- `src/lib/ai/context-fetchers.ts` — Ops data fetchers
- `src/lib/ai/ollama.ts` — LLM connection
- `src/app/api/ai/chat` — Chat endpoint
- `src/app/api/ai/search` — Semantic search

### Env Vars
```
OLLAMA_BASE_URL, AI_CHAT_RATE_LIMIT
```
