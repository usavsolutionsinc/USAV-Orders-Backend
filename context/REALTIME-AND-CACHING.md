# Realtime & Caching

## Realtime (Ably)

### Overview
Ably provides WebSocket/SSE connections for live dashboard updates. No polling required.

### Server-Side Publishing (`src/lib/realtime/publish.ts`)
```typescript
publishOrderChange(orderId, action)      // Order created/updated/assigned
publishRepairChange(ticketId, action)    // Repair ticket updates
publishStationActivity(stationId, event) // Tech/packer station events
publishOrderTested(orderId)              // Order test completed
publishTechLogChanged(techId)            // Tech log updated
```

### Client-Side Subscription
```typescript
// In components:
import { useAblyChannel } from '@/hooks/useAblyChannel';

useAblyChannel('orders:changes', (message) => {
  // Refresh data on change
  queryClient.invalidateQueries(['orders']);
});
```

### Channels
| Channel | Events |
|---------|--------|
| `orders:changes` | Order CRUD, status changes, assignments |
| `repair:changes` | Repair ticket lifecycle |
| `station:changes` | Station activity (scans, serials) |
| `db:schema:table` | Generic table-level row changes |
| `db:schema:table:rowId` | Row-level changes |

### Auth
- Token endpoint: `GET /api/realtime/token`
- Provider: `src/contexts/AblyContext.tsx`
- Client: Ably JS SDK
- Env: `ABLY_API_KEY`

---

## Caching Strategy

### Layer 1: In-Memory Cache (`src/lib/cache.ts`)
- TTL-based (default 5 minutes)
- Module-level Map keyed by domain + id
- Window events (`cache-invalidate-{domain}`) for cross-component sync
- Domains: `'order'`, `'staff'`, `'sku'`, `'shipping'`, `'fba-shipment'`

```typescript
cacheSet(domain, id, data)     // Store with TTL
cacheGet(domain, id)           // Retrieve if not expired
cacheHas(domain, id)           // Check existence
cacheInvalidate(domain, id?)   // Clear by domain or specific key
```

### Layer 2: Staff Singleton Cache (`src/lib/staffCache.ts`)
- Module-level singleton: one fetch per page load
- Shared across all components that need staff data
- `getActiveStaff()` — returns cached promise (resolves instantly after first load)
- `getPresentStaffForToday()` — keyed by PST date, resets daily
- `invalidateStaffCache()` — force re-fetch after staff mutations

### Layer 3: Upstash Redis (`src/lib/cache/upstash-cache.ts`)
- Distributed cache for multi-instance deployments
- Used for: staff data (1h TTL), staff goals (30m TTL)
- Tag-based invalidation: `invalidateCacheTags(['staff', 'goals'])`
- Env: `KV_REST_API_TOKEN`

### Layer 4: React Query (TanStack)
- Client-side data cache with auto-refetching
- Refetches on window focus
- Stale-while-revalidate pattern
- Query keys: `['orders', 'tech-logs']`, `['fba-shipments']`, `['staff', role]`

### Cache Invalidation Flow
1. API mutation completes
2. Server publishes Ably event
3. Client receives event via `useAblyChannel`
4. React Query cache invalidated
5. Component re-renders with fresh data

---

## Background Jobs (QStash)

### Overview
Upstash QStash handles scheduled jobs. No Vercel cron needed.

### Setup
After deploy, run: `POST /api/qstash/schedules/bootstrap`
This registers all schedules with QStash.

### Client: `src/lib/qstash.ts`

### Schedules

| Job | Schedule | Endpoint |
|-----|----------|----------|
| Shipping sync | Every 2 hours | `POST /api/qstash/shipping/sync-due` |
| eBay token refresh | Hourly | `POST /api/qstash/ebay/refresh-tokens` |
| eBay order sync | Periodic | `POST /api/qstash/ebay/sync` |
| Google Sheets transfer | 8:30 AM, 10 AM, 2 PM PST | `POST /api/qstash/google-sheets/transfer-orders` |
| Zoho order ingest | Periodic | `POST /api/qstash/zoho/orders/ingest` |
| Replenishment sync | Periodic | `POST /api/qstash/replenishment/sync` |

### Idempotency
- `src/lib/api-idempotency.ts` — Request deduplication
- `idempotencyKey` prevents duplicate processing on retries
- QStash automatically retries failed jobs

### Incremental Sync
- `sync_cursors` table tracks `lastSyncedAt` per resource
- Avoids full re-fetches on each sync cycle
