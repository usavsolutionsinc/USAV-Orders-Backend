# Shipped-Order → Zoho Inventory Fulfillment Sync

Pushes **shipped** orders from our authoritative internal system into Zoho
Inventory so a proper accounting record lands in the Zoho finance ecosystem
(Zoho Books / Inventory). For each shipped order the sync walks the full Zoho
fulfillment chain:

```
sales order  →  package  →  shipment order  →  (delivered)  →  invoice
```

It is **idempotent**, **incremental** (delta cursor), **dry-run-able**, and
keeps a durable **audit trail** of every Zoho id it creates.

---

## How it fits the existing codebase

This feature deliberately reuses what was already here rather than reinventing it:

| Concern | Reused component |
| --- | --- |
| Rate limiting, retry/backoff, circuit breaker, 401 refresh | `src/lib/zoho/httpClient.ts` |
| OAuth2 token mgmt + refresh, region base URL | `src/lib/zoho/core.ts` |
| Typed Zoho API calls (package/shipment/invoice/payment) | `src/lib/zoho/ZohoInventoryClient.ts` |
| Create + confirm a Zoho sales order (with contact + item resolution) | `src/services/OrderSyncService.ts` (`ingestExternalOrder`) |
| Delta cursor storage | `src/lib/sync-cursors.ts` (`getSyncCursor` / `updateSyncCursor`) |
| Cron auth + shape | mirrors `src/app/api/cron/zoho/po-sync/route.ts` |

### New files

| File | Purpose |
| --- | --- |
| `src/lib/migrations/2026-06-02_zoho_fulfillment_sync.sql` | `zoho_fulfillment_sync` ledger (idempotency + audit) |
| `src/lib/zoho/fulfillment-config.ts` | env-driven config (invoice mode, dry-run, etc.) |
| `src/lib/zoho/fulfillment-source.ts` | finds shipped orders from `orders` ⨝ `shipping_tracking_numbers` |
| `src/lib/zoho/fulfillment-sync.ts` | idempotent state machine + batch runner + ledger |
| `src/app/api/cron/zoho/fulfillment-sync/route.ts` | scheduled (Vercel cron) entry point |
| `src/app/api/zoho/fulfillment-sync/route.ts` | manual / on-demand trigger (admin) |
| `src/lib/zoho/fulfillment-sync.test.ts` | unit tests for the state machine |

---

## Data model

**Source of truth for "shipped":** an `orders` row (line-level, one per SKU)
linked via `shipment_id` to a row in the canonical `shipping_tracking_numbers`
table whose carrier status has reached *accepted / in-transit / out-for-delivery
/ delivered*. Orders are grouped by `order_id` (the channel/marketplace order id).

**Join to Zoho:** `orders.order_id` ⇒ `salesOrders.referenceNumber` ⇒ Zoho
`reference_number`. If no Zoho sales order exists yet, one is created + confirmed
via `OrderSyncService.ingestExternalOrder` (which also creates the contact and
maps SKUs to Zoho item ids).

**Idempotency + audit ledger:** `zoho_fulfillment_sync`, one row per order
(`reference_number` unique). It records `zoho_salesorder_id`, `zoho_package_id`,
`zoho_shipment_id`, `zoho_invoice_id`, `invoice_status`, `stage`, `status`,
`delivered`, `attempts`, `last_error`, and a `source_hash` of the shipment
snapshot (so an unchanged completed order is skipped on the next run).

---

## Setup

### 1. Run the migration

```bash
npm run db:migrate         # applies src/lib/migrations/*.sql (creates zoho_fulfillment_sync)
npm run db:migrate:dry     # preview without applying
```

### 2. OAuth & credentials (already used by the existing Zoho integration)

| Env var | Notes |
| --- | --- |
| `ZOHO_ORG_ID` (or `ZOHO_ORGANIZATION_ID`) | Zoho organization id |
| `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET` | OAuth app credentials |
| `ZOHO_REFRESH_TOKEN` | persisted refresh token (or stored in KV) |
| `ZOHO_DOMAIN` | region, default `accounts.zoho.com` (`.eu`, `.in`, …) |
| `CRON_SECRET` | required `Authorization: Bearer` for the cron route |

First-time OAuth connect: visit `/api/zoho/oauth/authorize`.

**Required OAuth scopes** (Inventory):

```
ZohoInventory.salesorders.CREATE, ZohoInventory.salesorders.READ, ZohoInventory.salesorders.UPDATE
ZohoInventory.packages.CREATE,     ZohoInventory.packages.READ
ZohoInventory.shipmentorders.CREATE, ZohoInventory.shipmentorders.UPDATE
ZohoInventory.invoices.CREATE,     ZohoInventory.invoices.READ
ZohoInventory.customerpayments.CREATE
ZohoInventory.contacts.CREATE,     ZohoInventory.contacts.READ
ZohoInventory.items.READ
```

### 3. Configuration (example `.env`)

All keys are optional — shown with their **defaults**. The mapping config is
environment-driven, so no code changes are needed to tune behavior.

```dotenv
# Safety: dry-run is ON by default. The sync logs intended actions and writes
# NOTHING to Zoho until you flip this to false.
ZOHO_FULFILLMENT_DRY_RUN=true

# Accounting depth for the invoice step:
#   none  → no invoice (package + shipment only)
#   draft → create invoice, leave as Draft
#   sent  → create + mark Sent (open A/R)            ← default
#   paid  → create + mark Sent + record full payment (for already-paid marketplace orders)
ZOHO_FULFILLMENT_INVOICE_MODE=sent

# Mark the Zoho shipment Delivered when carrier tracking shows delivered.
ZOHO_FULFILLMENT_MARK_DELIVERED=true

# Include FBA / Amazon-fulfilled orders (they have separate accounting).
ZOHO_FULFILLMENT_INCLUDE_FBA=false

# payment_mode used when INVOICE_MODE=paid.
ZOHO_FULFILLMENT_PAYMENT_MODE=banktransfer

# First delta run bootstraps from this many days back (no cursor yet).
ZOHO_FULFILLMENT_BOOTSTRAP_DAYS=30

# Max orders processed per run (function-timeout guard).
ZOHO_FULFILLMENT_BATCH_SIZE=100
```

