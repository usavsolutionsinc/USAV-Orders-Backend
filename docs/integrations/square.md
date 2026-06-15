# Square (POS — Nango-backed)

In-store POS + walk-ins. Square was the **Nango pilot**: its OAuth connect flow was the
one real gap, and Nango's hosted Connect UI + auth + proxy + token rotation fills it
without hand-building authorize/callback/refresh. **Auth and the order-import sync
adapter are now both built** — a connected Square org flows through the same
connection-driven sync as eBay/Amazon. (The Ecwid → Square catalog one-way sync is a
separate feature, below.)

> Note the Nango catalog key is **`squareup`**, not `square`
> (`NANGO_BACKED_PROVIDERS.square = 'squareup'`).

## What's built

- **Nango seam** (`src/lib/integrations/nango.ts`) — `isNangoConfigured()`,
  `createNangoConnectSession()`, `recordNangoConnection()`, `getNangoConnection()`,
  `getNangoAccessToken()`, `nangoProxy()`. Dependency-free registry in
  `nango-providers.ts` so client and server can both import it.
- **Connect routes** —
  - `POST /api/integrations/nango/session` (`admin.manage_features`, step-up): mints a
    short-lived Connect session token for `{ provider: 'square' }`.
  - `POST /api/integrations/nango/connected` (`admin.manage_features`, step-up): persists
    the connection marker (`{ __nango, connectionId, providerConfigKey }`) into
    `organization_integrations` after the hosted UI completes OAuth.
- **Tenant-aware client** (`src/lib/square/server.ts`) — `resolveSquareConfig(orgId)` /
  `squareFetchForOrg(orgId, …)` prefer the Nango-managed token for the org and fall back
  to env (`SQUARE_ACCESS_TOKEN` etc.) for USAV's own store. Base client +
  price/currency helpers in `src/lib/square/client.ts`.
- **Catalog sync (separate feature)** — `src/lib/ecwid-square/sync.ts`
  `syncEcwidToSquare()` does a **one-way Ecwid → Square catalog** push (ITEM +
  ITEM_VARIATION batch upsert), driven by `POST /api/ecwid-square/sync`
  (`integrations.ecwid`, body `{ dryRun?, batchSize? }`). This is **catalog**, not order
  import.
- **Webhook receiver** — `POST /api/webhooks/square` (Square signature verified) exists.
- **Order-import sync** — `src/lib/integrations/connectors/square.ts`
  `squareSync(orgId)`, wired into `connectors/registry.ts` (`sync: …`). It:
  - resolves the org's active locations (`GET /locations`, capped at 10),
  - reads the incremental `updated_at` watermark from `sync_cursors`
    (`resource = 'square:orders:{orgId}'`; 30-day first-run lookback),
  - pages `POST /orders/search` (states `OPEN`/`COMPLETED`, sorted `UPDATED_AT ASC`)
    **through the tenant-aware client** `squareFetchForOrg` (Nango token, env fallback),
  - upserts each order into `orders` with the **same shape as eBay/Amazon**
    (`account_source: 'square'`, `sale_amount` = `total_money.amount`/100,
    `currency` = `total_money.currency`, `ON CONFLICT idx_orders_unique_account_order`),
  - advances the watermark only on a clean run, returns `SyncOutcome`.
- **Wired in:** `'square'` added to `SOURCE_PLATFORMS` (label/tone) and to the
  orchestrator cron (`/api/cron/integrations/sync?providers=ebay,square`, `*/15`).

So **"Sync now"** (`POST /api/integrations/square/sync`, `admin.manage_features`) and the
cron now pull Square orders for any connected org — same path as eBay/Amazon.

## Notes / follow-ups

- **SKU linkage** is intentionally left blank: Square POS line items carry a
  `catalog_object_id`, not a SKU string, so `sku`/`sku_catalog_id` are unset rather than
  forcing a catalog lookup that would create junk entries. A later pass can resolve the
  catalog object → SKU if Square sales need SKU-level tracking.
- Multi-line Square orders collapse to one `orders` row (title = first line `+N more`,
  quantity = sum), mirroring Amazon's representative-item approach.
- Like eBay/Amazon ingestion, the upsert does **not** set `organization_id` explicitly
  (it relies on the column default); revisit when the tenancy hardening forces RLS on
  `orders`.

## What the operator must provide

- A **Square application** (Square Developer dashboard) → `client_id`/`client_secret`,
  scopes `ORDERS_READ MERCHANT_PROFILE_READ` (+ `ITEMS_READ`/`ITEMS_WRITE` for the
  catalog sync), redirect URL pointed at the **Nango** callback.
- Those credentials configured on the **`squareup` integration in the Nango sidecar**.
- `NANGO_SECRET_KEY` (and `NANGO_HOST` if self-hosted) set — otherwise
  `isNangoConfigured()` is false and the Square card falls back to env/vault.

## Environment variables (env-fallback / single-tenant path)

| Var | Purpose |
|---|---|
| `NANGO_SECRET_KEY` | Activates the Nango path for all Nango-backed providers. |
| `NANGO_HOST` | Self-hosted Nango URL (omit for Nango Cloud). |
| `SQUARE_ACCESS_TOKEN` (`SQUARE_TOKEN`/`SQUARE_API_TOKEN`) | USAV store bearer (env fallback). |
| `SQUARE_LOCATION_ID` / `SQUARE_DEFAULT_LOCATION_ID` | Default location. |
| `SQUARE_ENVIRONMENT` | `SANDBOX` / `PRODUCTION`. |
| `SQUARE_VERSION` | API version (default `2024-01-18`). |
| `SQUARE_CURRENCY` | Default currency (USD). |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` / `SQUARE_WEBHOOK_NOTIFICATION_URL` | Webhook config. |

## Checklist

- [ ] Nango sidecar deployed (`NANGO_SECRET_KEY` set)
- [ ] Square app created; creds set on Nango's `squareup` integration
- [x] Connect session + connected routes (`/api/integrations/nango/*`)
- [x] Tenant-aware Square client (`squareFetchForOrg`)
- [x] `connectors/square.ts` `squareSync` (Orders Search via `squareFetchForOrg`)
- [x] `sync` wired into `connectors/registry.ts` `square` entry
- [x] `'square'` added to `SOURCE_PLATFORMS`
- [x] `square` added to the orchestrator cron `?providers=ebay,square`
- [ ] Live-test once a Square app is configured on the Nango sidecar (needs `NANGO_SECRET_KEY`)
- [ ] (optional) resolve Square `catalog_object_id` → SKU for SKU-level tracking
