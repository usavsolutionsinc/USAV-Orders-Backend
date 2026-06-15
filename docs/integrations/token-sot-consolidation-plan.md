# OAuth Token SoT Consolidation Plan

**Status:** Phase 0–4 BUILT (Zoho) · **Created:** 2026-06-14 · **Owner:** TBD

> ## Implementation log (2026-06-14)
>
> The Zoho cutover (Phases 0–4) is implemented at the client + credential layer.
> USAV **uses both**: `loadZohoCredentials(orgId)` resolves the per-tenant vault
> first (the SoT), then falls back to the legacy path. The SoT switch is
> transparent with **no data migration required** to stay live.
>
> > **Correction (important).** An earlier assumption that `envFallback('zoho')`
> > alone reproduces the old behavior was WRONG: the durable refresh token lives
> > in `ebay_accounts.ZOHO_MAIN` (a DB row), and `ZOHO_REFRESH_TOKEN` env is
> > empty in prod — so a plain env fallback returns no token and would break
> > USAV. Fix: `core.ts` has a USAV-only **legacy bridge**
> > (`loadLegacyZohoCredentials`) = env client id/secret + Zoho org id/DC, with
> > the refresh token from `ZOHO_REFRESH_TOKEN` env **or** `ebay_accounts.ZOHO_MAIN`.
> > Resolution = vault → legacy bridge → `ZohoNotConnectedError`.
> >
> > **Vault-first shadows a broken row.** A decryptable-but-invalid vault row
> > wins over the working legacy path (env fallback only triggers on a *missing*
> > row, not a *bad* one). So the vault row must be written from creds that
> > actually mint — i.e. run `migrate-zoho-to-vault.ts` with **prod** env (its
> > client id/secret must match the refresh token), or just connect Zoho via the
> > OAuth flow in prod. The migration now does a **token-mint check and refuses
> > to write** a non-minting row. A local test write (built from mismatched local
> > `ZOHO_CLIENT_ID`) was applied then reverted — net-zero on the DB.
>
> **Built:**
> - `src/lib/zoho/url.ts` (new) — pure, dependency-free URL/data-center helpers; unit-tested (`src/lib/zoho/url.test.ts`, `npm run test:zoho-url`).
> - `src/lib/zoho/tenant-context.ts` (new) — `withZohoOrg(orgId, fn)` + `currentZohoOrgId()` ambient Zoho-tenant binding (AsyncLocalStorage), captured **synchronously at the client entry points** before the rate-limiter queue.
> - `src/lib/zoho/core.ts` (rewrite) — vault-backed, org-aware: `loadZohoCredentials(orgId)` (vault → USAV legacy bridge), `getAccessToken(orgId, creds?)`, `invalidateAccessToken(orgId)`, `ZohoNotConnectedError`. Durable refresh token from the vault or the legacy `ebay_accounts`/env bridge; short-lived access token cached **in-process per org** (cache, not SoT — a cold start re-mints it).
> - `src/lib/zoho/httpClient.ts` — `orgId` threaded through `zohoGet/Post/Put/Delete/paginateZohoList` (default `currentZohoOrgId()`) → `scheduleRequest` → `performZohoRequest`; creds loaded once per request, URL built with the tenant's Zoho org id + DC.
> - `src/app/api/zoho/oauth/callback/route.ts` (rewrite) — resolves the connecting tenant from the session, discovers the Zoho `organization_id` via `/inventory/v1/organizations`, and writes the encrypted vault row (`provider='zoho'`); `assertIntegrationKmsConfigured` blocks plaintext in prod.
> - `src/app/api/zoho/refresh-token/route.ts`, `src/app/api/zoho/items/[id]/image/route.ts` — updated to the new org-aware signatures.
> - `src/lib/zoho-kv.ts` (**deleted**) — the plaintext `ebay_accounts.ZOHO_MAIN` token store is retired (kills the `ON CONFLICT (account_name)` latent bug too).
> - `scripts/migrate-zoho-to-vault.ts` (new) — Phase 4 data migration (dry-run default; `--apply`).
> - `npx tsc --noEmit` clean; `test:zoho-url` + `test:zoho-fulfillment` green.
>
> **Decision change vs §5:** the request choke point is `httpClient.ts` (not
> `zoho.ts`), and threading `orgId` to all ~150 call sites at once was avoided in
> favor of a Zoho-local ambient binding captured at the entry points. This keeps
> the 150 sites + ~30 wrapper functions **unchanged** (they default to USAV).
> The DB tenancy model stays explicit (`withTenantConnection`); this binding is
> Zoho-credential-only.
>
> **Phase 3 UI — DONE (2026-06-14):** the Settings → Connections Zoho card
> (`PROVIDER_CATALOG` key `'zoho'`, `connect: 'oauth'`) works end-to-end on the
> vault: card → `/api/zoho/oauth/authorize` (302 consent) → the rewritten vault
> callback → tenant-aware `/api/zoho/health` (now actually verifies THIS org's
> connection + mints a token, no secrets returned) → disconnect via the generic
> `/api/admin/integrations/delete` (vault row delete). It rides the shared
> connector UI — no Zoho-specific UI was needed.
>
> **Remaining (deliberately deferred — needs schema work; do NOT rush onto the
> live receiving path):**
> - **Phase 1 tail + deep sync attribution** — wrap the 3 Zoho crons
>   (`/api/cron/zoho/*`) in `withZohoOrg(orgId, …)` over connected orgs and thread
>   `orgId` into `syncZohoPoMirror` / `syncZohoPurchaseOrdersToReceiving` /
>   `syncShippedOrdersToZoho` for DB-write attribution. BLOCKERS first:
>   `zoho_po_mirror` has **no `organization_id` column** (the mirror is global —
>   needs a migration + reconcile scoping); the receiving-sync bulk writes use the
>   plain pool (need `withTenantConnection`, not just the one `USAV_ORG_ID` literal
>   at `zoho-receiving-sync.ts:119`). Safe while USAV is the only connected tenant;
>   **must land before a 2nd org connects Zoho**, else its POs write into USAV's
>   global mirror.
> - **Phase 4 run** — execute `scripts/migrate-zoho-to-vault.ts --apply` in prod
>   (ops; needs prod DATABASE_URL + INTEGRATION_KMS_KEY).
> - **Phase 5** — after prod-verifying the vault row, remove the `'zoho'` arm of
>   `envFallback`, the `loadLegacyZohoCredentials` bridge (+ its `ebay_accounts`
>   read), and the `ZOHO_*` env reads.
> - **Follow-up** — `google_oauth_tokens` (`google_photos`/`po_gmail`) onto the vault.