### 4. Go live (recommended rollout)

1. Deploy with `ZOHO_FULFILLMENT_DRY_RUN=true`. The cron runs and the ledger
   fills with `status=dry_run` rows. Inspect the per-order `actions` trail via
   the manual endpoint or the `zoho_fulfillment_sync` table.
2. Sanity-check one order live: `POST /api/zoho/fulfillment-sync` with
   `{ "reference": "<order_id>", "dryRun": false }` and verify in Zoho.
3. Set `ZOHO_FULFILLMENT_DRY_RUN=false` to enable the scheduled live sync.

---

## Scheduling (Vercel cron — already wired in `vercel.json`)

```json
{ "path": "/api/cron/zoho/fulfillment-sync?mode=delta", "schedule": "15 */4 * * *" }
{ "path": "/api/cron/zoho/fulfillment-sync?mode=full",  "schedule": "45 3 * * *" }
```

- **delta** (every 4h): only orders changed since the last successful run.
- **full** (nightly): scans all shipped orders (bounded by batch size) as a
  safety net.

The cursor (`sync_cursors` key `zoho_fulfillment_sync`) only advances after an
**error-free live run**. Dry runs never move it.

---

## Usage

### Scheduled (cron)

```
GET /api/cron/zoho/fulfillment-sync?mode=delta|full&dry_run=0|1&limit=100
Authorization: Bearer $CRON_SECRET
```

### Manual / on-demand (admin, permission `integrations.zoho`)

```bash
# Preview a single order (dry-run is the default here)
curl -X POST https://<host>/api/zoho/fulfillment-sync \
  -H 'Content-Type: application/json' \
  -d '{ "reference": "ORDER-123" }'

# Actually sync a single order
curl -X POST https://<host>/api/zoho/fulfillment-sync \
  -H 'Content-Type: application/json' \
  -d '{ "reference": "ORDER-123", "dryRun": false }'

# Full batch, live
curl -X POST https://<host>/api/zoho/fulfillment-sync \
  -H 'Content-Type: application/json' \
  -d '{ "mode": "full", "dryRun": false, "limit": 200 }'
```

The response is the full `SyncRunReport`, including each order's `actions` trail
and the Zoho ids that were created/reused.

---

## Key Zoho API calls used

All go through `ZohoInventoryClient` (rate-limited + retrying):

```ts
// Create/confirm sales order (only when one doesn't already exist)
POST /salesorders                          // via OrderSyncService
POST /salesorders/{id}/status/confirmed
GET  /salesorders/{id}                     // fetch line_items + customer_id

// Package the SO's line items
POST /packages?salesorder_id={soId}
     body: { date, line_items: [{ so_line_item_id, quantity }], notes }

// Create the shipment order (carrier + tracking)
POST /shipmentorders?salesorder_id={soId}&package_ids={pkgId}
     body: { date, delivery_method, tracking_number, reference_number, notes }

// Mark delivered when tracking confirms
POST /shipmentorders/{shipmentId}/status/delivered

// Invoice = the accounting record
GET  /invoices?reference_number={ref}      // idempotency check
POST /invoices                             // line_items reference salesorder_item_id
POST /invoices/{id}/status/sent            // when INVOICE_MODE=sent|paid
POST /customerpayments                     // when INVOICE_MODE=paid
```

### Idempotency strategy

1. **Ledger first** — reuse any Zoho id already recorded for the order.
2. **Re-check Zoho before creating** — sales order & invoice are looked up by
   `reference_number`; packages are looked up against the sales order. This
   protects against duplicates even if the ledger is lost.
3. **`source_hash` skip** — a completed order whose shipment snapshot is
   unchanged is skipped entirely.

### Error handling

- Transient Zoho errors (429/5xx) are retried with backoff inside the HTTP
  client; sustained failures trip its circuit breaker.
- A per-order failure is recorded on the ledger (`status=error`, `last_error`,
  `attempts++`) and **does not** block other orders. Partial progress is saved,
  so the next run resumes from the failed step.
- The cron cursor only advances when `errored === 0`, so failed orders are
  retried next run.

---

## Testing

```bash
npm run test:zoho-fulfillment
```

Covers: full live walk, idempotent skip, source-change reprocessing, dry-run
(no writes), `invoiceMode=paid` payment recording, resume-from-partial-ledger,
and `invoiceMode=none`. The state machine is injected with a fake Zoho client
and an in-memory ledger, so the tests touch neither the network nor the DB.

---

## Notes / future enhancements

- **Full-shipment assumption.** Each order is packaged as a single package
  containing all SO line items at full quantity (appropriate because we only
  sync orders that have fully shipped). Partial/split shipments would need
  per-line quantity reconciliation against `quantity_shipped`.
- **Mirror tables.** This push sync uses `zoho_fulfillment_sync` as its source of
  truth. The pre-existing pull-mirror tables (`packages`, `shipment_orders`,
  `invoices`) are left to the Zoho→local pull path; populating them from this
  sync could be layered on later if a unified local view is desired.
- **Tenancy.** The cron is single-tenant (`transitionalUsavOrgId()`), matching
  the existing Zoho PO sync. A tenant-aware loop can be added when cron tenancy
  lands.
