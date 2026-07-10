# Integrations: OAuth Connection Framework + Connection-Driven Ingestion

**Status:** ~60% SHIPPED (re-verified 2026-07-09; "Plan" was stale) — connector framework
(`src/lib/integrations/connectors/{registry,types,orchestrator,connections}.ts` over all providers),
connection-driven sync (`/api/cron/integrations/sync` + per-provider Sync-now + IntegrationCard
button), vault entitlements (`maxIntegrations` at `connections.ts`), Zoho global-KV → per-tenant
vault migration (`zoho/core.ts` reads `organization_integrations`). Residual code gaps (2026-07-09
verification): entitlement guard on connect paths, unified token-refresh sweep,
`connector.validate()` beyond google_drive, `reconcile()` first impls, operational columns
(`last_synced_at`/`sync_cursor`) + writeback, Ecwid connection-driven sync, OrdersSyncPopover
retirement. Originally: Plan (2026-06-14).

## 0. The honest reframe

A lot of this already exists. The goal is **not** "add OAuth" — it's to turn the scattered, button-triggered sync into a single **Connection** model that lives in settings and *drives* ingestion.

**What already exists (reuse, don't rebuild):**
- `/settings/integrations` page + `registry.ts` (13-provider catalog) + `IntegrationCard` + `AmazonConnectModal` + `ResultBanner`.
- Per-tenant **encrypted vault**: `organization_integrations` (AES-256-GCM via `INTEGRATION_KMS_KEY`), `getIntegrationCredentials/upsert/delete` + 5-min cache (`src/lib/integrations/credentials.ts`, `crypto.ts`).
- **Real OAuth** already built: eBay (`/api/ebay/connect`+`/callback`+refresh cron + `ebay_accounts`), Amazon SP-API/LWA (`/api/amazon/oauth/start`+`/callback`+`amazon_accounts`), Zoho (`/api/zoho/oauth/authorize`+`/callback`). Encrypted `state` per flow.
- **Nango seam** built (`nango.ts`, `nango-providers.ts`, `/api/integrations/nango/{session,connected}`) — Square pilot wired, sidecar not yet deployed.
- Admin vault CRUD (`/api/admin/integrations/{list,upsert,delete}`), health checks (`/api/{amazon,zoho}/health`).
- Entitlement `plans.ts.maxIntegrations` (trial 2 / starter 3 / growth 8 / pro+ ∞), counted = **distinct provider rows**.

**The actual gaps (this plan):**
1. **No connector abstraction** — each provider's OAuth/sync is bespoke; no shared contract.
2. **Ingestion is button-driven, decoupled from connections** — `OrdersSyncPopover` "Import Latest Orders" → `POST /api/google-sheets/transfer-orders` + `/api/ecwid/transfer-orders`; Backfill tab → `/api/orders/backfill/ebay|ecwid`. A connected provider doesn't *automatically* sync; you click buttons.
3. **Provider OAuth gaps** — Ecwid, Stripe, Google Sheets are **env-key/vault only** (no OAuth); Zoho tokens live in **global Upstash KV, not per-tenant** (multi-tenant hole).
4. **Entitlements unenforced** — `maxIntegrations` is defined but no guard at connect time.
5. **No connection→catalog mapping** — connections aren't tied to `platform_accounts` (per the platform-catalog plan).

---

## 1. Target architecture

### 1.1 The `IntegrationConnector` contract (new — the unifying layer)
A per-provider connector, registered alongside the existing `registry.ts`, defining a uniform surface:
```ts
interface IntegrationConnector {
  provider: IntegrationProvider;
  authKind: 'oauth' | 'nango' | 'vault';
  capabilities: Array<'orders' | 'inventory' | 'tracking' | 'payments'>;
  // OAuth
  buildAuthorizeUrl?(ctx): string;          // wraps encrypted state (org + scope + PKCE)
  exchangeCode?(code, state): TokenEnvelope; // → stored in vault
  refresh?(conn): TokenEnvelope;            // token rotation
  // All kinds
  validate(conn): HealthResult;             // replaces ad-hoc /health routes
  sync?(conn, opts): SyncResult;            // connection-DRIVEN ingestion (replaces transfer buttons)
}
```
- eBay/Amazon/Zoho connectors **wrap the existing routes/clients** (no behavior change, just a contract).
- `TokenEnvelope` standardizes `{ accessToken?, refreshToken?, expiresAt, scopes[], accountRef? }` inside the encrypted `payload`.

### 1.2 Connection storage — extend `organization_integrations` (minimal)
Keep the table as the SoT; add operational columns:
```sql
ALTER TABLE organization_integrations
  ADD COLUMN IF NOT EXISTS capabilities  text[]        DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS enabled       boolean       NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS expires_at    timestamptz,   -- denorm of token expiry for the refresh sweep
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS sync_cursor   jsonb;          -- incremental watermark per connection
```
(Multi-account providers stay modeled via `ebay_accounts`/`amazon_accounts` + `scope`; this plan does not change that.)

### 1.3 Standardized OAuth flow
- Shared helper `src/lib/integrations/oauth.ts`: encrypted `state` (org + scope + nonce), **PKCE** where supported, scope-minimization per connector, single callback contract → redirect `/settings/integrations?status=<provider>_connected|error`.
- Migrate eBay/Amazon/Zoho callbacks to call the shared helper (keeps their provider-specific token exchange, removes copy-pasted state/redirect logic).

### 1.4 Unified token lifecycle
- One **refresh sweep** cron (`/api/cron/integrations/refresh`) iterating `organization_integrations WHERE expires_at < now()+interval '30 min' AND enabled` and calling `connector.refresh()`. Subsumes the per-provider eBay/Amazon refresh crons over time.
- `withFreshConnection(orgId, provider)` helper: refresh-before-use guard for callers.

### 1.5 Connection-DRIVEN ingestion (the headline change)
- A `sync()` capability on connectors with `capabilities: ['orders']`.
- **Sync orchestrator** `/api/cron/integrations/sync` runs `connector.sync()` for every `enabled` orders-capable connection (incremental via `sync_cursor`), replacing the manual transfer crons.
- **"Sync now"** per connection card → `POST /api/integrations/[provider]/sync` (streams progress like the current NDJSON popover).
- The `OrdersSyncPopover` "Import Latest Orders" / Backfill buttons become **per-connection actions on the card** (or a thin shim that calls the new sync), then are retired.

### 1.6 Entitlement enforcement
- At connect/upsert: count distinct active providers; if `>= entitlementsForPlan(org.plan).maxIntegrations` (and not unlimited `0`), block with `INTEGRATION_LIMIT` + an "upgrade to add more" CTA on the card.
- Surface "**X of N integrations used**" in the settings header.

### 1.7 Multi-tenancy & security (mostly already satisfied)
- All connection reads/writes org-scoped (vault already is). Keep encryption at rest. Call `invalidateCredentialCache()` after every mutation.
- **Deprecate the USAV-only env fallback** as tenants onboard (it's transitional).
- **Migrate Zoho off global Upstash KV → per-tenant `organization_integrations`** (closes a real cross-tenant hole).
- Map a connection to a `platform_account` via `integration_scope` (platform-catalog plan) so ingestion flows through `type_id`.

---

## 2. Per-provider gap matrix

| Provider | Today | This plan |
|---|---|---|
| **eBay** | OAuth ✅ + refresh ✅; orders via backfill/sync | Wrap in connector; make order sync **connection-driven** (cron + Sync now). *Highest v1 value.* |
| **Amazon** | OAuth ✅ + refresh ✅; live cron ✅ | Wrap in connector; fold its cron into the unified sweep. |
| **Zoho** | OAuth ✅ but token in **global KV** | Wrap; **migrate token KV → per-tenant vault**. |
| **Square** | Nango seam ✅, sidecar not deployed | Finish Nango pilot (deploy sidecar); add `sync()`. |
| **Ecwid** | **env-key only**, no OAuth | Add OAuth connector (Ecwid has an OAuth app model) or per-tenant token-vault; connection-drive its order sync. |
| **Stripe** | vault ✅ (per-tenant) | No user-OAuth needed for billing; (Stripe **Connect** only if we ever resell payments). Leave as vault. |
| **Google Sheets** | service-account vault | Keep service-account (no user OAuth); make per-tenant; sync stays optional/import-lane. |
| **UPS/FedEx/USPS, Zendesk, Ably, Ollama** | vault | Hand-built forever (Nango doesn't cover carriers); standardize as `authKind: 'vault'` connectors. |

---

## 3. Settings UX (extend `IntegrationCard`)
Per connection card: **status pill** · account(s) + scopes · **capability badges** (Orders / Inventory / Tracking) · **last synced** · **Sync now** (streamed progress) · **Health** · **Reconnect** · **Disconnect** · enable/disable toggle. Header shows "X of N integrations used → Upgrade". Connect flow branches by `authKind` (redirect / paste / Nango Connect) — already the case.

---

## 4. Phased rollout (each phase = a checkpoint)

- **Phase 0 — Connector contract (no behavior change).** Define `IntegrationConnector` + wrap eBay/Amazon/Zoho/vault providers; standardize `TokenEnvelope`. Ship behind the existing UI. ✅ when the 3 OAuth providers connect/refresh through the connector with zero UX change.
- **Phase 1 — Connection-driven order sync (pilot: eBay).** Add `sync()` + the orchestrator cron + "Sync now"/"last synced" on the eBay card; keep the old buttons as fallback. ✅ when connecting eBay auto-ingests orders on cron + Sync now, no popover needed.
- **Phase 2 — Entitlement enforcement + UX.** `maxIntegrations` guard at connect, "X of N used" + upgrade CTA, capability badges. ✅ when a trial org is blocked at 3 and prompted to upgrade.
- **Phase 3 — Close provider gaps.** Square (Nango sidecar live), Ecwid OAuth, Zoho KV→per-tenant. ✅ each provider connects + syncs per-tenant.
- **Phase 4 — Retire ad-hoc buttons + catalog wiring.** Remove `OrdersSyncPopover` transfer/backfill; map connections → `platform_accounts` → `type_id`. ✅ when ingestion is 100% connection-driven.

---

## 5. Risks / open decisions
- **Nango sidecar hosting** (3 containers; not Vercel-native) + **ELv2 license** — run as a service, never copy `providers.yaml`. Decide host (Fly/Render/Docker) before Phase 3.
- **Zoho multi-tenant token migration** — global KV → per-tenant is a data move; sequence carefully.
- **Scope vs v1 tier.** For the **Starter "Tracker"** v1, only **eBay live order sync + the import lane** are on the critical path. Phases 0–1 (eBay) deliver that; Phases 2–4 are post-v1 hardening. Don't let the full framework block the tracker.
- **`maxIntegrations` depends on live billing** (Stripe catalog) — already in place; enforcement is read-only against `org.plan`.

---

## 6. Files this touches (anchor list)
- Reuse: `src/app/settings/integrations/{page,IntegrationCard,registry}.tsx`, `src/lib/integrations/{credentials,crypto,nango,nango-providers}.ts`, `organization_integrations` schema.
- New: `src/lib/integrations/connectors/*` (per-provider), `src/lib/integrations/oauth.ts` (shared flow), `/api/integrations/[provider]/sync`, `/api/cron/integrations/{refresh,sync}`, migration for the new `organization_integrations` columns.
- Retire (Phase 4): `OrdersSyncPopover` transfer/backfill buttons, per-provider transfer-orders endpoints (or shim to connectors).
