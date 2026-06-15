# Amazon SP-API Order Import — Integration Plan

> Goal: connect Amazon via **OAuth** on a **Connections screen** (multi-tenant — each org connects
> its own seller account), verify the API connection works, and **import Amazon sales orders**
> into this codebase — **local-only (no Zoho coupling)**, auto-imported **scoped by SKU / FBA items**.
>
> Status: **plan only** (greenfield — no `lib/amazon/`, no `/api/amazon/*`, no `amazon` credential
> type exist today). Researched 2026-06-13 via multi-agent codebase + web sweep. Owner decisions locked
> 2026-06-13 (see §10).

---

## 0. TL;DR — the recommended shape (with owner decisions baked in)

| Concern | Decision |
| --- | --- |
| **Primary deliverable** | A **Connections screen** to connect / update / disconnect Amazon via **OAuth (multi-tenant)**, a green "connection healthy" check, and ongoing **sales-order import**. |
| **Auth** | **OAuth (LWA authorization-code) public flow** so any org connects its own Amazon account → per-org refresh token in the vault. Mirrors the existing eBay OAuth callback. (Self-authorization is the USAV bootstrap shortcut; true multi-tenant OAuth needs a **published Appstore app** — see §11.) |
| **Transport** | Zero-dependency direct `fetch` client (`src/lib/amazon/client.ts`). SP-API is **LWA-only since 2023-10-02** — no AWS IAM/SigV4 — so the client is ~40 lines, matching the house no-SDK norm (eBay's hand-rolled client + Stripe's deliberate SDK avoidance). |
| **Credentials** | New `AmazonCredentials` in the `organization_integrations` vault (AES-256-GCM), DB-first per-org with USAV env fallback — the Stripe `loadCreds(orgId?)` template. |
| **Landing table** | **Local-only** — upsert directly into `sales_orders` (`channel='amazon'`, `referenceNumber = AmazonOrderId` = the UNIQUE idempotency key). **Bypass `OrderSyncService.ingestExternalOrder` and Zoho entirely** (it hard-requires a Zoho item per SKU). |
| **Sync** | (A) Ongoing incremental: `getOrders` by `LastUpdatedAfter` watermark (−15 min overlap) + `NextToken`. (B) **Item-scoped auto-import** — match each order's `SellerSKU`(MFN)/`ASIN`(FBA) against the org's SKU catalog / tracked FBA items; auto-import tracked items. **No date-windowed historical backfill.** |
| **Idempotency** | UPSERT on `AmazonOrderId`. Overlapping windows + retries are safe. |
| **Fulfillment** | Import **both** AFN(FBA) + MFN; flag **FBA read-only** so it never enters packer/tech queues. |
| **PII** | Buyer/shipping PII via a Restricted Data Token **only for MFN orders we physically ship**; request the Direct-to-Consumer Delivery role; store encrypted. |
| **UI platform chip** | `amazon` is *already* in `SOURCE_PLATFORMS` (line 29) — no registry change. |

---

## 1. What we're building on (verified facts)

### House integration pattern (the template to copy)
- **Credential vault** — `organization_integrations` (migration `2026-05-22_…`): per-org AES-256-GCM
  payloads, `provider` + optional `scope` for multi-account, 5-min in-process cache.
  Read via `getIntegrationCredentials<T>(orgId, provider, scope?)`; the `IntegrationProvider`
  union (`src/lib/integrations/credentials.ts:28`) runs `'ebay' … 'stripe'` — **no `'amazon'` yet**.
  New providers = add to the union + `envFallback()`.
