# Nango sidecar — setup & wiring

This is the operational companion to `docs/nango-additive-integration-plan.md`.
It covers standing up the self-hosted **auth + proxy** sidecar and turning on
the additive layer. Nothing in the app activates until `NANGO_SECRET_KEY` is set,
so these steps can be done whenever you're ready.

## What's already in the repo (code side, dormant)

| Piece | File |
|---|---|
| Provider registry (which app providers map to Nango keys) | `src/lib/integrations/nango-providers.ts` |
| Server seam (SDK client, connect session, proxy, token, marker) | `src/lib/integrations/nango.ts` |
| Connect-session route | `src/app/api/integrations/nango/session/route.ts` |
| Post-connect marker route | `src/app/api/integrations/nango/connected/route.ts` |
| Tenant-aware Square layer (Nango token w/ env fallback) | `src/lib/square/server.ts` |
| Admin UI OAuth connect button | `src/components/admin/IntegrationCard.tsx` (+ `IntegrationsTab.tsx`) |
| Compose for the sidecar | `docker-compose.nango.yml` |

The pilot provider is **Square** (`square` → Nango `squareup`). To add another
provider later, add one line to `NANGO_BACKED_PROVIDERS` and create the matching
integration in the Nango dashboard — nothing else.

## 1. Start the sidecar

Create `.env.nango` (gitignored — added to `.gitignore`) with:

```bash
NANGO_SERVER_URL=http://localhost:3003
NANGO_ENCRYPTION_KEY=          # openssl rand -base64 32
NANGO_DASHBOARD_USERNAME=admin
NANGO_DASHBOARD_PASSWORD=change-me
NANGO_DB_NAME=nango
NANGO_DB_USER=nango
NANGO_DB_PASSWORD=change-me
NANGO_DB_SSL=false
NANGO_CALLBACK_URL=http://localhost:3003/oauth/callback
```

Then bring it up:

```bash
docker compose -f docker-compose.nango.yml --env-file .env.nango up -d
```

Three containers come up: `nango-server` (:3003), `nango-db` (Postgres),
`nango-redis`. Syncs/Temporal/Elasticsearch are intentionally not included
(Enterprise + heavy ops; the app doesn't use them).

### `.env.nango` (sidecar) vars

| Var | Notes |
|---|---|
| `NANGO_SERVER_URL` | Public URL of the server (e.g. `http://localhost:3003` in dev) |
| `NANGO_ENCRYPTION_KEY` | base64 of 32 random bytes — `openssl rand -base64 32` |
| `NANGO_DASHBOARD_USERNAME` / `NANGO_DASHBOARD_PASSWORD` | self-host dashboard login |
| `NANGO_DB_*` | bundled Postgres, or point at a managed/Neon DB (set `NANGO_DB_SSL=true`) |
| `NANGO_CALLBACK_URL` | **publicly reachable** OAuth callback, e.g. `https://nango.yourdomain.com/oauth/callback` |

> OAuth requires the callback URL to be reachable by the provider. In dev, use a
> tunnel (you already use one for the phone/NAS flows) or run the sidecar on a
> host with a public https URL.

## 2. Configure the Square integration in Nango

1. Open the dashboard at `NANGO_SERVER_URL`, log in.
2. Create an integration with provider `squareup` (use `squareup-sandbox` for testing).
3. Paste your Square app's client id/secret and scopes; set the redirect/callback
   to match `NANGO_CALLBACK_URL`.
4. Copy the **Secret Key** from the dashboard — that's `NANGO_SECRET_KEY` for the app.

## 3. Turn on the app-side layer

Add to the Next.js app's `.env.local`:

```
NANGO_SECRET_KEY=<from the dashboard>
NANGO_HOST=http://localhost:3003                 # sidecar base URL; omit for Nango Cloud
NEXT_PUBLIC_NANGO_API_URL=http://localhost:3003  # browser Connect UI → sidecar API
# Connect UI host. Nango's cloud-hosted UI works against a self-host API; or
# self-serve the UI and point this at it:
NEXT_PUBLIC_NANGO_CONNECT_BASE_URL=https://connect.nango.dev
```

With `NANGO_SECRET_KEY` present, `isNangoConfigured()` flips true and the Square
card in **Admin → Integrations** shows **"Connect with OAuth"** instead of the
JSON-paste modal.

## 4. Connect & verify

1. Admin → Integrations → Square → **Connect with OAuth** → complete the Square OAuth.
2. On success the UI writes a marker row (no secret) via
   `/api/integrations/nango/connected`; the card flips to `active`.
3. The connection is keyed per tenant: end-user `org_<orgId>`, `organization.id =
   orgId`. Tokens live in the sidecar and auto-refresh.

## 5. Route Square calls through Nango (final, optional step)

Today the walk-in routes call the env-based `squareFetch()` / `getSquareConfig()`
directly — unchanged and still working. To make a route tenant-aware, swap:

```ts
// before (env, single-tenant)
import { squareFetch } from '@/lib/square/client';
const res = await squareFetch('/locations');

// after (Nango token when connected, env fallback otherwise)
import { squareFetchForOrg } from '@/lib/square/server';
const res = await squareFetchForOrg(ctx.organizationId, '/locations');
```

`resolveSquareConfig(orgId)` uses the Nango token if the org has connected Square,
else falls back to env — so flipping a route over is safe before/after the sidecar
is live.

> **Known follow-up:** `buildSquareConfig` takes the access token from Nango but
> still reads `locationId`/version/currency from env. True per-tenant location
> handling (fetch `/v2/locations` per connection, or store it on the marker) is a
> follow-up before non-USAV tenants use Square location-dependent endpoints.

## Rollback

Remove `NANGO_SECRET_KEY` (and the Square row) → everything falls back to the
hand-built env path. Remove `square` from `NANGO_BACKED_PROVIDERS` to hide the
OAuth button entirely. `docker compose -f docker-compose.nango.yml down` stops the
sidecar.
</content>
