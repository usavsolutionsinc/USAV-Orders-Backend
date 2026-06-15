# eBay account connect (Settings → Integrations)

Lets a workspace connect one or more eBay **seller accounts** by signing in to eBay
and granting consent. Server-side OAuth (Authorization Code Grant); tokens never
reach the client.

This was a **hardening pass** over an existing implementation, not a greenfield
build. What was added/fixed in this pass:

- **Scope + environment SoT** — `src/lib/ebay/oauth-config.ts`. Consent and refresh
  now request the **same** scopes, and the token endpoint is chosen by environment
  (the refresh path previously hardcoded the production endpoint, so sandbox refresh
  was broken).
- **Per-tenant / shared-app credentials** — `src/lib/ebay/credentials.ts`
  (`getEbayAppCreds`). No `process.env` reads in the connect/callback/client/refresh
  paths.
- **CSRF** — encrypted `state` (carries tenant + nonce) **plus** an httpOnly
  cookie holding the same nonce, validated on callback, with a 10-minute TTL.
- **Per-org uniqueness** — `UNIQUE (organization_id, account_name)` so one org can't
  overwrite another's row (migration `2026-06-14e`).
- **Declined-consent**, **refresh-failure → needs-reconsent**, a **health** endpoint,
  and **per-account disconnect** (step-up; eBay has no revoke API, so delete = revoke).
- **Encryption-at-rest hard-fail** in production when `INTEGRATION_KMS_KEY` is unset.

## Tenancy model

**Shared eBay app, many sellers.** One eBay developer app + RuName (USAV/CycleForge's)
that every tenant's sellers grant consent to. App-level credentials resolve to the
org's own `organization_integrations` row if present (future BYO app), otherwise the
shared env app. Only the per-seller **tokens** are per-tenant (`ebay_accounts`).

## OAuth flow

1. `GET /api/ebay/connect?accountName=<label>` (auth: `integrations.ebay`) — resolves
   app creds, mints a nonce, encrypts `state = { organizationId, accountName,
   environment, createdBy, nonce, issuedAt }`, sets the `ebay_oauth_state` httpOnly
   cookie, and 302s to `https://auth[.sandbox].ebay.com/oauth2/authorize`.
2. eBay shows consent → redirects to the **RuName**, which must point at
   `GET /api/ebay/callback` (no auth — identity comes from `state`).
3. Callback validates: declined-consent (`?error=`), missing params, decryptable
   state, required fields, TTL, and **cookie nonce === state nonce**; exchanges the
   code (Basic `base64(appId:certId)`) at the env-matched token endpoint; probes the
   identity API for the eBay user id; writes tokens via `writeEbayToken` (KMS-aware);
   upserts `ON CONFLICT (organization_id, account_name)`; audits
   `integrations.ebay.connected`; redirects to `/settings/integrations?success=ebay_connected`.

## eBay Developer Portal setup

The **RuName** is a registered redirect name, **not** a literal URL. Per environment:

| Environment | Authorize host | Token host | RuName accept URL must point at |
|---|---|---|---|
| Production  | `auth.ebay.com` | `api.ebay.com/identity/v1/oauth2/token` | `https://<prod-domain>/api/ebay/callback` |
| Sandbox     | `auth.sandbox.ebay.com` | `api.sandbox.ebay.com/identity/v1/oauth2/token` | `https://<preview-or-tunnel-domain>/api/ebay/callback` |

Register a **separate RuName per environment**; set its accept/decline/privacy URLs in
the portal. The app must be approved for every scope requested (see below).

## Scopes

Default (`src/lib/ebay/oauth-config.ts`):

```
https://api.ebay.com/oauth/api_scope
https://api.ebay.com/oauth/api_scope/sell.inventory
https://api.ebay.com/oauth/api_scope/sell.fulfillment
https://api.ebay.com/oauth/api_scope/sell.account
```

`sell.finances` is **not** default (needs separate eBay approval). Override the whole
set via the `EBAY_SCOPES` env var (space-separated) once approved — no redeploy of code.

## Environment variables

| Var | Purpose |
|---|---|
| `EBAY_APP_ID` | OAuth client_id (eBay "App ID"). Shared app. Vercel **Sensitive**. |
| `EBAY_CERT_ID` | OAuth client_secret (eBay "Cert ID"); Basic-auth on token calls. **Sensitive**. |
| `EBAY_RU_NAME` | The registered RuName used as `redirect_uri` (per environment). |
| `EBAY_ENVIRONMENT` | `PRODUCTION` (default) or `SANDBOX`. |
| `EBAY_SCOPES` | Optional space-separated scope override. |
| `INTEGRATION_KMS_KEY` | base64 32-byte AES-256-GCM key. **Required in production** — tokens + OAuth state are stored plaintext without it (dev only). Generate: `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"` |
| `CRON_SECRET` | Bearer secret for the hourly refresh cron (`/api/cron/ebay/refresh-tokens`). |
| `EBAY_REFRESH_TOKEN_USAV` | Transitional USAV bootstrap refresh token (env fallback only). |

## Background refresh

`/api/cron/ebay/refresh-tokens` (hourly, in `vercel.json` + `src/lib/cron/registry.ts`)
runs `runEbayRefreshTokensJob`: refreshes tokens expiring within 30 min using each
account's org app creds + environment. A dead/expired refresh token deactivates the
account (`is_active=false`) and marks the integration in error so the card prompts a
reconnect.

## Manual sandbox test checklist

1. Set `EBAY_ENVIRONMENT=SANDBOX`, sandbox `EBAY_APP_ID/CERT_ID/RU_NAME`, and
   `INTEGRATION_KMS_KEY`; point the sandbox RuName at `…/api/ebay/callback`.
2. Settings → Integrations → eBay → **Connect**, enter a label, sign in to the
   sandbox seller account, grant consent.
3. Expect redirect to `…?success=ebay_connected`, a success toast, and the account
   in the card with a token-expiry detail.
4. **Check** → healthy. **Refresh** (per-account) → success.
5. **Cancel** consent on a second attempt → `?error=ebay_consent_declined` banner.
6. **Disconnect** (Trash) → account removed (step-up required for non-admins).
7. `npm run test:ebay` (scope/env SoT) and `npm run audit-route-auth:check`.