- **eBay OAuth + sync is the structural twin**:
  - `src/app/api/ebay/callback/route.ts` — OAuth redirect handler: exchanges the auth code for tokens,
    stores them per account. **This is the model for the Amazon OAuth connect callback.**
  - `src/lib/ebay/sync.ts` — per-account loop, paged fetch by `last_sync_date` watermark, idempotent
    `ON CONFLICT … idx_orders_unique_account_order` upsert with `COALESCE(NULLIF(...))` guards,
    `Promise.allSettled`, structured `SyncResult` counters.
  - `ebay_accounts` (`schema.ts:12`) — per-account `marketplace_id`, `last_sync_date`, org-scoped unique
    index. The exact shape `amazon_accounts` mirrors.
  - `EbayClient` wraps every call → `ebay_api_calls` audit table. Stripe (`src/lib/billing/stripe.ts`)
    proves the no-SDK `fetch` approach is the house preference.
- **External-order data model** — `sales_orders` is the SoT for channel orders (uuid PK, `referenceNumber`
  UNIQUE = idempotency key, `channel` unconstrained text, `lineItems` JSONB, billing/shipping JSONB).
  `salesOrderRepository.findByReference()/create()` is the CRUD surface.
  ⚠️ `OrderSyncService.ingestExternalOrder` (`src/services/OrderSyncService.ts:91`) is **Zoho-coupled** —
  it maps every SKU to a Zoho item and creates a Zoho SO. **We do NOT use it** (owner: no Zoho); we write
  `sales_orders` directly.
- **Cron conventions** — `GET /api/cron/<x>?mode=delta|full`, `isAuthorized(req)` checks
  `Bearer ${CRON_SECRET}`, wrapped in `withCronRun('<job>', …)` (logs `cron_runs`), cursor via
  `getSyncCursor/updateSyncCursor` (advance **only** on error-free run), `maxDuration=300`, entry in
  `vercel.json`. **CRON_SECRET is a Vercel Sensitive var** (pulls as `""` locally; needs redeploy).
- **Manual sync route** — `POST` gated by `withAuth({permission})`, runs the *same* job via
  `withCronRun({trigger:'manual'})`; backfill endpoints (`/api/orders/backfill/ebay`) return a `SyncResult`
  then trigger a dashboard refresh.
- **Auth/permissions** — append to `PERMISSIONS` in `permission-registry.ts`, wrap route in `withAuth`, then
  `npm run audit-route-auth -- --emit` regenerates `docs/security/route-permissions.json` (CI `--check`).
  Audit via `recordAudit` or `withAuth` `opts.audit`.
