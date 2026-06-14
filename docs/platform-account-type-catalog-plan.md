# Platform / Account / Type Catalog — Org-Scoped Normalization Plan

> Status: PLAN (2026-06-13). Belongs with the multi-tenancy initiative
> (`docs/multi-tenancy-hardening-prompt.md`). Separate from the receiving/tech UI
> refactor. Nothing here is built yet.

## Context — why

Today "where a thing came from / how it flows" is encoded as **hardcoded code
registries + TEXT-slug columns with `CHECK` constraints**, single-tenant:

- `receiving.source_platform` (TEXT, CHECK) — platform-level (`ebay`, `amazon`, `goodwill`…), SoT in `src/lib/source-platform.ts`.
- `receiving.intake_type` (carton) + `receiving_lines.receiving_type` (line) — `PO|RETURN|TRADE_IN|PICKUP`, CHECK-constrained.
- `orders.account_source` (TEXT) — **hybrid grain**: eBay = account-level (`ebay_accounts.account_name`, e.g. `ebay-mk`), everything else = platform-level (`'ecwid'`, `'fba'`).
- `receiving.return_platform` enum — `AMZ|EBAY_DRAGONH|EBAY_USAV|EBAY_MK|FBA|WALMART|ECWID` (platform×return combos).

We want each **org** to:
1. Define its own **platforms** + **storefront accounts**, each wired to an integration (so it can *pull*).
2. Define its own **flow types** — including **custom named flows** (e.g. an org's own "Repair Service") scoped to that org only, optionally driving a custom node-graph workflow.
3. Share one catalog across **receiving (inbound)** and **shipping/orders (outbound)**.

### Existing infrastructure we build on (already present)

- `organizations` — UUID PK. `orgIdCol()` helper = `uuid organization_id NOT NULL DEFAULT NULLIF(current_setting('app.current_org', true),'')::uuid`. Standard across ~35 tables. (`src/lib/drizzle/schema.ts:5`)
- `organization_integrations` — encrypted per-org creds vault, UNIQUE `(organization_id, provider, COALESCE(scope,''))`. Resolved via `getIntegrationCredentials(orgId, provider, {scope})` (`src/lib/integrations/credentials.ts`).
- `ebay_accounts` — org-scoped eBay storefronts (id, organization_id, account_name, tokens). The shape `platform_accounts` generalizes.
- Two-tier system+override precedent: `organization_feature_flags` + `src/lib/feature-flags.ts`; `organizations.settings` jsonb.
- `tenantQuery()` / `withTenantConnection()` GUC scoping (`src/lib/tenancy/db.ts`).

### The one finding that shapes the design

`orders.account_source` is **two grains in one column** (eBay = account, others = platform). A single flat `platforms` table can't be the clean FK target for both orders (which store?) and receiving (which channel?). → we need **platform → platform_account** as two levels, and route receiving/shipping linkage through a **type**.

## Target model — three org-scoped tables

```
platforms                         ← CHANNEL
  id              bigserial PK
  organization_id uuid (orgIdCol)
  slug            text            -- 'ebay','amazon','ecwid','goodwill','fba'
  label           text
  tone            text            -- pill color token (was hardcoded in source-platform.ts)
  provider        text NULL       -- soft-link → organization_integrations.provider (null = display-only)
  sort_order      int  DEFAULT 100
  is_active       bool DEFAULT true
  created_at/updated_at
  UNIQUE(organization_id, slug)
  INDEX(organization_id)

platform_accounts                 ← STOREFRONT under a channel (generalizes ebay_accounts)
  id                bigserial PK
  organization_id   uuid (orgIdCol)
  platform_id       bigint NOT NULL REFERENCES platforms(id) ON DELETE CASCADE
  slug              text          -- 'ebay-mk','ebay-usav','ecwid-main'
  label             text
  integration_scope text NULL     -- → organization_integrations.scope (the specific connection)
  is_active         bool DEFAULT true
  created_at/updated_at
  UNIQUE(organization_id, platform_id, slug)
  INDEX(organization_id, platform_id)

types                             ← per-org FLOW (the customizable one)
  id                  bigserial PK
  organization_id     uuid (orgIdCol)
  slug                text        -- 'po','return','trade_in','pickup','repair-service',<custom>
  label               text
  kind                text        -- 'receiving' | 'shipping' | 'both'
  platform_account_id bigint NULL REFERENCES platform_accounts(id) ON DELETE SET NULL
  workflow_node_id    text NULL   -- optional: drives a custom node-graph flow (station builder)
  is_return           bool DEFAULT false
  sort_order          int  DEFAULT 100
  is_active           bool DEFAULT true
  created_at/updated_at
  UNIQUE(organization_id, slug)
  INDEX(organization_id)
```

### The chain & linkage

```
platforms ──< platform_accounts ──< types ──< receiving.type_id
                                         └──< orders.type_id   (STN derives via orders.shipment_id)
platforms.provider ───────────────────────────> organization_integrations (by provider [+ account.integration_scope])
```

From a single `type_id` on a receiving/order row you reach: flow → account → platform → integration → workflow.

### Design decision: type carries its platform (chosen)

A type **optionally pins** a `platform_account_id` (nullable). Receiving/orders reference **only `type_id`**; platform/account/integration are reachable through it. Fixed platform×flow combos (returns, repair-service) become distinct types — consistent with the existing `return_platform` enum. Platform-agnostic flows (PO, Trade-in, custom) leave `platform_account_id` NULL.

> Escape hatch if a flow must float across platforms later: add a nullable
> `platform_account_id` to the receiving/order **record** to override the type's
> binding. Not built in v1.

## Linkage columns (additive — do NOT drop the text columns yet)

- `receiving.type_id  bigint NULL REFERENCES types(id)`
- `orders.type_id     bigint NULL REFERENCES types(id)`
- Keep `receiving.source_platform`, `receiving.intake_type`, `orders.account_source` as **denormalized cache** through the transition (they have a ~40-site read footprint incl. `account_source === 'fba'` checks, `ILIKE` filters, and fuzzy substring matching in the eBay backfill — an opaque id breaks all of those).

## Migration order (each step additive + reversible)

1. **`<date>_platform_account_type_catalog.sql`** — create `platforms`, `platform_accounts`, `types` (orgIdCol defaults, indexes, unique keys). No FK on receiving/orders yet.
2. **Seed per org** (idempotent seed fn, run for existing orgs + on org creation):
   - `platforms` ← `SOURCE_PLATFORMS` (slug/label/tone from `src/lib/source-platform.ts`), `provider` = slug where a matching `organization_integrations.provider` exists (ebay, amazon, ecwid…), else NULL (goodwill, other).
   - `platform_accounts` ← `ebay_accounts` rows (platform=ebay), plus one default account per single-account platform (ecwid, amazon, walmart, aliexpress).
   - `types` ← `PO`(both), `RETURN`(receiving, is_return), `TRADE_IN`, `PICKUP`; plus the `return_platform` combos mapped to a `RETURN`-kind type bound to the matching `platform_account` (EBAY_USAV→ebay-usav, AMZ→amazon, ECWID→ecwid, …).
3. **`<date>_receiving_orders_type_fk.sql`** — add nullable `receiving.type_id` + `orders.type_id` (FK → types), indexed.
4. **Backfill** (one-shot script, org-by-org via GUC):
   - `receiving.type_id` ← resolve from `(intake_type, is_return, return_platform, source_platform)` → the seeded type slug.
   - `orders.type_id` ← default to the org's `sale`/`PO`-equivalent type; eBay rows resolve their `platform_account` from `account_source`→`ebay_accounts.account_name`, others by platform slug.
5. **Dual-write** — every writer that sets `source_platform`/`intake_type`/`account_source` also sets `type_id` (and the resolver keeps the text cache in sync).
6. **Reader migration (incremental)** — switch UI pills + queries to read the catalog via the cache layer; the text columns become read-through caches.
7. **Cleanup (final, optional)** — drop the `CHECK` constraints, then the text columns, once nothing reads them. Gated by `grep` proving zero readers + tsc + build (per `dead-code-cleanup-waves`).

## Read / cache layer (mirror `getIntegrationCredentials`)

`src/lib/catalog/` (new):
- `getOrgPlatforms(orgId)` → `Platform[]` (active, sorted), 5-min in-process cache.
- `getOrgPlatformAccounts(orgId, platformId?)` → `PlatformAccount[]`.
- `getOrgTypes(orgId, kind?)` → `FlowType[]`.
- `resolveType(orgId, typeId)` → `{ type, account, platform, provider, workflowNodeId }` (joins, cached).
- `seedOrgCatalog(orgId)` — idempotent; called from org-create + a backfill CLI.
- `invalidateCatalogCache(orgId)` on any CRUD write.

Pills/tones move from `source-platform.ts` constants to `getOrgPlatforms(orgId)`; `source-platform.ts` becomes **seed data**, not runtime SoT (keep the helper signatures so callers don't churn).

## Settings CRUD (UI)

`/settings` catalog editors (platforms, accounts, types) following the house CRUD pattern (`crud-endpoints-initiative`): `/api/catalog/platforms`, `/api/catalog/platform-accounts`, `/api/catalog/types` (org-guarded, Zod-validated, audited). Type editor exposes the custom-name + optional account binding + optional `workflow_node_id` picker (wires to the node-workflow engine).

## Prerequisites & risks

- **Org-scoping gap:** `receiving` and `shipping_tracking_numbers` lack `organization_id` (orders has it). The catalog is org-scoped; until receiving is org-scoped (multi-tenancy Phase B), resolve via the `app.current_org` GUC and rely on globally-unique slugs. Pair this work with the receiving org-scoping pass.
- **`account_source` blast radius (~40 sites)** incl. fuzzy matching + `'fba'` checks → strictly additive FK, keep the text cache, migrate readers last.
- **Drizzle schema is incomplete** for the receiving text columns — add them while touching the schema.
- **`ebay_accounts` creds → `organization_integrations`** is a separate, optional later migration (identity moves to `platform_accounts`, secrets to the vault). Not required for v1.

## Phasing (each phase shippable, tsc+build gated)

| Phase | Deliverable |
|---|---|
| 1 | Catalog tables + `seedOrgCatalog` + read/cache layer. No consumer changes (registries still drive UI). |
| 2 | Additive `type_id` FKs on receiving + orders, backfill, dual-write. |
| 3 | Switch receiving/testing pills + order channel display to catalog reads. |
| 4 | `/settings` CRUD for platforms / accounts / types. |
| 5 | Custom types + `workflow_node_id` binding (the "own repair-service flow"). |
| 6 | Drop text columns / CHECKs (cleanup wave). |

## Verification

- Per migration: `npx tsc --noEmit` + `npm run build` clean; seed idempotency (run twice → no dupes, UNIQUE holds).
- Backfill dry-run reports unmapped rows (no silent drops) before writing.
- Round-trip: edit a type in `/settings` → receiving pill reflects it; bind a custom type to an account → `resolveType` returns the right integration `provider`/`scope`.
- Parity: existing `source_platform`/`account_source` reads unchanged while the text cache is live.
