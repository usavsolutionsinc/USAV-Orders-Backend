# OVERALL CONTEXT — master orientation

> A single page to orient any agent or engineer to this repository. It is a **map, not a spec** — it
> states *what exists and where*, then points to the deep docs in this folder and in `docs/`. When this
> document and the code disagree, **the code wins — fix this document.**
>
> **Last mapped:** 2026-07-03 (8-area multi-agent research pass, every claim adversarially checked
> against code). **Delta 2026-07-04:** a Redis application-cache layer was added on top of the existing
> DB read models — see the caching notes in §6 and §11.
>
> **New here?** Read this top-to-bottom once, then jump to [`INDEX.md`](./INDEX.md) for the deep dives.

---

## 1. What this is

A **multi-tenant warehouse & order-operations platform** for used-goods resellers (primary channel
eBay; also Amazon/FBA, Square, Ecwid, local pickup). It tracks physical **serialized units** through
their entire lifecycle — sourcing → receiving → testing/repair → listing → picking/packing →
shipping → returns/warranty — across staff **stations** (tech, packer, receiving, support, admin),
with a heavy integration surface and a node-graph "Operations Studio" for modeling the operation.

- **Stack:** Next.js 16 (App Router) · React 19 · TypeScript 5.9 · Tailwind 3.4 · Drizzle ORM +
  Neon/Postgres · TanStack Query · Framer Motion · `@xyflow/react` (node graph) · Ably (realtime) ·
  `@gorules/zen-engine-wasm` (decision rules) · also packaged as an **Electron** desktop app.
- **Deploy:** Vercel (Git auto-deploy disabled — deploys via CLI). 35 Vercel cron entries hit
  `/api/cron/*`. CI is GitHub Actions (`.github/workflows/ci.yml`).
- **Scale:** ~755 API route handlers (754 in the CI route-permission manifest), 152 Drizzle tables,
  342 runnable hand-written SQL migrations (plus a handful of deliberately-inert `.gated`/`.template`
  files — see the suffix convention in §6), 56 Playwright E2E specs (plus a standalone
  `scripts/e2e-*.mjs` family).

## 2. Outside-the-repo context

This is the **product** repo — `app.<domain>`. Two things live outside it:

- **CycleForge** (`/Users/icecube/repos/CycleForge`, package `cycleforge-site`, dev port 3001) — the
  **separate public marketing/landing site** that *sells* this platform. Brand: **Cycle Forge**,
  *"Run your whole resale operation on one canvas."* The beta funnel form lives there and POSTs
  cross-origin to this repo's `/api/beta/*` (CORS-allowlisted). Keep pricing/claims in sync across
  both repos; distribution decision is **browser web app only** (the Electron shell is legacy).
  Branding rules: `docs/cycle-forge-branding-spec.md`. Both repos wire PostHog for analytics.
- **USAV Solutions Inc** — the original single tenant. This began as USAV's internal tool and is
  being commercialized into a sellable B2B SaaS. The live org id is
  `USAV_ORG_ID = 00000000-0000-0000-0000-000000000001` (`src/lib/tenancy/constants.ts`). Cycle Forge
  = the platform name; `organizations.name` (e.g. "USAV Solutions") = a tenant workspace.

**Commercialization state:** the SaaS skeleton is largely **built in code** — multi-tenant data
model, self-serve `/signup` + 14-day trial, Stripe billing (`src/lib/billing/`), a 5-tier plan
catalog, entitlement/trial gates, per-org feature flags, beta-waitlist API, PostHog. The gaps to
actually *sell* are **owner-gated/operational, not architectural**: (1) create the live Stripe
product catalog, (2) finish DB-enforced tenant isolation (see §7), (3) identity hardening (email
verify, magic-link), (4) onboarding/activation, (5) legal review — ToS/Privacy/DPA **drafts shipped
2026-07-03 in both repos** (in-product at Settings → Legal & Policies, source
`src/content/legal/{terms,privacy,dpa}.json`; CycleForge `/legal`) with a "Draft — pending legal
review" banner; remaining work is owner-side (fill entity/jurisdiction placeholders, attorney review)
plus keeping the two repos' copies in sync. Master plans:
`docs/sellable-foundation-execution-plan.md`, `docs/todo/saas-commercialization-plan.md`,
`docs/second-tenant-onboarding-checklist.md`, `docs/tier0-go-live-runbook.md`.

### In flight right now (uncommitted working tree)