- **Source-platform display** — `amazon` already in `SOURCE_PLATFORMS` (`src/lib/source-platform.ts:29`,
  orange-600); chips render through `OrderIdentityChips`/`getOrderPlatformLabel`. Converge display on
  `sales_orders.channel` (there's a duplicate `PLATFORM_COLORS` in `src/utils/order-platform.ts`).
- **Tenancy** — RLS on ~73 tables but **0 FORCE-enforced**, app connects as BYPASSRLS owner. New Amazon
  tables/routes **must** use `withTenantConnection`/`tenantQuery` + explicit `WHERE organization_id`.
  Multi-tenant OAuth means credentials are strictly per-org in the vault keyed by `organization_id`.

### Amazon SP-API facts (the integration surface)
- **No SigV4/IAM** since 2023-10-02 → drop any `role_arn`/`aws_*` config. LWA only.
- **OAuth (multi-tenant connect)** — the LWA **authorization-code** flow: redirect the seller to Amazon's
  consent screen with your app's `application_id` + `redirect_uri` + `state`; Amazon redirects back with a
  short-lived (~5 min) `spapi_oauth_code`; exchange it server-side
  (`POST https://api.amazon.com/auth/o2/token`, `grant_type=authorization_code`, + `client_id`/`client_secret`)
  for that seller's **refresh token**. Runtime: exchange `refresh_token` → 1-hour `access_token`, sent as
  `x-amz-access-token`. **The public OAuth flow requires a published Selling-Partner-Appstore app** (and a
  security review for restricted PII roles). **Self-authorization** (private app, click "Authorize", copy the
  refresh token) is the same end-state for *your own* account with no website — use it to bootstrap USAV
  while the public app is in review.
- **Regional hosts**: NA `https://sellingpartnerapi-na.amazon.com` (US/CA/MX/BR), EU (UK/DE/FR/…+**India**),
  FE (JP/AU/SG). US marketplace ID `ATVPDKIKX0DER`.
- **Orders API v0**: `getOrders` (list) requires `MarketplaceIds` + `CreatedAfter`|`LastUpdatedAfter`;
  paginate via `NextToken`; `getOrderItems` (`SellerSKU`, `ASIN`, qty, price) for line items.
  `FulfillmentChannel` AFN(FBA)/MFN(seller). `OrderStatus`: Pending→Unshipped→PartiallyShipped→Shipped/Canceled.
- **Rate limits**: `getOrders` is the binding constraint — **~0.0167 req/s (≈1/min), burst 20** (dynamic;
  read `x-amzn-RateLimit-Limit` at runtime, never hardcode). `getOrderItems`/`getOrder` are 0.5 req/s, burst 30.
- **PII / RDT**: buyer name/email/shipping address suppressed unless you call with a **Restricted Data Token**
  (`POST /tokens/2021-03-01/restrictedDataTokens`, `dataElements` `buyerInfo`/`shippingAddress`, 60-min TTL,
  one per batch) **and** hold the approved role (Direct-to-Consumer Delivery → address). Prefer requesting PII
  inline on `getOrders`/`getOrderItems`.

---

## 2. Architecture

```
  Owner ── "Connect Amazon" (Connections screen) ──▶ GET /api/amazon/oauth/start
                                                          │ redirect to Amazon consent
                                Amazon ◀──────────────────┘
                                   │ redirect back with spapi_oauth_code + state
                                   ▼
                          GET /api/amazon/oauth/callback ── exchange code → refresh_token
                                   │                          store per-org in vault (AES-256-GCM)
                                   ▼                          + create amazon_accounts row
                          GET /api/amazon/health  ── "connection healthy" check on the screen

   Vercel Cron (*/15) ─▶ GET /api/cron/amazon/orders-sync?mode=delta ─┐
   Admin button ──────▶ POST /api/amazon/sync (trigger:'manual')      │
                                                                       ▼
                                       ┌──────────────────────────────────────┐
                                       │   src/lib/amazon/sync.ts              │ per-account loop, watermark,
                                       │   (mirrors lib/ebay/sync.ts)          │ NextToken generator, 429 backoff
                                       └──────┬─────────────────┬─────────────┘
                       ┌──────────────────────▼──┐           ┌──▼──────────────────────────┐
                       │ src/lib/amazon/client.ts │           │ src/lib/amazon/token-refresh│
                       │ fetch + x-amz-access-tok  │           │ LWA exchange + RDT mint     │
                       │ → amazon_api_calls audit  │           │ cached in amazon_accounts   │
                       └──────────────────────────┘           └──┬──────────────────────────┘
                                                                  │ getIntegrationCredentials<AmazonCredentials>
                                                                  ▼  (per-org vault, USAV env fallback)
                       item-scope filter (SellerSKU/ASIN ∈ sku_catalog / FBA items)
                                   │  map Order → SalesOrderRow (channel='amazon')
                                   ▼
                       salesOrderRepository UPSERT → sales_orders   (NO Zoho, NO ingest queue)
                                   │  AFN(FBA) rows tagged read-only; MFN rows fetch PII via RDT
                                   ▼
                       dashboard tables (OrderIdentityChips → orange Amazon pill)
```

**No Zoho, no `OrderSyncService`, no `order_ingest_queue`** for v1. Owner wants the simplest correct path:
"importing sales orders and ensuring the API connection works." So `sync.ts` maps the Amazon Order directly
to a `sales_orders` upsert via `salesOrderRepository`. (The Zoho-coupled `ingestExternalOrder` + queue stay
available as a *later* option if Zoho mirroring is ever wanted.)

---

## 3. Data model & migrations

New migration `src/lib/migrations/2026-06-1X_amazon_integration.sql`:

1. **`amazon_accounts`** (mirror of `ebay_accounts`):
   ```
   id bigserial PK
   organization_id uuid NOT NULL
   account_name varchar           -- display label on the Connections screen
   seller_id varchar              -- Amazon Selling Partner ID (from OAuth)
   region text                    -- 'NA' | 'EU' | 'FE'
   marketplace_ids jsonb          -- ['ATVPDKIKX0DER', …]
   last_updated_watermark timestamptz   -- incremental cursor (LastUpdatedAfter)
   sync_started_at timestamptz          -- atomic-claim col (concurrency-safe cron)
   access_token text, access_token_expires_at timestamptz   -- cached LWA access token
   status text DEFAULT 'active'   -- active | error | revoked
   last_error text, last_sync_at timestamptz
   is_active boolean DEFAULT true
   created_at / updated_at timestamptz
   -- ux_amazon_accounts_org_seller (org, seller_id); idx_amazon_accounts_org (org)
   ```
   (The **refresh token** itself lives encrypted in `organization_integrations`, scope=`seller-{id}` — not here.)
2. **`amazon_api_calls`** (mirror of `ebay_api_calls`): operation, status, ms, error — per-call audit.
3. **`amazon_oauth_state`** (CSRF for the OAuth redirect): `state` (PK), `organization_id`, `created_by`,
   `region`, `expires_at`. Validated in the callback. (Or reuse an existing short-lived state store if present.)
4. **`sales_orders`** — reuse as-is. Add nullable `raw jsonb` (full SP-API payload → future v0→2026-01-01
   cutover is a mapper change) and `fulfillment_channel text` (AFN/MFN → drives the FBA read-only flag).
5. Drizzle `schema.ts`: add `amazonAccounts`, `amazonApiCalls`, `amazonOauthState` defs + types.
6. Every new table: `organization_id uuid NOT NULL`; all access via `withTenantConnection`.

---

## 4. Library / transport

**Zero-dependency direct REST** in `src/lib/amazon/client.ts`:
- `getAccessToken(account)` — POST LWA token endpoint, cache in `amazon_accounts` (5-min pre-expiry buffer).
- `callSpApi(account, {method, path, query, restricted?})` — regional host, injects `x-amz-access-token`
  (or RDT when `restricted`), reads `x-amzn-RateLimit-Limit`, retries 429/503 with exp backoff + **jitter**,
  logs to `amazon_api_calls`.
- `getOrdersGenerator(account, {lastUpdatedAfter})` — async generator looping on `NextToken`.
- `getOrderItems(account, orderId)`, `createRdt(account, dataElements)`,
  `exchangeAuthCode(code)` / `exchangeRefreshToken(...)` for the OAuth + runtime token flows.

Vendor the watermark/claim/generator *logic* (not code/PII handling) from **whitewayweb/SeplorX** and the
per-endpoint token-bucket + proactive-refresh from **dietghardev/sp-api-node-starter** (§12). Fallback if
coverage grows: Bizon `@sp-api-sdk/*` (TS-native, 429 auto-retry).

---

## 5. Sync

### Track A — ongoing incremental (`src/lib/amazon/sync.ts`, mirrors `lib/ebay/sync.ts`)
1. For each active `amazon_accounts` row (`Promise.allSettled`):
2. **Atomic claim**: `UPDATE … SET sync_started_at=now() WHERE id=$1 AND (sync_started_at IS NULL OR
   sync_started_at < now()-interval '15 min') RETURNING …` — skip if a fresh claim is held.
3. `lastUpdatedAfter = max(watermark - 15 min overlap, 30-day floor on first connect)`.
4. Page `getOrders(LastUpdatedAfter, OrderStatuses=[Pending,Unshipped,PartiallyShipped,Shipped,Canceled])`
   via the generator; honor the ~1/min budget + 429 backoff.
5. For each order: `getOrderItems`; **apply the item-scope filter** (Track B); map → `sales_orders` row;
   **upsert directly** via `salesOrderRepository` (`ON CONFLICT (reference_number) DO UPDATE`, COALESCE/NULLIF
   guards so re-fetched orders update mutable fields — status, ship date — without clobbering good data).
6. **FBA (AFN)** rows: set `fulfillment_channel='AFN'` and a read-only marker so they're excluded from
   packer/tech work queues (visibility only). **MFN** rows: mint **one RDT per batch**, fetch shipping PII
   inline, store address encrypted.
7. On full success: `last_updated_watermark = run_start`, `last_sync_at=now()`, clear `sync_started_at`.
   On failure: release claim, **don't** advance watermark (next tick replays — idempotent upsert is safe).

### Track B — item-scoped auto-import (replaces date-windowed historical backfill)
Owner: *"no need to backfill — the import should be SKU- or FBA-items-based for auto importing them."*
- Maintain the set of **tracked items** per org: `SellerSKU`s present in the SKU catalog (`sku_catalog` /
  `items`) for MFN, and tracked **FBA ASINs/SKUs** for AFN.
- The importer **auto-imports an order when any line matches a tracked SKU/FBA item**; non-matching orders are
  skipped (or parked) — this scopes the firehose to inventory we actually care about, instead of dumping years
  of history.
- On first connect, seed with a short recent window (e.g. trailing 30 days, the `getOrders` floor) filtered to
  tracked items — **not** a multi-year Reports-API pull.
- Implementation: a `matchesTrackedItem(orgId, order)` predicate consulted in Track A step 5; a config row
  (or settings flag) controls "import all" vs "tracked-items-only" (default: tracked-items-only).

> The Reports-API historical state machine from the earlier draft is **dropped** per this decision. If a true
> historical export is ever needed, `GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL` (≤30-day windows,
> cross-invocation state machine) is the documented path — kept here only as a note.

---

## 6. API routes

| Route | Method | Guard | Purpose |
| --- | --- | --- | --- |
| `/api/amazon/oauth/start` | GET | `withAuth({permission:'admin.manage_integrations'})` | mint `state`, redirect to Amazon consent (multi-tenant connect) |
| `/api/amazon/oauth/callback` | GET | state-validated (public redirect target) | exchange `spapi_oauth_code` → refresh token, store in vault per-org, create `amazon_accounts` row |
| `/api/amazon/health` | GET | `withAuth({permission:'orders.view'})` | live "connection healthy" check (LWA exchange + a cheap `getOrders` ping) for the Connections screen |
| `/api/amazon/accounts` | GET / DELETE | `withAuth({permission:'admin.manage_integrations'})` | list / disconnect accounts (status, watermark, marketplaces) |
| `/api/cron/amazon/orders-sync` | GET | `CRON_SECRET` | incremental (`?mode=delta\|full`), `withCronRun('amazon.orders_sync')` |
| `/api/amazon/sync` | POST | `withAuth({permission:'orders.sync'})` | manual incremental (same job, `trigger:'manual'`); returns `SyncResult` |

(For the USAV bootstrap, add a tiny `/api/amazon/connect` that accepts a self-authorized refresh token paste —
same vault write as the callback — so dogfooding doesn't wait on the published-app review.)

After adding permissions to `permission-registry.ts`, run `npm run audit-route-auth -- --emit` and commit the
`docs/security/route-permissions.json` diff. Add the cron path to `vercel.json` (`*/15 * * * *`). Emit audit
events with stable verbs (`integrations.amazon.connected`, `integrations.amazon.disconnected`,
`orders.amazon.synced`).

---

## 7. UI — the Connections screen (primary deliverable)
- A **Connections** surface (extend the existing `ConnectionsSidebarPanel`, or a `/settings/connections`
  Amazon card) showing per-org Amazon status: **Connect Amazon** (→ `/api/amazon/oauth/start`),
  connected account name + marketplaces + last sync, a live **health check** (→ `/api/amazon/health`),
  **Sync now** (→ `/api/amazon/sync`), and **Disconnect** (→ `DELETE /api/amazon/accounts`).
- Reuse the eBay affordances (token-expiry banner, `RefreshCw` action buttons, `useMutation` →
  `invalidateDashboardOrderQueries()` + dispatch `usav-refresh-data`).
- No `SOURCE_PLATFORMS` change (amazon registered); converge the order-row chip label/tone on
  `sales_orders.channel`.
- Multi-tenant: the screen reads/writes strictly via `ctx.organizationId`; each org sees only its own
  connection (vault rows are org-scoped).

---

## 8. Credentials & secrets
- Add `AmazonCredentials` to the `IntegrationProvider` union + `envFallback()` in
  `src/lib/integrations/credentials.ts`:
  `{ lwaClientId, lwaClientSecret, refreshToken, region:'NA'|'EU'|'FE', marketplaceIds:string[], sellerId? }`.
- DB-first per-org via `getIntegrationCredentials<AmazonCredentials>(orgId,'amazon', scope='seller-{id}')`;
  the **app-level** LWA `client_id`/`client_secret` are shared across tenants → env
  (`AMAZON_LWA_CLIENT_ID`, `AMAZON_LWA_CLIENT_SECRET`, `AMAZON_APP_ID`, `AMAZON_OAUTH_REDIRECT_URI`); only the
  per-seller **refresh token** + marketplace/region go in the vault. USAV bootstrap fallback:
  `AMAZON_SP_API_REFRESH_TOKEN_USAV`.
- **Secrets go in Vercel (Sensitive), never the git-tracked `.env`/`.env.local`** (documented hazard — don't
  stage them during this work).

---

## 9. Phased build plan (with checkpoints)

- **Phase 0 — Amazon app + role (start NOW, long lead).** Register Private developer, create the app, request
  the Direct-to-Consumer Delivery (PII) role; **and** begin the public-app/Appstore listing + security review
  needed for multi-tenant OAuth (the long pole). Self-authorize USAV to get a bootstrap refresh token.
  ✅ a `curl` LWA exchange + sandbox `getOrders` returns 200.
- **Phase 1 — Connection + verify (the owner's headline ask).** `AmazonCredentials` type + env app-creds;
  `client.ts` + `token-refresh.ts`; `amazon_accounts`/`amazon_api_calls`/`amazon_oauth_state` migration;
  `/api/amazon/oauth/start` + `/callback` + `/health` + `/connect`; the **Connections screen** card.
  ✅ owner clicks Connect → OAuth round-trip stores the per-org refresh token → health check goes green.
- **Phase 2 — Sales-order import (local-only).** `sync.ts` (claim + watermark + generator + RDT for MFN),
  Order→`sales_orders` mapper, **direct `salesOrderRepository` upsert** (no Zoho/queue); cron + manual routes;
  permissions + manifest; FBA read-only tagging. ✅ a new Amazon order appears in `sales_orders`/dashboard
  within one cron cycle; re-run produces no dupes; FBA rows don't enter work queues.
- **Phase 3 — Item-scoped auto-import.** `matchesTrackedItem` predicate (SellerSKU ∈ catalog / tracked FBA
  ASINs) + the tracked-items-only default toggle. ✅ only orders for tracked SKUs/FBA items import.
- **Phase 4 — PII + hardening.** RDT inline for MFN ship-orders + encrypted address storage/retention;
  365-day re-auth reminder; chip convergence on `sales_orders.channel`; optional v2026-01-01 mapper.

---

## Build status
- **Phase 1 BUILT (2026-06-14):** OAuth Connections screen + verify (see memory `amazon-sp-api-order-import`).
- **Phase 2 BUILT (2026-06-14):** order import, local-only.

> **Landing-table correction (verified 2026-06-14):** the original plan targeted `sales_orders`, but
> investigation proved `sales_orders` is **write-only — never read by any operational UI/route**, while the
> dashboard + queues read the legacy **`orders`** table (where eBay lands). So Amazon orders land in
> **`orders`** (visible, like eBay) + **`customers`** (the FK that already surfaces buyer/shipping address) —
> NOT `sales_orders`. One row per order (representative line item), idempotent on `idx_orders_unique_account_order`.
> FBA/AFN orders are read-only (`fulfillment_channel='AFN'`, status `shipped`, excluded from the unshipped
> to-do list); MFN shipping address goes to `customers` via RDT (best-effort, needs the approved role).

## 10. Owner decisions — LOCKED (2026-06-13)
1. **Zoho** → **None.** Local-only import into **`orders` + `customers`** (corrected from `sales_orders`; see
   build-status note above); bypass `OrderSyncService`/Zoho entirely. Primary ask = a **Connections screen to
   connect/update Amazon via OAuth for multi-tenant use** + verify the API works.
2. **PII** → **MFN-ship-only.** RDT + Direct-to-Consumer Delivery role; store shipping address encrypted.
3. **Backfill** → **None (date-based).** Auto-import is **SKU-/FBA-items-based** (Track B); seed only a short
   recent window on first connect.
4. **Fulfillment** → **Both, FBA read-only.** Import AFN+MFN; FBA excluded from packer/tech queues.
5. **Credentials** → define `AmazonCredentials` + USAV env app-creds now; build the per-org vault write
   (OAuth callback) in the same phase.
6. **Multi-seller** → `amazon_accounts` + scope-keyed vault from day one (multi-tenant OAuth requires it).

## 11. Risks & gaps
- **Multi-tenant OAuth needs a PUBLISHED Appstore app** + a security/architecture review for the restricted PII
  role — the **long pole**. Bootstrap USAV via self-authorization (the `/api/amazon/connect` paste path) so the
  Connections-screen build and order import aren't blocked while the public app is in review.
- **Rate limit is low & dynamic** — never hardcode; read `x-amzn-RateLimit-Limit`, back off with jitter.
- **"Tracked items" definition must be pinned** — exactly which table(s) define a tracked SKU (`sku_catalog`
  vs `items`) and how FBA ASINs are tracked. Note the known `items` vs `sku_catalog` SKU-collision (never join
  on the SKU string). Resolve before Phase 3.
- **PII role approval** gates RDT — without it `shippingAddress` returns null. Start in Phase 0.
- **365-day re-auth** + re-auth on any new role — operational reminder.
- **Tenancy** — RLS not enforced; org-scope every query explicitly; vault rows strictly per-`organization_id`.
- **v0 → 2026-01-01** Orders API consolidation incoming — store `raw` JSONB so cutover is a mapper change.
- **`.env` tracked secrets** — Vercel Sensitive only.

## 12. References
- **Reference repos (design only — vendor logic, not PII handling):** whitewayweb/SeplorX (Next.js + Drizzle:
  cron→worker, atomic claim, watermark+1h buffer, NextToken generator, header-driven 429 backoff,
  `(channel, externalOrderId)` upsert); awaissulhry/nexus-commerce (sibling pattern on `amazon-sp-api`);
  dietghardev/sp-api-node-starter (zero-dep TS client: per-endpoint token buckets, proactive LWA refresh);
  amz-tools/amazon-sp-api (only candidate with built-in RDT support).
- **Amazon docs:** authorize-public-applications (OAuth/`spapi_oauth_code`); self-authorization; Orders API v0
  `getorders`/`getorderitems`; Tokens API `createrestricteddatatoken`; "no longer require AWS IAM/SigV4"
  changelog; marketplace-ids; sp-api-endpoints; usage-plans-and-rate-limits.
- **In-repo templates:** `src/app/api/ebay/callback/route.ts` (OAuth callback), `src/lib/ebay/{sync,client,token-refresh}.ts`,
  `src/lib/integrations/credentials.ts`, `src/lib/billing/stripe.ts`, `src/lib/cron/run-log.ts`,
  `src/lib/source-platform.ts`, `src/components/sidebar/ConnectionsSidebarPanel.tsx`,
  `salesOrderRepository` (`sales_orders` CRUD).
