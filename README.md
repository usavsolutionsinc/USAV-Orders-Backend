# USAV Orders Backend

Multi-tenant operations platform for order, warehouse, and fulfilment
workflows. Originally built for USAV Solutions Inc as a single-tenant
internal tool; now also runs as a public SaaS where each customer is a
tenant with isolated data, integrations, billing, and feature flags.

This repository is a Next.js (App Router) application that combines:
- Warehouse/station dashboards (tech, packer, receiving, support, admin)
- PostgreSQL data storage (Neon/Postgres) with multi-tenant scoping
- Per-tenant integration credential vault (AES-256-GCM)
- Stripe billing + entitlement gating
- Self-service signup at `/signup` and per-staff PIN signin at `/signin`
- Google Sheets sync pipelines
- eBay, Ecwid/Square, Zendesk, and Zoho integrations

## What Changed (Current State)

The previous README described an older "task templates + tags + daily checklist" system as the primary workflow.

The current codebase is centered on:
- `orders` as the main record for fulfillment status
- `tech_serial_numbers` for test/serial capture
- `packer_logs` for packing scan/history records
- `orders_exceptions` for unmatched scans and exception tracking
- station-specific dashboards and details panels
- cache helpers (`staffCache`, `staffGoalsCache`, `receivingCache`) and newer shipped-details UI blocks

## Tech Stack

- Next.js 16 (App Router)
- React 19
- TypeScript
- Tailwind CSS
- Framer Motion
- TanStack Query
- PostgreSQL + `pg` + `postgres`
- Drizzle ORM + Drizzle Kit
- Google APIs (`googleapis`)
- eBay API SDK
- Upstash Redis (optional cache)

## Routes (UI)

- `/` -> redirects to `/dashboard`
- `/dashboard`
- `/receiving`
- `/repair`
- `/sku-stock`
- `/tech/[id]`
- `/packer/[id]`
- `/support`
- `/previous-quarters`
- `/admin`

Sidebar navigation is defined in `src/lib/sidebar-navigation.ts`.

## API Surface (High-Level)

The app has many route handlers under `src/app/api`. Core groups include:

- `orders/*`: assignment, verification, lifecycle, backfill
- `shipped/*`: shipped listing/search/details/submit/debug
- `tech/*` + `tech-logs/*`: scan tracking/SKU/FNSKU, serial add/update/delete, undo, logs
- `packerlogs` and `packing-logs/*`: packer scan history and packing updates/photos
- `receiving-*`: receiving entries, logs, search, and tasks
- `repair/*` and `repair-service/*`: repair intake, lookup, and print flows
- `staff`, `staff-goals`, `support/overview`
- sync + migration helpers: `sync-sheets`, `sync-sheets-to-tech-serials`, `import-orders`, `migrate-process`, `drizzle-setup`, `setup-db`
- integrations: `ebay/*`, `ecwid-square/sync`, `google-sheets/*`, `manuals/resolve`, `orders-exceptions/*`
- realtime/ai: `realtime/token`, `ai/chat`, `ai/search`, `ai/health`

## Schedules (Vercel Cron + QStash hybrid)

Recurring scheduled jobs are primarily driven by **Vercel Cron** (defined in `vercel.json`).

A small number of jobs (or legacy/manual triggers) may still use Upstash QStash.

- Source of truth for Vercel crons: `vercel.json` → `"crons"` array.
- Legacy/transition QStash schedules are still declared in `src/config/qstash-schedules.json` (entries with `"managedBy": "vercel"` are skipped by bootstrap and sync scripts).
- Route handlers support **both** triggers via `isAuthorizedCronRequest()` in `src/lib/qstash.ts` (QStash signature or `CRON_SECRET` + `x-vercel-cron`).