- **Redis application-cache layer — code-complete, uncommitted (2026-07-04).** A cross-instance
  cache-aside layer built on the existing Upstash Redis foundation (`src/lib/cache/upstash-cache.ts`,
  now v2 with **org-scoped keys *and* tags**; `getOrSet` read-through with single-flight; global +
  per-namespace kill-switch in `cache-flags.ts`; hit/miss/error metrics at `GET /api/admin/cache-stats`).
  Applied to the hottest station reference reads (`get-title-by-sku` stable slice, `manuals/resolve`,
  gtin, reason-codes), the per-scan read models (`order-detail`, FBA board/today, `po-by-ref`), the
  auth hot-path staff-overrides read, and the operations-dashboard pollers. Every entry fails open to
  the DB and is reversible via `REDIS_CACHE_DISABLED`. Plan + status: `docs/todo/redis-caching-plan.md`.
- **serial_unit_provenance polymorphic refactor — code-complete, uncommitted (2026-07-03).** The denormalized
  `serial_units.origin_*` family (`origin_source`/`origin_receiving_line_id`/`origin_tsn_id`/
  `origin_sku_id`) is replaced by the polymorphic `serial_unit_provenance` table (migration
  `2026-07-01n`, backfilled + applied live), kept in sync by a dual-write trigger (`2026-07-03a`),
  with all ~18 readers/writers repointed onto the `v_serial_unit_origins` view (`2026-07-03c`,
  `security_invoker=true` so RLS applies). The ~24 modified receiving/tech/serial files in the tree
  belong to this change — don't revert them. The column DROP
  (`2026-07-03b_…​.sql.BLOCKED`) is **deploy-gated, not code-gated**: production (commit `2b39d809`)
  still reads/writes `origin_*`; commit + deploy the migrated code first, then rename
  `.BLOCKED`→`.sql`. **Never re-add `origin_*` readers in new code** (schema.ts carries an explicit
  "Do not re-add" comment).
- **Live tracker:** `docs/partial/HUMAN-TODO.md` is the single "what's in flight / owner-gated" list
  (re-scanned per wave). Plan docs' own status headers lag the tree — e.g.
  `docs/todo/schema-wide-polymorphic-refactor-plan.md` still says "Phases 2–4 PLAN" while their
  artifacts sit in the tree; `docs/partial/tier0-execution-checklist.md` is explicitly SUPERSEDED.
  Trust migrations/code over doc status lines.

## 3. Repo map — where things live

| Path | What |
|---|---|
| `src/app/` | Next.js App Router — pages + `api/` route handlers |
| `src/app/m/` | Mobile surface (scan/pick/pack/receive), route groups `(shell)` + `(immersive)` |
| `src/lib/` | **All business logic** — domain modules (see §4). Routes stay thin and delegate here |
| `src/lib/drizzle/schema.ts` | The DB schema (152 tables, ~3.5k lines). `db.ts` (HTTP), `tenant-db.ts` (GUC-carrying) |
| `src/lib/migrations/` | Hand-written dated SQL migrations (canonical; **not** `drizzle-kit push`) |
| `src/lib/feature-flags.ts` | Product rollout flags (`readBoolEnv`, `resolveForOrg`) — see §8 |
| `src/components/` | UI, grouped by station/domain (`station/`, `studio/`, `receiving/`, `orders/`, …) |
| `src/features/operations/` | The one first-class feature module (Operations dashboard + workspace) |
| `src/design-system/` | "Kinetic Ledger" design system — `tokens/`, `primitives/`, `components/`, `foundations/`. Read `DESIGN_SYSTEM.md` in that folder before touching tokens/motion presets |
| `src/proxy.ts` | The edge **auth gate** — any path not in `PUBLIC_PATHS` without a `usav_sid` cookie gets 401/redirect, so **a new public endpoint (webhook, cron, page) must be allow-listed there or it dies at the edge**. Also: `x-tenant-slug` stamping from subdomain, security headers, printed-QR short-links (`/m/b\|l\|u/*` → bin/line/serial), phone-UA rewrites of `/receiving` + `/signin` to `/m/*` (phones only, exact paths). `AUTH_V2_ENABLED=false` is a break-glass for the edge check only — `withAuth` still enforces per-route |
| `context/` | **Deep architecture docs** (pre-existing) — start at [`INDEX.md`](./INDEX.md) |
| `docs/` | Plans & initiatives — `todo/`, `partial/`, `roadmap/`, `tenancy/`, `operations-studio/`, `integrations/`, `diagrams/`, `archive/` |
| `.claude/` | Agent tooling — `rules/` (always-loaded conventions), `agents/`, `skills/`, `hooks/` |
| `scripts/` | Migration runner, tenancy/route/permission audits, knip gate, diagrams, env push |
| `electron/`, `server/` | Desktop shell + a standalone pipeline server |
| `tests/e2e/` | Playwright specs (`global-setup.ts`, admin `storageState`) |

