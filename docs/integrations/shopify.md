# Shopify integration (Nango-backed)

**Status:** Plan. **Effort:** small once the Nango sidecar is up — Shopify is
first-class in Nango's catalog, so we reuse Nango's auth + proxy and write only a
sync adapter.

## Why Nango
Shopify OAuth is per-store (`{shop}.myshopify.com`) with rotating tokens. Nango's
stock `shopify` connector handles the authorize/callback/token-exchange/**refresh**
and prompts the merchant for their shop subdomain in the Connect UI. We never store
or rotate a Shopify token — we ask Nango for a fresh one at sync time.

## Capabilities
`orders` + `inventory`. Plugs into the connection-driven sync orchestrator the
moment the connector is registered.

## Build steps (the recipe from README, filled in)

1. **Provider key** — `src/lib/integrations/credentials.ts`: add `'shopify'` to
   `IntegrationProvider`. `src/lib/integrations/nango-providers.ts`:
   `NANGO_BACKED_PROVIDERS.shopify = 'shopify'`.
2. **Display catalog** — `src/app/settings/integrations/registry.ts`: add a
   `ProviderDef` `{ key: 'shopify', label: 'Shopify', category: 'Storefronts & POS',
   connect: 'nango', badge: 'bg-lime-100 text-lime-700' }`. The Connect button +
   `/api/integrations/nango/{session,connected}` flow already exist (mirrors Square).
3. **Behavior connector** — `src/lib/integrations/connectors/registry.ts`:
   ```ts
   shopify: {
     provider: 'shopify', authKind: 'nango', capabilities: ['orders', 'inventory'],
     sync: (orgId) => import('./shopify').then((m) => m.shopifySync(orgId)),
   },
   ```
4. **Sync adapter** — `src/lib/integrations/connectors/shopify.ts`:
   - Read the incremental cursor from `organization_integrations.sync_cursor` (the
     Phase-3 column; add it via the deferred migration).
   - Pull orders **through the Nango proxy** (free tier — *not* Nango Syncs):
     ```ts
     // GET {shop}/admin/api/2024-07/orders.json?status=any&updated_at_min=<cursor>
     const res = await nangoProxy(orgId, 'shopify', {
       method: 'GET',
       endpoint: '/admin/api/2024-07/orders.json',
       params: { status: 'any', updated_at_min: cursor ?? '', limit: '250' },
     });
     ```
   - Map each order line → upsert into `orders`: `account_source: 'shopify'`,
     `order_id` = Shopify order id/name, `product_title`/`sku`/`quantity` from
     `line_items[]`, **`sale_amount`** from `line_item.price` (× qty) and
     **`currency`** from `order.currency` — reusing the `sale_amount`/`currency`
     ingestion we already added.
   - Persist the new `updated_at` watermark to `sync_cursor`; return `SyncOutcome`.
5. **Source platform** — add `'shopify'` to `SOURCE_PLATFORMS`
   (`src/lib/source-platform.ts`) so the order rows get a label/tone (the price chip
   etc. already render generically).

## What flows automatically once registered
- Appears in `/settings/integrations` with a **Connect with OAuth** button.
- `connectorsWithCapability('orders')` picks it up → **"Sync now"** works
  (`POST /api/integrations/shopify/sync`).
- Add `shopify` to the cron: `/api/cron/integrations/sync?providers=ebay,shopify`.
- Counts as **1** against `maxIntegrations`.

## What the operator must provide
- A **Shopify Partner app** (Partners dashboard) → `client_id` + `client_secret`,
  scopes `read_orders, read_products` (`read_fulfillments`, `read_inventory` if we
  later sync inventory), and the app's redirect URL pointed at the **Nango** callback.
- Configure that app's credentials on the **`shopify` integration in the Nango
  dashboard** (Nango stores them; our app only mints a Connect session).
- At connect time the merchant enters their `*.myshopify.com` domain in the Nango
  Connect UI.

## Checklist
- [ ] Nango sidecar deployed (`NANGO_SECRET_KEY` set)
- [ ] Shopify Partner app created; credentials set on Nango's `shopify` integration
- [ ] `shopify` added to provider enum + `NANGO_BACKED_PROVIDERS` + both registries
- [ ] `connectors/shopify.ts` `shopifySync` via `nangoProxy`
- [ ] `'shopify'` added to `SOURCE_PLATFORMS`
- [ ] `sync_cursor` column migration applied (incremental watermark)
- [ ] `shopify` added to the orchestrator cron `?providers=`