| Worker Path | Schedule (UTC) | Purpose | System |
|-------------|----------------|---------|--------|
| `/api/qstash/shipping/sync-due` | `0 */2 * * *` | Sync USPS/UPS/FedEx tracking every 2 hours | Vercel |
| `/api/qstash/ebay/refresh-tokens` | `0 * * * *` | Refresh eBay tokens every hour | Vercel |
| `/api/qstash/google-sheets/transfer-orders` | 15:30 / 18:00 / 22:00 daily (weekdays) | Transfer Google Sheet orders | Vercel |
| `/api/qstash/staff-goals/history` | `00:30` daily | Nightly staff goal snapshot | Vercel |
| ... (see vercel.json for full current list) | | | |

**To (re)register any remaining QStash schedules:** `POST /api/qstash/schedules/bootstrap` (admin only).

**Important:** Set the `CRON_SECRET` environment variable in your Vercel project for secure Vercel Cron invocations.

## Database Model (Current Core Tables)

Defined in `src/lib/drizzle/schema.ts`.

Primary operational tables:
- `orders`
- `customers`
- `staff`
- `tech_serial_numbers`
- `packer_logs`
- `orders_exceptions`
- `receiving`
- `receiving_tasks`
- `sku_stock`
- `sku`
- `repair_service`
- `ebay_accounts`

SQL migration files live in `src/lib/migrations/`.

## Local Setup

1. Install dependencies

```bash
npm install
```

2. Create `.env.local` (or `.env`) with at minimum:

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DBNAME?sslmode=require
```

3. Start development server

```bash
npm run dev
```

4. Open `http://localhost:3000`

## Environment Variables

### Required

- `DATABASE_URL`
- `SETUP_TOKEN` — bearer header for the schema-bootstrap endpoints
- `INTEGRATION_KMS_KEY` — base64-encoded 32-byte AES key for the
  integration credential vault (generate via
  `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`)

### Billing (Stripe)

- `STRIPE_SECRET_KEY`
- `STRIPE_PUBLISHABLE_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_GROWTH`, `STRIPE_PRICE_PRO`,
  `STRIPE_PRICE_ENTERPRISE` — Stripe Price ids per plan tier

### Email (optional, Resend)

- `RESEND_API_KEY` — when unset, transactional emails log to the console
  in dev and CI rather than going out
- `EMAIL_FROM` — From: header for outbound mail

### Google Sheets Sync

- `GOOGLE_CLIENT_EMAIL`
- `GOOGLE_PRIVATE_KEY`
- `SPREADSHEET_ID` (optional override; fallback spreadsheet ID is hardcoded in sync routes)

### eBay Integration

- `EBAY_APP_ID`
- `EBAY_CERT_ID`
- `EBAY_RU_NAME`
- `EBAY_ENVIRONMENT` (`PRODUCTION` or non-production)
- `EBAY_REFRESH_TOKEN_USAV` (for token refresh helpers)

### Ecwid/Square

- `SQUARE_BASE_URL` (optional)
- `SQUARE_ENVIRONMENT` (optional)
- `SQUARE_VERSION` (optional)
- `ECWID_CURRENCY` (optional)

### Zendesk / Zoho / App URL / Cache

- `ZENDESK_SUBDOMAIN`
- `ZENDESK_EMAIL` or `ZENDESK_API_USER`
- `ZENDESK_API_TOKEN`
- `ZOHO_ORG_ID` or `ZOHO_ORGANIZATION_ID`
- `ZOHO_DOMAIN` (optional)
- `ZOHO_CLIENT_ID`
- `ZOHO_CLIENT_SECRET`
- `ZOHO_REFRESH_TOKEN`
- `NEXT_PUBLIC_APP_URL`
- `APP_URL`
- `VERCEL_URL`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

### Shipping Carriers

- `CONSUMER_KEY` and `CONSUMER_SECRET` for USPS OAuth
- `UPS_CLIENT_ID`
- `UPS_CLIENT_SECRET`
- `UPS_WEBHOOK_BEARER` or `UPS_WEBHOOK_SECRET` for `/api/webhooks/ups` callback authentication
- `FEDEX_CLIENT_ID`
- `FEDEX_CLIENT_SECRET`
- `FEDEX_ENV` (`production` or unset for sandbox)

