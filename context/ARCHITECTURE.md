# Architecture Overview

USAV Orders Backend is an internal operations platform for a 5-person warehouse team built on Next.js 16 (App Router) with React 19, TypeScript, and Tailwind CSS.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) |
| UI | React 19, Tailwind CSS, Framer Motion |
| Data Fetching | TanStack React Query |
| Database | PostgreSQL (Neon serverless) |
| ORM | Drizzle ORM (`src/lib/drizzle/schema.ts`) |
| Raw SQL | `pg` Pool (`src/lib/db.ts`, `src/lib/neon-client.ts`) |
| Realtime | Ably (WebSocket/SSE) |
| Caching | Upstash Redis + in-memory (`src/lib/cache.ts`) |
| Job Scheduling | Upstash QStash |
| File Storage | Vercel Blob |
| Desktop | Electron |
| Deployment | Vercel (web), Electron Builder (desktop), PM2 (pipeline) |
| AI Pipeline | Local MLX inference + Jetson Orin Nano CUDA training |

## Directory Structure

```
src/
├── app/                 # Next.js pages + 60+ API route groups
│   ├── api/             # REST API endpoints
│   ├── dashboard/       # Orders dashboard
│   ├── fba/             # Amazon FBA shipment UI
│   ├── packer/          # Packer station
│   ├── tech/            # Tech testing station
│   ├── repair/          # Repair intake & service
│   ├── receiving/       # Receiving inbound goods
│   ├── admin/           # Admin config
│   ├── work-orders/     # Work assignment management
│   ├── ai/              # AI chat/search
│   ├── sku-stock/       # SKU inventory
│   ├── manuals/         # Product manuals
│   └── support/         # Support dashboards
│
├── components/          # ~195 .tsx files by domain
│   ├── admin/           # Admin UI
│   ├── dashboard/       # Dashboard panels
│   ├── fba/             # FBA components
│   ├── receiving/       # Receiving UI
│   ├── repair/          # Repair forms
│   ├── shipped/         # Shipped order display
│   ├── station/         # Station-shared (scanner, modals)
│   ├── sidebar/         # Navigation sidebars
│   ├── ui/              # Shared UI primitives
│   └── work-orders/     # Work order components
│
├── contexts/            # React Context providers
│   ├── AblyContext.tsx   # Realtime channel connections
│   ├── FbaWorkspaceContext.tsx
│   └── HeaderContext.tsx
│
├── design-system/       # Reusable design system
│   ├── components/      # Button, Input, Modal, Table
│   ├── foundations/     # Colors, typography, spacing
│   ├── primitives/      # Low-level UI blocks
│   └── tokens/          # Design tokens
│
├── hooks/               # 35 custom hooks
├── lib/                 # ~112 files - core business logic
│   ├── drizzle/         # ORM schema + client
│   ├── tech/            # Tech station logic
│   ├── fba/             # FBA business logic
│   ├── realtime/        # Ably integration
│   ├── cache/           # Upstash Redis cache
│   ├── shipping/        # Carrier integrations
│   ├── zoho/            # Zoho Inventory client
│   ├── ebay/            # eBay API
│   ├── ai/              # AI/LLM features (chat, intent routing)
│   ├── pipeline/        # Self-improving code pipeline (orchestrator, agent, validation)
│   ├── repositories/    # Data access layer
│   └── jobs/            # Background workers
│
├── utils/               # 38 utility files
│   ├── staff.ts         # Staff constants (IDs, names, sort orders)
│   ├── staff-colors.ts  # Staff theme colors
│   ├── date.ts          # PST date helpers
│   ├── sku.ts           # SKU normalization
│   └── order-platform.ts
│
└── services/            # Service integrations
```

## Key Architectural Patterns

### 1. Station Activity Logs (SAL) as Event Ledger
All station actions (tech scans, packing, FBA) create rows in `station_activity_logs`. This is the central audit trail. Other tables (tech_serial_numbers, fba_fnsku_logs) link back to SAL via FK.

### 2. Unified Scan Entry Point
`POST /api/tech/scan` detects input type (TRACKING/FNSKU/SKU/REPAIR) and routes to the appropriate handler. Idempotency via `idempotencyKey`.

### 3. Polymorphic Tables
- `work_assignments(entity_type, entity_id)` covers ORDER, REPAIR, RECEIVING, FBA_SHIPMENT
- `photos(entity_type, entity_id)` covers PACKER_LOG, RECEIVING, REPAIR_SERVICE

### 4. Realtime Without Polling
Ably channels publish mutations server-side. `useAblyChannel()` hook subscribes client-side. Cache invalidation on message receipt.

### 5. Singleton Staff Cache
`src/lib/staffCache.ts` fetches staff once per page load. Shared across all components via module-level singleton. `useActiveStaffDirectory()` hook wraps this.

### 6. QStash for Reliable Scheduling
No Vercel cron. Schedules persist in QStash. Bootstrap via `POST /api/qstash/schedules/bootstrap` after deploy.

### 7. Role-Based UI (No Server Auth)
Staff roles (tech, packer, manager, admin) control UI rendering. No session auth in API routes. Routes assume trusted client.

## Database Access Patterns

Two parallel DB access methods:
1. **Drizzle ORM** (`src/lib/drizzle/`) — typed schema, migrations via `drizzle-kit push`
2. **Raw pg Pool** (`src/lib/db.ts`) — tagged-template SQL for complex queries

Both connect to the same Neon Postgres instance via `DATABASE_URL`.

### 8. Self-Improving Pipeline
`src/lib/pipeline/` runs an autonomous loop: discover code issues → LLM implements fixes → validate (tsc/lint/tests) → score → store training pairs. A Jetson Orin Nano (`scripts/jetson/trainer.py`) polls the DB and runs QLoRA fine-tuning on accumulated data. See `context/PIPELINE.md` for full details.