## 4. Core domain & lifecycle

Serialized units move through a guarded lifecycle; the domain modules that own each stage:

- **Sourcing / inbound / receiving** — `src/lib/sourcing`, `inbound`, `receiving` (unbox, triage,
  exceptions, putaway-placement, delivered-unscanned), `po-gmail`, `zoho-*` (POs mirrored from Zoho).
- **Testing / tech / QC / repair** — `src/lib/tech` (`recordTestVerdict`, `recordDataWipe`),
  `repair`, `work-orders`, `work-assignments`, `quality`.
- **Inventory lifecycle** — `src/lib/inventory` (allocate/hold/events/cycle-count) + the state
  machine (§5), `serial`, `sku`.
- **Listing → picking → packing → shipping** — `listing`, `picking`, `packing`/`packer`
  (kit-BOM verify via `kit-readiness`), `shipping`/`fulfillment`/`outbound`/`shipped`,
  `shipping/shipstation` (the label engine: v2 rate-shop/buy/void + v1 order pull), `carrier-sync`
  (tracking normalization). NB `src/lib/labels` is **not** shipping labels — it's the
  tenant-customizable label-**vocabulary** layer (stable-code→custom-label over `reason_codes`).
- **Returns / RMA / warranty** — `rma`, `warranty` (quotes/claims), `receiving` (shipped↔returned
  loop, `linkReturnedSerial`), `zendesk-*` (seller-assist claims).
- **Cross-cutting** — `stations` (composable station blocks), `timeline` (unified per-order/unit
  history), `operations` (journey/throughput), `auth`, `audit-log`, `tenancy`, `integrations`,
  `reason-codes` (governed reason vocabularies), `placement` (putaway decisions), `ai`/`rag`/`vision`.

Deep dives: [`WORKFLOWS.md`](./WORKFLOWS.md), [`WORKFLOW-RECEIVING.md`](./WORKFLOW-RECEIVING.md),
[`WORKFLOW-TECH-STATION.md`](./WORKFLOW-TECH-STATION.md),
[`WORKFLOW-PACKING-SHIPPED.md`](./WORKFLOW-PACKING-SHIPPED.md), [`WORKFLOW-FBA.md`](./WORKFLOW-FBA.md).

### Serial-unit lifecycle states

`src/lib/inventory/state-machine.ts` defines a **22-state** vocabulary (`SERIAL_STATES` — the
code-side SoT; the Drizzle `serialStatusEnum` in schema.ts is **stale**, missing
`PICKING/PACKING/LOADING` added by `2026-05-20_inventory_v2_active_states.sql` — never trust it for
the state list):
`UNKNOWN → RECEIVED → TRIAGED → IN_TEST → TESTED / GRADED → IN_REPAIR → REPAIR_DONE → STOCKED →
ALLOCATED → PICKING/PICKED → PACKING/PACKED → LABELED → STAGED → LOADING → SHIPPED → RETURNED → RMA`,
plus `ON_HOLD` (universal entry; release restores the prior state via `inventory_events.payload.
restore_status`) and `SCRAPPED` (terminal). `TRANSITIONS` is the canonical allow-list; `guard(from,to)`
is a synchronous DB-free pre-flight (used to grey out UI).

## 5. The core systems to know first

1. **Inventory state machine** — `src/lib/inventory/state-machine.ts`. **Never** `UPDATE serial_units
   SET current_status` directly — call `transition(input, db?, orgId?)`, which locks `FOR UPDATE`,
   checks `expectedFrom` (optimistic concurrency → 409), guards, updates, and records an
   `inventory_events` row atomically. Events carry a `client_event_id UNIQUE` for idempotent mobile
   retries — implemented as `ON CONFLICT (client_event_id) DO UPDATE` returning the pre-existing row
   (an idempotent upsert that still yields the event id), and `applyTransition()` treats a
   from===to re-entry (no `expectedFrom`) as idempotent (`{ idempotent: true }`, still records +
   taps). **Gotcha:** if a call site omits `orgId`, both `transition()` and `applyTransition()`
   stamp the event with `USAV_ORG_ID` as a hard fallback (`orgId ?? USAV_ORG_ID`) — always thread
   `orgId` in new code or lifecycle events silently attribute to the USAV tenant.