Make **`organization_integrations` the single source of truth** for every
integration credential — one encrypted, per-org row per `(organization_id,
provider, scope)` — and retire the legacy token homes that predate
multi-tenancy. Zoho is the flagship cutover because it is the worst case today
(plaintext, global singleton, org bound to an env var).

Related: [[integrations-oauth-connection-plan]] · [[ebay-connect-hardening]] ·
[[multi-tenancy-hardening-prompt]] · `docs/integrations/zoho.md` ·
`docs/integrations/ebay-connect.md` · `docs/integrations/amazon.md`

---

## 1. The problem: tokens live in four places with three org models

A DB scan (2026-06-14) found four distinct credential homes:

| Table | Holds | org_id? | Encrypted? | Multi-account? | Verdict |
|---|---|---|---|---|---|
| **`organization_integrations`** | eBay, Zoho, Amazon refresh token, Square, UPS, FedEx, USPS, Zendesk, Sheets, Ably, Ollama, Stripe | ✅ `NOT NULL` FK + RLS | ✅ AES-256-GCM | ✅ via `scope` | **The intended SoT** |
| **`ebay_accounts`** | eBay rows **+ singleton `ZOHO_MAIN`** | ⚠️ added 2026-05-24, defaults to USAV org | ❌ **plaintext** | keyed on `account_name` | Legacy; Zoho still reads here |
| **`google_oauth_tokens`** | `google_photos` + `po_gmail` refresh tokens | ❌ none — global singleton | ❌ plaintext | one row / provider | Legacy; follow-up |
| **`amazon_accounts`** | Amazon per-account metadata + cached access token | ✅ GUC-defaulted | refresh token in vault | ✅ | Already correct |