### QStash (legacy / on-demand)

- `QSTASH_TOKEN` — still required for any remaining QStash schedules and `enqueueQStashJson` calls
- `QSTASH_URL` (optional override)
- `QSTASH_CURRENT_SIGNING_KEY`
- `QSTASH_NEXT_SIGNING_KEY`

**Primary scheduling has moved to Vercel Cron** (see Schedules section above). `CRON_SECRET` is now required for the Vercel cron paths.
- `APP_URL` or `NEXT_PUBLIC_APP_URL` or `VERCEL_URL` so worker routes can be addressed correctly

### Realtime / Ably

- `ABLY_API_KEY` (server-only)
- `NEXT_PUBLIC_ABLY_AUTH_PATH` (usually `/api/realtime/token`)
- `ABLY_CHANNEL_ORDERS_CHANGES` (optional override)
- `ABLY_CHANNEL_REPAIR_CHANGES` (optional override)
- `ABLY_CHANNEL_AI_ASSIST` (optional override, default `ai:assist`)

### AI (Ollama + Cloudflare Tunnel)

- `OLLAMA_BASE_URL` (example: `http://127.0.0.1:11434` or tunnel URL)
- `OLLAMA_TUNNEL_URL` (optional, used as fallback for base URL + origin allowlist)
- `OLLAMA_MODEL` (example: `llama3.1:8b`)
- `OLLAMA_TIMEOUT_MS` (optional request timeout)
- `AI_CHAT_RATE_LIMIT` (optional per-minute cap, default `25`)
- `AI_SEARCH_RATE_LIMIT` (optional per-minute cap, default `40`)
- `CLOUDFLARE_TUNNEL_URL` (optional, added to allowed origins)
- `CLOUDFLARE_TUNNEL_HOSTS` (optional comma-separated allowed hosts)
- `ALLOWED_ORIGIN_HOSTS` (optional comma-separated allowed hosts)

## NPM Scripts

```bash
npm run dev
npm run build
npm run start
npm run desktop:dev
npm run desktop:start
npm run desktop:dist
npm run desktop:dist:mac
npm run desktop:dist:win
npm run lint
npm run db:studio
npm run db:generate
npm run db:push
```

Notes:
- `sync:packer-logs` and `sync:packer-logs:preview` exist in `package.json`, but currently point to missing files.

## Desktop App (Electron Wrapper)

The desktop app is configured as a thin Electron shell around the hosted web app, not a bundled offline copy of the Next.js backend.

- Electron entry point: `electron/main.js`
- Secure preload bridge: `electron/preload.js`
- Dev launcher: `scripts/electron-dev.js`
- Packaged output directory: `desktop-dist/`

Behavior:
- `npm run desktop:dev` starts Next.js locally, waits for `http://127.0.0.1:3000`, then opens Electron against that local URL.
- `npm run desktop:start` launches Electron directly against the configured remote URL.
- `npm run desktop:dist:mac` builds a macOS `.dmg`.
- `npm run desktop:dist:win` builds a Windows `.exe` installer.

Configuration:
- Production desktop URL defaults to `https://usav-orders-backend.vercel.app`
- Override with `ELECTRON_START_URL` when needed
- External domains open in the system browser instead of navigating inside the app window

Important:
- Do not ship backend secrets inside Electron
- Package builds require network access because `electron-builder` downloads platform binaries during packaging

## Database Initialization / Migration Endpoints

Legacy and transitional setup endpoints exist:
- `POST /api/setup-db`
- `POST /api/drizzle-setup`

These are now **triple-gated**: admin.manage_features permission, step-up,
and a `x-setup-token` header matching `SETUP_TOKEN`. In production they
also require `SETUP_ALLOW_PROD=1` — without it they hard-refuse.

For day-to-day migrations, run the SQL files in `src/lib/migrations/` via:

