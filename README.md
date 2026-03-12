# USAV Orders Backend

Internal operations platform for USAV order workflow management.

This repository is a Next.js (App Router) application that combines:
- Warehouse/station dashboards (tech, packer, receiving, support, admin)
- PostgreSQL data storage (Neon/Postgres)
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
- `ZendeskTicketMailer_GAS_WebappURL` (optional GAS bridge)
- `ZOHO_ORG_ID`
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
- `CRON_SECRET` for `/api/shipping/track/sync-due` if you run scheduled shipment refreshes

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
npm run lint
npm run db:studio
npm run db:generate
npm run db:push
```

Notes:
- `sync:packer-logs` and `sync:packer-logs:preview` exist in `package.json`, but currently point to missing files.

## Database Initialization / Migration Endpoints

Legacy and transitional setup endpoints exist:
- `POST /api/setup-db`
- `POST /api/drizzle-setup`

Prefer using Drizzle migration workflow (`db:generate` + `db:push`) for schema evolution, and keep API setup endpoints for controlled/backward-compatible bootstrap scenarios.

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