2. **Workflow / Operations engine** — `src/lib/workflow/`. A generic node-graph engine that models a
   tenant's operation; each node (`nodes/`) is a **thin adapter over existing `src/lib/*` domain code**
   — it decides an output **port**, the engine decides **routing**. It runs as an **observer** in a
   strangler pattern: domain code does the real work and, after commit, calls `tapWorkflow()`
   (fire-and-forget, idempotent — never fails a production scan) to mirror the event into the graph.
   `applyTransition()` is the emerging mutate-and-tap chokepoint (collapses ~26 domain handlers).
   **Flag-gated, mid-migration** — not yet universal; some nodes exist ahead of their firing taps.
   Tap semantics (why taps often no-op): only `unit_received` **enrolls** a unit into the graph —
   every other event on an unenrolled unit is silently dropped; a completed (`done`) run re-enters
   only on `return_received` (re-enrolls at the org's returns-type node); fulfillment-tail taps pass
   an opt-in `expectNodeType` position guard (`listed`→`list_ebay`, `packed`→`pack`) so an
   off-position unit is left alone instead of parked blocked. `pack_verified` has a node but no
   domain site fires it yet.
3. **Operations Studio** — `/studio` (`src/app/studio/page.tsx`, `StudioShell`, backend `src/lib/studio/`).
   A single full-page canvas to model + observe the whole operation: L0 business map ⇄ L1 flow graph
   with numbered lifecycle states, Library + Inspector panes, 5 overlay lenses, view state in URL
   (`?v=&focus=&z=&lens=`). **Draft→publish editing is live** (`createDraft`/`saveDraft`/`publish`/
   `discardDraft` in `StudioShell`, plus `NodeConfigForm`, `DecisionRulesEditor`, Simulate panel);
   published definitions are read-only by design. Editing requires `studio.manage`; publish
   additionally requires step-up auth. Plan-gated by the `studio` entitlement, permissive by default.
4. **Multi-tenancy** — org-per-row on `organization_id` + Postgres RLS as backstop. Writes wrap in
   `withTenantTransaction(orgId, …)` which sets the `app.current_org` GUC. **See §7 — RLS is not yet
   live-enforcing.** Always keep an explicit `organization_id` predicate regardless.
5. **Auth & billing gates** — **two sanctioned route gates**: `src/lib/auth/withAuth.ts`
   (`permission`, step-up, trial-gate, entitlement-gate, audit floor) and the inline
   `requireRoutePerm()` (`src/lib/auth/dynamic-route-guard.ts`, for dynamic `[id]` routes). Per the CI
   manifest, **645 routes are permission-gated** across the two forms, 36 are authenticated without an
   explicit permission, and 73 are intentional exemptions (71 anonymous-by-design — public auth,
   signature-verified webhooks — plus 2 service-to-service; cron routes authenticate via `CRON_SECRET`).
   `permission-registry.ts` is the single permission SoT; `route-permission-manifest.ts` +
   `docs/security/route-permissions.json` keep the route↔permission map honest (CI-checked).
   `src/lib/billing/` holds Stripe + plan tiers + entitlements.

## 6. Data model — key tables by group

Schema: `src/lib/drizzle/schema.ts` (152 `pgTable`s). The groups that matter most:

- **Inventory/WMS** — `serial_units`, `serial_unit_provenance` (+ `v_serial_unit_origins` view —
  replaces the `serial_units.origin_*` columns, mid-strangler; see §2 "In flight"),
  `inventory_events` (lifecycle/audit spine), `sku_stock`,
  `sku_stock_ledger` (quantity deltas), `sku_catalog`, `sku_kit_parts` (pack BOM), `locations`,
  `bin_contents`, `cycle_count_*`, `stock_alerts`, `reason_codes`.
- **Receiving/inbound** — `receiving`, `receiving_lines`, `receiving_line_*` (putaway/testing/return/
  zoho/facts), `inbound_purchase_order_*`.
- **Orders/fulfillment** — `orders`, `sales_orders`, `order_unit_allocations`, `packages`,
  `shipment_links` (polymorphic owner↔tracking SoT), `fba_*`, `invoices`, `credit_notes`.
- **Repair/testing/warranty** — `unit_repairs`, `repair_service`, `testing_results`,
  `tech_verifications`, `warranty_*`.
- **Platforms/integrations** — `platforms`, `platform_accounts`, `platform_listings`, `ebay_accounts`,
  `amazon_accounts`, `zoho_*`, `organization_integrations` (per-tenant OAuth token SoT).
- **Identity/tenant** — `organizations`, `memberships`, `org_invitations`, `accounts`, `staff`,
  `roles`, `staff_roles`, `webauthn_credentials`, `staff_passkeys`, `billing_subscriptions`,
  `organization_feature_flags`.
- **Workflow/Studio** — `workflow_definitions/nodes/edges/runs/templates`, `item_workflow_state`,
  `station_definitions`, `station_activity_logs`.
- **AI/RAG** — `rag_documents`, `rag_document_chunks`, `ai_chat_sessions/messages`, `model_versions`.

**Read models / caching** operate at two layers. *DB-side:* materialized views `mv_bin_utilization`,
`mv_sku_velocity_30d`, `mv_dead_stock` (rebuilt **org-scoped** by `2026-06-26_report_views_org_scope.sql`;
refreshed nightly via `/api/cron/refresh-reports` with `REFRESH MATERIALIZED VIEW CONCURRENTLY`, which
**requires each view's unique index** — keep it if you change a view); `v_last_touch_*` projections;
trigger-maintained `sku_stock` / `item_stock_cache`. *Application-side:* a cross-instance Redis
cache-aside layer (`src/lib/cache/upstash-cache.ts`, Upstash over REST) — read-through `getOrSet`,
**org-scoped keys and tags** (`cache:v2:{ns}:{org}:{key}`), invalidate-on-write at the route
chokepoint, fail-open, kill-switchable (`REDIS_CACHE_DISABLED` / per-namespace `REDIS_CACHE_NS`), with
per-namespace hit/miss metrics at `GET /api/admin/cache-stats`. **Never cache live lifecycle/stock
state or a mutation response** — cache only stable sub-lookups (see `docs/todo/redis-caching-plan.md`
§11 for the never-cache registry). Realtime deltas go over Ably (separate from persistence). Deep dive:
[`DATABASE.md`](./DATABASE.md), [`REALTIME-AND-CACHING.md`](./REALTIME-AND-CACHING.md).

**Migration suffix convention (load-bearing):** the runner (`scripts/run-pending-migrations.mjs`)
globs `*.sql` only — `.sql.template` (the `app_tenant` role, manual per-DB step because it carries a
password), `.sql.gated` (two 2026-06-14 per-org PK swaps, FORCE-RLS prerequisites), and
`.sql.BLOCKED` (the serial_units origin-column drop, deploy-gated) are authored-but-unfireable.
**Renaming to `.sql` IS the deploy action** — never rename one without satisfying the gate documented
in its header.

## 7. Tenancy — current reality (important)

**RLS is live on the current DB for wrapped code paths.** (Earlier "RLS is inert" claims kept
regenerating because the proof lives in the gitignored `.env`, which doc-based scans can't see.)
The non-BYPASSRLS `app_tenant` role was provisioned manually 2026-06-28 (recorded in the
`2026-06-28_app_tenant_grants_reaffirm.sql` header — `rolbypassrls=f`), `TENANT_APP_DATABASE_URL`
**is set**, so `tenantPool` is a real second pool and the ~171 FORCE-enabled tables genuinely
isolate (cross-org canary verified 2026-06-28).

- **The two-pool split is the load-bearing rule.** The default owner pool (`src/lib/db.ts`) and the
  Drizzle neon-http `db` (`src/lib/drizzle/db.ts` — stateless HTTP, physically cannot carry the
  `app.current_org` GUC) connect as `neondb_owner` and **bypass RLS by design**
  (admin/cron/migrations). RLS only enforces on code going through the tenancy wrappers —
  `withTenantConnection`/`tenantQuery`/`withTenantTransaction` (`src/lib/tenancy/db.ts`) or
  `withTenantDrizzle` (`src/lib/drizzle/tenant-db.ts`) — which run on `tenantPool`. Any raw
  `pool.query` or drizzle-`db` call on a tenant table is unprotected regardless of FORCE.
- **Remaining gaps:** routes still on the GUC-less neon-http transport (migration target:
  `withTenantDrizzle`); CI's live tenancy checks skip when the `TENANT_APP_DATABASE_URL` GitHub
  Actions secret is unset, so they don't gate PRs (see §10); the `.template` role migration is the
  manual per-DB provisioning step for any **new** database, not an unapplied keystone.
- `USAV_ORG_ID` (`src/lib/tenancy/constants.ts`) is a **transitional constant — new code must not
  import it** (the file says so explicitly); read the org from `ctx.organizationId`/CurrentUser.
  Every new use is migration debt to pay before a second customer onboards. Beware the state
  machine's `orgId ?? USAV_ORG_ID` fallback (§5.1).

**Takeaway for any new code:** still keep explicit `organization_id` filters/inserts everywhere and
use `withTenantTransaction`; RLS is a backstop for wrapped paths, not a blanket guarantee. New tables
tenant-from-birth (`organization_id NOT NULL`, per-org keys, `enforce_tenant_isolation()` in the same
migration — see `.claude/rules/polymorphic-tables.md`). Full plan + generated coverage live in
`docs/tenancy/` (start at `README.md` and `multi-tenancy-execution-plan.md`).

## 8. Feature flags vs. plan entitlements (two separate systems)

- **Feature flags** (`src/lib/feature-flags.ts`) = product rollout / kill-switches. `readBoolEnv(name,
  default)` for sync env flags (e.g. `isUnifiedEngineApplyTransition`, `isFulfillmentSubstitution`,
  the `isPlacementStrangle*` cutover flags — most default **OFF** as no-ops until a migration lands and
  parity is verified). `resolveForOrg(orgId, flag, envVar)` for per-tenant staged rollout (reads
  `organization_feature_flags`, 30s cache, fail-open, env fallback). Admin surface: `/api/admin/features`.
- **Plan entitlements** (`src/lib/billing/`) = what a paying tier unlocks. `plans.ts` is the catalog
  (trial / starter / growth / pro / enterprise) with feature flags + hard ceilings (maxStaff,
  maxMonthlyOrders, maxIntegrations, maxWarehouses). **No prices live in the repo** — pricing lives
  in Stripe; each plan maps to a price id via env (`STRIPE_PRICE_STARTER/GROWTH/PRO/ENTERPRISE`).
  Enforcement kill-switches (all default **OFF**, fail-open, `USAV_ORG_ID` always exempt;
  per-org `organization_feature_flags` can force-grant): `STUDIO_ENTITLEMENT_ENFORCED`
  (`studio-gate.ts`), `PLAN_FEATURE_ENFORCED` (`plan-feature-gate.ts` — gates only the four
  registered features walkIn/sourcing/support/aiChat; other catalog features like fba have no
  registered gate and are never blocked), `TRIAL_ENFORCEMENT` (`trial-gate.ts`, bites only when
  plan === 'trial'). Route wiring: `withAuth(handler, { feature: '…' })` → 403 `FEATURE_GATED`.

## 9. Integrations

Behavior SoT: `src/lib/integrations/connectors/registry.ts` (16 providers; typed
`Record<IntegrationProvider,…>` so a missing provider is a compile error). Its **display** twin is
`src/app/settings/integrations/registry.ts` (labels/categories/connect method for Settings →
Integrations) — adding a provider touches **both**; never duplicate behavior bits into the display
catalog. **Connection state has two homes:** eBay/Amazon connected-orgs are read from their dedicated
account tables (`ebay_accounts`/`amazon_accounts` `is_active=true`); every other provider's
connection lives in `organization_integrations` (`status='active'`). The sync orchestrator
(`syncConnection` per-org, `runOrdersSyncAllOrgs` cron) dispatches on this split — a provider that
stores its connection elsewhere is silently never cron-synced. Credentials via a per-tenant
AES-256-GCM vault (`INTEGRATION_KMS_KEY`) or the **Nango** seam (dormant unless `NANGO_SECRET_KEY`
set; callers fall back to hand-built paths). Multi-source order sync runs through
`connectorsWithCapability('orders')`.

| Provider | Auth | Role | Status |
|---|---|---|---|
| **eBay** | OAuth | primary marketplace + order/purchase source | live |
| **Amazon SP-API / FBA** | OAuth | orders + inventory | live |
| **Zoho** (Inventory/Books) | OAuth | PO mirror + receiving + fulfillment sync | live |
| **ShipStation** | vault | label engine (rate/buy/void v2) + order pull (v1) | live (hand-built) |
| **Zendesk** | vault | returns/warranty seller-assist claims | live |
| **Square / Ecwid** | nango / vault | order sources | wired |
| **Stripe** | vault | billing | code built, live catalog pending |
| **Nextiva** | vault | voice (webhooks realtime + catch-up poll, `/api/integrations/nextiva/health`) | live |
| **Google Drive** | per-tenant OAuth (`drive.file`) | tenant-owned photo backup (no ingestion capability) | live |
| **Google Sheets, carriers (UPS/FedEx/USPS), Ably, Ollama** | mixed | transfer-orders, tracking, realtime, AI | mixed |

Deep dive: [`INTEGRATIONS.md`](./INTEGRATIONS.md), `docs/integrations/`, `docs/nango-sidecar-setup.md`.

## 10. Conventions & guardrails (read before writing code)

The hard rules live in **`CLAUDE.md`** and **`.claude/rules/`** (auto-loaded for agents). The load-bearing ones:

- **Backend** — `.claude/rules/backend-patterns.md`: status via `transition()`, route skeleton
  (`withAuth → validate → domain helper → map 404/409/200 → recordAudit → after()`), audit only via
  `recordAudit()` with `AUDIT_ACTION`/`AUDIT_ENTITY` constants, `clientEventId` idempotency,
  `withTenantTransaction` scoping, `Deps` injection for DB-free tests. The skeleton is the **target
  for new code, not universal current reality** (`recordAudit` appears in ~140 of ~755 route files,
  `clientEventId` threading in ~42) — follow it when adding or substantially editing a route; don't
  treat a missing piece in an old route as a bug to sweep-fix.
- **Source-of-truth invariants** — `.claude/rules/source-of-truth.md`: each mapping (condition
  grade→label/color, z-index, source-platform, copy-chip, SKU identity) has exactly one module;
  never inline or duplicate. Note: `items` (Zoho) and `sku_catalog` are two independent SKU numbering
  schemes — **never join on the SKU string**, they collide.
- **UI / display** — `.claude/rules/ui-design-system.md` + `contextual-display.md`: house style is
  simple/linear/icon-based; **four display archetypes** (station/workbench/monitor/canvas) — pick one
  per region, never blend. Color only from `design-system/tokens/colors/semantic.ts`; z-index only
  from the named scale; motion through the `useMotionPresence`/`useMotionTransition` hooks.
  **Dark mode is not Tailwind `dark:`** — it's a scoped CSS remap under `html[data-theme="dark"]` in
  `src/styles/globals.css` that re-colors existing utilities (`.bg-white` → `#0f172a`, …); there is
  no `darkMode` config, so `dark:` classes would follow the OS preference and ignore the app's theme
  toggle — never write them; new colors go through semantic tokens or a remap rule. (Caveat:
  opacity-modified `bg-white/80` and arbitrary-value utilities are not remapped.)
- **New polymorphic tables** — `.claude/rules/polymorphic-tables.md`. **Build gotchas** —
  `.claude/rules/build-gotchas.md` (Turbopack silent-failure traps: e.g. `tailwind.config.ts` must
  import the z-index token with an explicit `.ts` extension or all `z-*` utilities drop in dev).
- **Git workflow** — work only on `main`, never branch, never `git stash` (the user commits mid-session
  via GitHub Desktop), don't commit/push unless asked. Never commit `.env` (~113 live secrets;
  `.env.example` is the blank committed template — see [`ENV-VARS.md`](./ENV-VARS.md)).

**Testing** — unit tests are `node:test` + `tsx`, co-located `src/**/*.test.ts` (CI glob-discovers
new ones automatically; domain fns use `Deps` injection to run DB-free). **Playwright E2E does NOT
run in CI** — local only, against a running dev server (56 specs in `tests/e2e/`, `workers: 1`,
`desktop` + `mobile` projects, admin `storageState` seeded by `global-setup`); a green CI says
nothing about E2E, so run `playwright test` locally when touching a covered flow. A second E2E
family lives in standalone `scripts/e2e-*.mjs/.ts` scripts (station-serial, fba-sidebar,
workflow-tap, pipeline, …), mostly behind `npm run test:e2e:*` aliases — `tests/e2e/` is not the
whole E2E surface.

**CI guards** (`.github/workflows/ci.yml`) — the **hard gates** that fail a PR: lint
(`--max-warnings=0` — one new ESLint warning fails), `tsc --noEmit`, the unit-test glob (the DS
guards — no raw `<button>`, no `title=`, no hardcoded hex, typography tokens — run via this glob as
`*.guard.test.ts`, not a named step), `knip` (no new dead code vs `knip-baseline.json`),
`audit-route-auth` (every verb gated or exempted) + route-permission manifest drift. **The tenancy
gates do NOT currently fail a PR:** the static guard runs `continue-on-error: true` (advisory,
over-counts ~230 false hits) and the live role-invariant/cross-org canary steps exit 0 whenever the
`TENANT_APP_DATABASE_URL` GitHub secret is unset.

**Agent skills** (`.claude/skills/`) scaffold the common tasks the right way: `new-route`,
`db-migration-author` → `db-migrate`, `org-scope`, `station-block`, `workflow-node`, `sidebar-mode`,
`ops-studio`, `reseller-flow`, `domain-unit-test`, `integration-connector`, `knip-prune`.

## 11. Cron & background surface

35 Vercel cron entries (`vercel.json`, 30 distinct `/api/cron/*` paths — some scheduled multiple
times with different query params): shipping sync/reconcile/metrics, Zoho PO/fulfillment/orders sync,
Amazon/eBay/Square/integrations sync, receiving tracking, Google-Sheets transfer-orders, staff-goals,
inventory drift, stock-alerts, sourcing scan/scour, sku-catalog, refresh-reports (materialized
views), cleanup, photos analyze/nas-mirror/drive-mirror. Every cron route funnels through
`withCronRun` (`src/lib/cron/run-log.ts` — persists each invocation to `cron_runs`:
running → success/failed, duration, summary jsonb; display registry `src/lib/cron/registry.ts`);
auth is `isAuthorizedCronRequest` (`src/lib/cron/auth.ts`, Bearer `CRON_SECRET` — a Vercel Sensitive
var); cron edits go through the `vercel-cron-sync` skill. **Two distinct locks:** cron overlap is
guarded by `withCronLock` (`src/lib/cron/lock.ts` — a Postgres session advisory lock,
`pg_try_advisory_lock(hashtext(job))`, that **skips** an overlapping run `{ran:false}` rather than
waiting; global, owner pool, no Redis). Upstash Redis backs three best-effort/fail-open primitives, all
sharing the consolidated client `src/lib/redis/client.ts`: `redisAdvanceLock` (the **workflow-tap**
lock), `withCacheLock` (`src/lib/redis/cache-lock.ts` — the cache single-flight/stampede guard), and
the distributed rate limiter (`src/lib/api-guard.ts`). In every case correctness comes from event-gated
idempotency (or a DB fallback), never the lock.

## 12. Glossary (fast reference)

- **Serial unit** — a single physical serialized item; the atom the state machine tracks.
- **Station** — a staff work surface (tech/packer/receiving/support/admin); also a composable
  builder concept (`src/lib/stations` blocks).
- **Tap** — the workflow engine's after-commit observer call (`tapWorkflow`) mirroring a domain event
  into the graph. Fire-and-forget + idempotent.
- **Strangler** — the migration pattern where the new engine runs alongside legacy handlers, flag-gated,
  observing until parity is proven.
- **GUC** — the `app.current_org` Postgres session variable that scopes tenant queries/RLS.
- **Entitlement vs. flag** — entitlement = paid-tier capability (`billing/`); flag = rollout switch
  (`feature-flags.ts`). Different systems (§8).
- **LPN / handling unit** — `H-####` testing tote spanning POs.
- **SoT** — source of truth; the single module that owns a mapping (see `.claude/rules/source-of-truth.md`).

## 13. Where to go next

- **Deep architecture** — [`INDEX.md`](./INDEX.md) (ARCHITECTURE, API-ROUTES, DATABASE, STAFF-SYSTEM,
  PIPELINE, REALTIME-AND-CACHING, UI-PATTERNS, per-workflow docs, ENV-VARS, HOOKS).
- **Product overview** — root `README.md`; discovery report `DISCOVERY.md`.
- **What's in flight** — `docs/todo/` (planned), `docs/partial/` + `docs/partial/HUMAN-TODO.md`
  (owner-gated), `docs/roadmap/MASTER.md`.
- **Diagrams** — `docs/diagrams/` (module graph, ER, order lifecycle).
- **Selling it** — `docs/sellable-foundation-execution-plan.md`, `docs/tier0-go-live-runbook.md`.
- **Agent rules** — `CLAUDE.md` + `.claude/rules/*.md` (auto-loaded; the hard rules override defaults).
