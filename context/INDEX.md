# Context Files Index

Comprehensive documentation for the USAV Orders Backend codebase. Use these for onboarding, feature planning, and implementation context.

## Architecture & Reference

| File | Lines | Purpose |
|------|-------|---------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | ~120 | Tech stack, directory structure, key architectural patterns |
| [DATABASE.md](./DATABASE.md) | ~130 | Schema tables, enums, ORM setup, caching layers |
| [API-ROUTES.md](./API-ROUTES.md) | ~160 | All 60+ API endpoints organized by domain |
| [INTEGRATIONS.md](./INTEGRATIONS.md) | ~200 | eBay, Zoho, Google Sheets, shipping carriers, Ably, Ecwid/Square, AI |
| [STAFF-SYSTEM.md](./STAFF-SYSTEM.md) | ~120 | Staff directory, theming, constants, cache, assignment UI |
| [REALTIME-AND-CACHING.md](./REALTIME-AND-CACHING.md) | ~130 | Ably channels, 4 cache layers, QStash background jobs |
| [UI-PATTERNS.md](./UI-PATTERNS.md) | ~180 | Design system, styling conventions, state management, animations |
| [ENV-VARS.md](./ENV-VARS.md) | ~60 | All environment variables |
| [HOOKS.md](./HOOKS.md) | ~80 | Custom React hooks reference |

## AI Training Pipeline

| File | Lines | Purpose |
|------|-------|---------|
| [PIPELINE.md](./PIPELINE.md) | ~280 | Self-improving pipeline: architecture, data flow, Jetson CUDA training, orchestrator config, API endpoints |
| [PIPELINE-SETUP.md](./PIPELINE-SETUP.md) | ~300 | Step-by-step setup: DB migration, Mac orchestrator, Jetson trainer, adapter loading, troubleshooting |
| [PIPELINE-EXAMPLES.md](./PIPELINE-EXAMPLES.md) | ~600 | How-to examples: day-in-the-life, sample injection, rating, monitoring, DB recipes, debugging, custom discovery |

## Analysis

| File | Lines | Purpose |
|------|-------|---------|
| [CONSISTENCY-GAPS.md](./CONSISTENCY-GAPS.md) | ~140 | Cross-reference analysis: 14 inconsistencies (9 resolved, 5 remaining) |
| [DEEP-SCAN-FINDINGS.md](./DEEP-SCAN-FINDINGS.md) | ~220 | Deep scan: duplicate utilities, API patterns, React patterns, DB access |

## Detailed Workflow Flows (300+ lines each)

| File | Lines | Purpose |
|------|-------|---------|
| [WORKFLOW-TECH-STATION.md](./WORKFLOW-TECH-STATION.md) | ~350 | Tech station: scan types, serial handling, SAL creation, UI controller, complete data flow |
| [WORKFLOW-PACKING-SHIPPED.md](./WORKFLOW-PACKING-SHIPPED.md) | ~350 | Packing: session lifecycle, photo upload, order assignment, shipped dashboard, complete order flow diagram |
| [WORKFLOW-FBA.md](./WORKFLOW-FBA.md) | ~350 | FBA: shipment plans, FNSKU scanning, verification, closing, item status transitions, event system |
| [WORKFLOW-RECEIVING.md](./WORKFLOW-RECEIVING.md) | ~300 | Receiving: bulk scan, Zoho auto-match, unboxing classification, QA, disposition, enums |
| [WORKFLOWS.md](./WORKFLOWS.md) | ~170 | High-level workflow summaries (order lifecycle, FBA, receiving, repair, staff, integrations) |

## Quick Reference

### Staff (8 members)
Michael(1/green), Thuc(2/blue), Sang(3/purple), Tuan(4/black), Thuy(5/red), Cuong(6/yellow), Kai(7/lightblue), Lien(8/pink)

### Key Source Files
- Database schema: `src/lib/drizzle/schema.ts`
- DB client: `src/lib/db.ts`, `src/lib/neon-client.ts`
- Staff constants: `src/utils/staff.ts`
- Staff colors/themes: `src/utils/staff-colors.ts`
- Theme hook: `src/hooks/useStationTheme.ts`
- Staff cache: `src/lib/staffCache.ts`
- Scan resolver: `src/lib/scan-resolver.ts`
- SAL creation: `src/lib/station-activity.ts`
- FBA log writer: `src/lib/fba/createFbaLog.ts`
- Realtime publishing: `src/lib/realtime/publish.ts`
- Cache helpers: `src/lib/cache.ts`, `src/lib/cache/upstash-cache.ts`
- QStash client: `src/lib/qstash.ts`
- Pipeline orchestrator: `src/lib/pipeline/orchestrator.ts`
- Pipeline config: `src/lib/pipeline/config.ts`
- Jetson trainer: `scripts/jetson/trainer.py`

### Database
PostgreSQL on Neon serverless. Drizzle ORM + raw pg Pool. 50+ tables + 5 pipeline tables.

### Deployment
Vercel (web) + Electron (desktop) + PM2 (pipeline). After deploy: `POST /api/qstash/schedules/bootstrap`.
Pipeline: `npm run pipeline:start` (Mac) + `systemctl start jetson-trainer` (Jetson).
