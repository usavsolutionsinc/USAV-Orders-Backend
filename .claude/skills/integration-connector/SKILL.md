---
name: integration-connector
description: Add or extend an external platform integration (marketplace / POS / storefront / carrier) the canonical way — register an IntegrationConnector, store tokens ONLY in the organization_integrations vault (the OAuth token SoT) via get/upsertIntegrationCredentials, and implement a connection-driven sync adapter that upserts into `orders` with the uniform shape. Use when wiring eBay/Amazon/Zoho/Square/Ecwid-style providers or adding a new channel.
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
---

# Integration connector

Wires a provider into the connection framework (`src/lib/integrations/connectors/`)
so the settings UI, refresh sweep, and sync orchestrator treat every provider the
same. The goal is **connection-driven** ingestion — `sync()` is run by the
orchestrator/cron off a stored connection, NOT a manual "transfer orders" button
(see `docs/integrations-oauth-connection-plan.md`).

**Per-provider, the only net-new code should be a thin sync adapter.** Everything
else (token storage, refresh sweep, capability badges) is shared. Square is the
reference for a Nango provider; eBay/Amazon for hand-built OAuth.

## The two hard SoT rules

1. **Tokens live ONLY in `organization_integrations`** (the vault), accessed via
   `src/lib/integrations/credentials.ts`:
   - read → `getIntegrationCredentials<T>(orgId, provider, { scope })`
   - write → `upsertIntegrationCredentials({ orgId, provider, scope, payload, displayLabel, createdBy })`
   - error → `markIntegrationError(orgId, provider, …)`; delete → `deleteIntegrationCredentials(...)`
   - Payloads are AES-GCM encrypted through `crypto.ts` automatically — **never** store a
     raw token, **never** add a new token home, **never** hand-write a `SELECT … FROM
     organization_integrations`. (This is the active "4 token homes → 1 SoT" consolidation;
     don't add a 5th.) The transitional env-var fallback is USAV-only and deprecated.

2. **Behavior SoT = the connector registry**, display SoT = the settings catalog. Don't
   duplicate auth-kind/capabilities into the UI; the catalog derives them.

## Step 1 — register the provider (behavior)

- If the provider is net-new, add it to the `IntegrationProvider` union in
  `src/lib/integrations/credentials.ts` and define a typed `…Credentials` interface
  (mirror `EbayCredentials` / `AmazonCredentials`).
- Add an entry to the `CONNECTORS` record in
  `src/lib/integrations/connectors/registry.ts`. The `Record<IntegrationProvider, …>`
  makes a missing provider a **compile error** — that's the forcing function. Set:
  - `authKind`: `'oauth'` (hand-built flow) · `'nango'` (Nango-hosted Connect) ·
    `'vault'` (pasted/config creds).
  - `capabilities`: subset of `orders | inventory | tracking | payments`.
  - `authorizeStartPath` / `healthPath` for OAuth/Nango providers.
  - `sync`: a **lazy import** — `sync: (orgId) => import('./<provider>').then(m => m.<provider>Sync(orgId))`
    — so the connection reader never pulls the provider client into its bundle.

**Auth-kind decision:**
- **Nango** only for providers Nango actually supports, and **additive-only** — the ELv2
  license forbids copying Nango code. Shipping carriers (UPS/FedEx/USPS) and Ecwid are
  NOT Nango-supported and stay hand-built `vault` connectors **forever**.
- **oauth** when you control the connect/callback flow (eBay/Amazon).
- **vault** for paste-a-key / config-only providers.

## Step 2 — the sync adapter (the only net-new logic)

Create `src/lib/integrations/connectors/<provider>.ts` exporting
`export async function <provider>Sync(orgId: OrgId): Promise<SyncOutcome>`. Mirror
`connectors/square.ts`:

- Fetch through a **tenant-aware client keyed on `orgId`** that reads the token from the
  vault (e.g. `squareFetchForOrg(orgId, …)`); never thread a token in by hand.
- Incremental watermark via `getSyncCursor(resource)` / `updateSyncCursor(resource, date)`
  (`src/lib/sync-cursors.ts`); first run uses a bounded lookback + a `MAX_PAGES` safety cap.
- **Upsert into `orders` with the uniform shape** — `account_source` (the provider key),
  `sale_amount`, `currency`, `order_date` — `ON CONFLICT ON CONSTRAINT
  idx_orders_unique_account_order`. Matching eBay/Amazon/Square's shape is what lets every
  downstream surface (price chip, tracker, `source-platform.ts` label) render it generically
  without provider-specific code.
- Return `{ ok, imported, updated, cursor }`. Throw nothing the orchestrator can't see.

## Step 3 — connect / callback routes (oauth only)

Scaffold these with the **`new-route`** skill. Conventions specific to integrations:
- **Connect** (`POST /api/<provider>/connect` or `/oauth/start`): `withAuth`, permission
  `integrations.<provider>`. **Verify the connection works before persisting**, then
  `upsertIntegrationCredentials(...)`. Never echo secrets (client secret, refresh token)
  into the audit `extra` payload.
- **OAuth callback** (`GET /api/<provider>/oauth/callback`): **session-less** — there is no
  cookie. Recover tenant scope from an **encrypted `state`** (`decryptIntegrationPayload`,
  AES-GCM, ~15-min freshness window), exchange the code, vault the token. This route is
  **intentionally ungated** (state-validated public redirect, like eBay/Amazon) — do NOT
  add it to the manifest regression test as gated.
- Add `integrations.<provider>` to `permission-registry.ts` if net-new (the `new-route`
  skill covers the registry + manifest-test pairing).
- KMS is prod-hard-fail (`INTEGRATION_KMS_KEY`); encryption goes through `crypto.ts`.

## Step 4 — display + verify

- Add the provider card to the settings catalog `src/app/settings/integrations/registry.ts`
  (labels/badges/modal copy — the DISPLAY SoT). Don't re-declare behavior here.
- Org-scope any new DB reads/writes with the **`org-scope`** skill (`tenantQuery` / explicit
  `organization_id`); the sot-guard hook still applies.
- Verify:
  ```bash
  npx tsc --noEmit                 # registry Record coverage is a compile gate
  npm run audit-route-auth:check   # if you added connect/callback routes
  npx --no-install next lint --file <changed files>
  ```
  Report what you added (provider, auth kind, capabilities, sync resource). Don't commit.

## Rules

- Tokens only in `organization_integrations` via `credentials.ts` — no new token home, no raw SELECT.
- One thin sync adapter per provider; everything else is shared. Lazy-import it in the registry.
- New `orders` rows use the uniform `account_source` / `sale_amount` / `currency` shape on
  `idx_orders_unique_account_order` so downstream stays provider-agnostic.
- Nango is additive-only; carriers + Ecwid are hand-built `vault` connectors, never Nango.
- OAuth callbacks are session-less and intentionally ungated (encrypted-state validated) —
  don't wrap them in `withAuth` permission gates or assert them as gated in the manifest test.
- `orgId` from `ctx`, never the body. Verify the connection before persisting credentials.