**Decision:** `organization_integrations` is the SoT. Amazon already models the
target correctly (metadata table + secret in the vault, `scope='seller-{id}'`).
Everything else converges on it.

---

## 2. Why the vault is already the right SoT (and mostly built)

`src/lib/integrations/credentials.ts` already provides the full surface:

- `ZohoCredentials = { clientId, clientSecret, refreshToken, orgId, domain? }`
  — the per-tenant Zoho shape, **including the Zoho org id and data center**,
  which today live only in env vars.
- `getIntegrationCredentials(orgId, provider, { scope })` — per-org lookup,
  in-memory cache, decrypts payload, **falls back to env vars for the USAV org
  only** (`orgId === USAV_ORG_ID`). This is the cutover seam.
- `upsertIntegrationCredentials(...)` / `markIntegrationError(...)` — write side
  with cache invalidation.
- `provider` union already includes `'zoho'`.

So this is **not** a "build a vault" task. It is a "rewire the Zoho runtime onto
the existing vault and migrate the one live row" task.

---

## 3. The structural blocker: the Zoho client is process-global

`src/lib/zoho/core.ts` sources everything from module-level env constants and
zero-arg functions:

```
ZOHO_ORG_ID / ZOHO_DOMAIN / ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET   // module consts
getAccessToken()            // no orgId arg
getInventoryBaseUrl()       // no orgId arg — builds ?organization_id=<env>
getZohoRefreshTokenFromKv() // SELECT ... WHERE account_name='ZOHO_MAIN' (no org filter)
setZohoTokens()             // upsert ZOHO_MAIN, plaintext, ON CONFLICT (account_name)
```

Because the org is a module constant and no function takes an `orgId`, the client
is physically incapable of serving two tenants. **Threading `orgId` through the
Zoho client surface is the core of this work** — the storage swap is the easy
half.

---

## 4. Target architecture

```
Caller (API route, cron)
  │  withTenantConnection → has orgId
  ▼
ZohoClient(orgId)                         ← new: org-scoped instance/factory
  │  getIntegrationCredentials(orgId,'zoho')   ← vault SoT (env fallback: USAV only)
  ▼
organization_integrations                 ← SINGLE SoT
  row: (orgId, 'zoho', scope=null)
  payload(encrypted) = ZohoCredentials {
    clientId, clientSecret, refreshToken,
    orgId:  <zoho org id>,    ← was ZOHO_ORG_ID env
    domain: <zoho dc>         ← was ZOHO_DOMAIN env
  }
```

Cached **access** tokens (short-lived, 1h) may stay in a per-org metadata row
(mirror of `amazon_accounts.access_token`) or be re-minted from the refresh
token on demand. Refresh token + org id + dc = the durable secret = vault only.

---

## 5. Phased plan

### Phase 0 — Guardrails (no behavior change)
- Add a regression test asserting `getIntegrationCredentials(USAV_ORG_ID,'zoho')`
  returns the env-fallback shape, so the cutover seam is pinned before we move.
- **Fix the latent upsert bug:** `zoho-kv.ts` uses `ON CONFLICT (account_name)`,
  but `2026-06-14e_ebay_accounts_org_account_unique.sql` dropped the
  `account_name`-only unique and replaced it with `(organization_id,
  account_name)`. Verify the next Zoho token refresh doesn't throw
  `there is no unique or exclusion constraint matching the ON CONFLICT`. If the
  migration is applied in prod, this is already broken — fix first.

### Phase 1 — Thread `orgId` through the Zoho client
- Convert `zoho/core.ts` from module-global functions to an org-scoped factory:
  `createZohoClient(orgId)` (or pass `orgId` to `getAccessToken` /
  `getInventoryBaseUrl` / request helpers).