```bash
npm run db:migrate         # apply pending
npm run db:migrate:dry     # list pending without applying
```

The runner (`scripts/run-pending-migrations.mjs`) tracks applied files in a
`schema_migrations` table by sha256, so changing a previously-applied file
hard-errors rather than silently re-running.

## SaaS layer (multi-tenancy, billing, integrations)

### Tenancy

Every staff row belongs to an **organization** (`organizations` table,
backfilled by `2026-05-22_organizations_tenancy.sql`). USAV is org #1 with
a fixed UUID — see `src/lib/tenancy/constants.ts`. Routes that need a
tenant-scoped DB client should use:

```ts
import { withTenantConnection, tenantQuery } from '@/lib/tenancy';

await withTenantConnection(orgId, async (client) => { ... });
const rows = await tenantQuery(orgId, 'SELECT ...', [...]);
```

Both helpers set the `app.current_org` Postgres GUC on the session so
future RLS policies can backstop the application-layer scoping.

`withAuth` exposes `ctx.organizationId` to every authenticated handler so
new code never has to look it up.

### Billing (Stripe)

Plans + entitlements live in `src/lib/billing/plans.ts`. Stripe REST is
called via the tiny client in `src/lib/billing/stripe.ts` (no SDK
dependency). Endpoints:

- `POST /api/billing/checkout` — start a subscription
- `POST /api/billing/portal`   — Stripe-hosted billing portal
- `POST /api/billing/webhook`  — Stripe event receiver, idempotent via
  `stripe_events` table

UI: `/settings/billing`.

### Integration credentials (per-tenant vault)

`organization_integrations` stores AES-256-GCM-encrypted payloads per
(org, provider, scope). Read/write via:

```ts
import { getIntegrationCredentials, upsertIntegrationCredentials } from '@/lib/integrations/credentials';

const creds = await getIntegrationCredentials<ZohoCredentials>(orgId, 'zoho');
```

USAV's existing env-var credentials are kept as a transitional fallback —
they only resolve for the USAV org id. New tenants get nothing from env,
so a missing per-tenant row means the integration is genuinely off.

UI: `/settings/integrations`.

### Feature flags

Per-tenant overrides in `organization_feature_flags`; env vars are the
system-wide default. `isInventoryV2X()` stays sync env-only;
`isInventoryV2XForOrg(orgId)` reads the per-tenant override. Migrate
callsites as they pick up an orgId from `withAuth`'s ctx.

### Signup / GDPR

- `POST /api/auth/signup` — creates an org + first admin staff + 14-day
  trial in one transaction. UI: `/signup`.
- `POST /api/admin/org/export` — returns all tenant-scoped data as JSON.
- `POST /api/admin/org/delete` — soft-deletes the org, revokes all
  sessions; purge runs out-of-band on a 30-day clock.

### Observability

- `/api/health` — always 200 with `version`
- `/api/ready`  — 503 when DB or Redis ping fails
- `/api/log-error` — client-side error sink → structured JSON log
- `src/lib/observability/logger.ts` — pino-compatible logger; lines are
  pretty-printed in dev, JSON in production. Pipe to your aggregator.

### CI

`.github/workflows/ci.yml` runs lint + `tsc --noEmit` + every
`src/**/*.test.ts` on push and PR. Add new tests anywhere under `src/`.

## Project Structure

- `src/app/*`: pages and API routes
- `src/components/*`: dashboards, tables, station/detail panels
- `src/lib/*`: DB, sync logic, integrations, cache helpers
- `src/hooks/*`: UI/data hooks
- `src/utils/*`: tracking, order, staff, and formatting utilities
- `src/lib/migrations/*`: SQL migrations

## Operational Notes

- Root route redirects to `/dashboard`.
- The app uses PST (`America/Los_Angeles`) assumptions in several workflows and DB connection options.
- Some setup/sync routes are retained for migration compatibility and may overlap with newer Drizzle-based patterns.
