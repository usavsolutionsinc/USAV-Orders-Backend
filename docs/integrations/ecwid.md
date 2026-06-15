# Ecwid integration (Nango-backed, with hand-built fallback)

**Status:** Plan. Ecwid is **not** in Nango's stock catalog, so "reuse Nango" here
means registering Ecwid as a **custom OAuth2 provider** in our self-hosted Nango —
which lets us still reuse Nango's auth + proxy + token storage. A hand-built native
flow is the fallback if we'd rather not maintain a custom Nango provider.

## Two routes (pick one)

### A. Nango custom provider (reuses the Nango backend — preferred per the directive)
Self-hosted Nango supports adding a provider it doesn't ship by giving it an OAuth2
config (authorize URL, token URL, scopes). We define **our own** Ecwid config — we do
**not** copy Nango's `providers.yaml` (ELv2 license; see the Nango plan). Then Ecwid
behaves exactly like Shopify/Square in our code: same Connect flow, same
`nangoProxy(orgId, 'ecwid', …)` for the sync adapter.

- Nango custom provider config (operator-defined, in the sidecar):
  - `authorization_url`: `https://my.ecwid.com/api/oauth/authorize`
  - `token_url`: `https://my.ecwid.com/api/oauth/token`
  - `scopes`: `read_orders read_catalog` (+ `read_store_profile` as needed)
- `NANGO_BACKED_PROVIDERS.ecwid = 'ecwid'` (our custom provider_config_key).

### B. Hand-built native OAuth (fallback — no Nango dependency for Ecwid)
- `GET /api/ecwid/oauth/authorize` → redirect to
  `https://my.ecwid.com/api/oauth/authorize?client_id=…&scope=…&response_type=code&redirect_uri=…&state=<encrypted org+nonce>`
- `GET /api/ecwid/oauth/callback` → exchange `code` at
  `https://my.ecwid.com/api/oauth/token` → store `{ storeId, accessToken, scope }`
  in the encrypted vault via `upsertIntegrationCredentials(orgId, 'ecwid', …)`.
- Flip `registry.ts` Ecwid `connect: 'vault'` → `'oauth'`.

> **Ecwid tokens are long-lived** (no expiry until the app is uninstalled), so
> **there is no refresh flow** either way — simpler than eBay/Amazon. The token +
> numeric `store_id` are all the sync needs.

## Capabilities
`orders`. (Inventory/catalog later if useful.)

## Sync adapter — `src/lib/integrations/connectors/ecwid.ts`
`ecwidSync(orgId)` generalizes the **existing** Ecwid order ingestion (today driven
by env token in `/api/ecwid/transfer-orders` + `/api/ecwid/sync-exception-tracking`)
to a per-tenant connection:
- Resolve the store + token: route A → `nangoProxy(orgId, 'ecwid', …)`; route B →
  `getIntegrationCredentials<EcwidCredentials>(orgId, 'ecwid')`.
- `GET /api/v3/{storeId}/orders?updatedFrom=<cursor>` → map each item → upsert into
  `orders`: `account_source: 'ecwid'`, **`sale_amount`** from order `total` (or item
  price), **`currency`** from `order.currency` — reusing the existing Ecwid → orders
  mapping and the `sale_amount`/`currency` ingestion we added.
- Persist the `updatedFrom` watermark; return `SyncOutcome`. Registered in
  `connectors/registry.ts` with `authKind: 'nango'` (route A) or `'oauth'` (route B)
  + a lazy `sync`.

## Multi-tenant note (scope expectation)
USAV's **own** Ecwid store already works via the env API token
(`ECWID_STORE_ID` + `ECWID_API_TOKEN`). Ecwid OAuth only matters for letting
**other orgs** connect *their* Ecwid — i.e. it's a SaaS / external-customer feature,
not on the USAV dogfood critical path.

## What the operator must provide
- An **Ecwid (Lightspeed) app** → `client_id` + `client_secret`, scopes
  `read_orders read_catalog`, redirect URI = the Nango callback (route A) or
  `…/api/ecwid/oauth/callback` (route B).
- Route A: set those credentials on the Ecwid **custom provider in the Nango sidecar**.

> Verify the exact `authorize`/`token` URLs + scope names against current
> Lightspeed-Ecwid developer docs before wiring — the portal/endpoints changed after
> the Lightspeed acquisition.

## Checklist
- [ ] Decide route A (Nango custom provider) vs B (hand-built)
- [ ] Ecwid app created → `client_id`/`secret`/scopes/redirect
- [ ] Route A: custom Ecwid provider configured in Nango (our own config, not copied)
- [ ] `'ecwid'` already in provider enum; add `EcwidCredentials` shape if route B
- [ ] `connectors/ecwid.ts` `ecwidSync` (reuse existing Ecwid → orders mapping)
- [ ] `registry.ts` Ecwid `connect` set to `'nango'` (A) or `'oauth'` (B)
- [ ] `ecwid` added to the orchestrator cron `?providers=`
- [ ] `'ecwid'` already in `SOURCE_PLATFORMS` (no change)