- Source `clientId/clientSecret/refreshToken/orgId/domain` from
  `getIntegrationCredentials(orgId,'zoho')` instead of env constants.
- Update every caller in `src/lib/zoho.ts` and the `src/app/api/**` routes /
  crons that call Zoho to pass their tenant `orgId` (they already run under
  `withTenantConnection`/`tenantQuery`, so the orgId is in scope).

### Phase 2 — Move token persistence into the vault
- `setZohoTokens` → write the refresh token via `upsertIntegrationCredentials`.
  Cache the short-lived access token in a per-org metadata column (new
  `zoho_accounts` table mirroring `amazon_accounts`, **or** reuse the existing
  `ebay_accounts` row keyed by `(org, 'ZOHO_MAIN')` strictly as an access-token
  cache — refresh token no longer stored there).
- `clearZohoTokens` / `invalidateAccessToken` → `markIntegrationError` +
  `invalidateCredentialCache`.

### Phase 3 — OAuth connect flow writes the vault
- `/api/zoho/oauth/*` callback persists `{ clientId, clientSecret, refreshToken,
  orgId, domain }` for the **current tenant** via `upsertIntegrationCredentials`,
  with `display_label` = "Connected as <zoho org name>" and `created_by` = staff
  id. This is the admin-consent flow from `docs/integrations/zoho.md`.
- Surface Zoho on the Settings → Connections screen alongside eBay/Amazon
  (`src/app/settings/integrations/`).

### Phase 4 — Data migration (one row)
- Migration: read the live `ebay_accounts.ZOHO_MAIN` refresh token + the
  deployment's `ZOHO_ORG_ID`/`ZOHO_DOMAIN`, encrypt as `ZohoCredentials`, and
  `INSERT` into `organization_integrations (USAV_ORG_ID, 'zoho', …)`.
  Idempotent; skip if a row already exists.

### Phase 5 — Retire the legacy path
- Keep the USAV-only env fallback in `credentials.ts` as the safety net through
  one deploy cycle, then remove the module-level `ZOHO_*` constants from
  `core.ts`.
- Strip the Zoho refresh-token responsibility out of `zoho-kv.ts` /
  `ebay_accounts`. Drop the `ZOHO_MAIN` seed once nothing reads it.

### Follow-up (separate PR) — `google_oauth_tokens`
- `google_photos` + `po_gmail` are global singletons with no org. Same pattern:
  add providers `'google_photos'` / `'po_gmail'` to the vault union and migrate.
  Lower priority — these are USAV-internal, not tenant-facing.

---

## 6. Risks & gotchas

- **`pool` bypasses RLS.** `zoho-kv.ts` and `credentials.ts` use the plain
  `pool` (→ `neondb_owner`, which has `BYPASSRLS` per
  [[multi-tenancy-hardening-prompt]]). Per-org isolation here depends on the
  **explicit `WHERE organization_id = $1`**, not on RLS. Every vault read/write
  must pass the orgId explicitly — do not assume the policy protects you.
- **`ON CONFLICT (account_name)` mismatch** — see Phase 0.
- **Env fallback is USAV-only by design.** A second tenant with no vault row gets
  `null` (correct — forces them to connect), but make sure error messaging points
  to the connect flow, not a generic 500.
- **Access-token cache contention.** If two crons refresh concurrently, last
  write wins; acceptable (Zoho refresh is idempotent), but mirror Amazon's
  atomic-claim column if it becomes an issue.

---

## 7. Definition of done

- A second org can connect its own Zoho account and import/receive without any
  env var change; USAV continues working via the vault row (env fallback removed).
- No refresh token is stored in plaintext or outside `organization_integrations`.
- `ZOHO_ORG_ID` / `ZOHO_DOMAIN` / `ZOHO_REFRESH_TOKEN` env vars are no longer
  read at runtime (kept only as optional bootstrap for the migration).
- `grep -rn "ZOHO_MAIN"` returns nothing in runtime code.
