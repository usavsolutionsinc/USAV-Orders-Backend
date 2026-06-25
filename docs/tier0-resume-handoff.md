# Tier 0 Sellable-Foundation — Resume Handoff

**Purpose:** pick this initiative up *cold*, with no prior context, and continue safely. The goal is a **tenant-safe + billable v1** — the platform is technically safe to sell to a second organization and can take their money. This document is the single entry point: where we are, the two owner-gated keystones, exactly what's done, exactly what's left (prioritized), the proven migration pattern with code, the gotchas that already bit us, and how to verify.

**Companion docs**
- `docs/tier0-execution-checklist.md` — living line-item tracker (`[x]/[~]/[ ]`, **[you]** = owner step).
- `docs/tier0-go-live-runbook.md` — the two owner keystones with exact commands.
- `docs/tenancy/multi-tenancy-execution-plan.md` — the deep RLS spine + phase sequencing.
- `docs/tenancy/_analysis/{tables,realtime,cron,infra,repos,routes,critique}.md` — per-subsystem deep specs.
- `docs/saas-commercialization-plan.md` — revenue/GTM context (Phase 0 catalog done).
- `docs/phase-1-rls-plan.md` — **superseded** role decision (kept for history; the BYPASSRLS keystone below overrides it).

**Agent memory (auto-loaded each session):** `tier0-sellable-foundation-progress`, `sellable-foundation-prioritization`, `multi-tenancy-hardening-prompt`, `saas-commercialization-plan`.

Last updated: 2026-06-14.

---

## ⭐ STATUS UPDATE — 2026-06-23 (this supersedes the "0 FORCEd / E1 pending" snapshots below)

The two keystones landed and the enforcement rollout is **done**. Verified against the live DB:

- **E1 DONE.** `app_tenant` (NOBYPASSRLS) is live; `TENANT_APP_DATABASE_URL` set; two-pool split active; cross-org canary green. The runtime tenant pool is RLS-subject.
- **E2 DONE — 117 tenant tables FORCEd & verified isolating** (started at 0/9), via 13 guarded per-table migrations (`2026-06-16` leaf cohorts + reason_codes, `2026-06-22*` ready_cohort/core_lowfanin/nullable_business/sku_platform_ids/core_usav_fallback/loudfail_verified/remaining_business, `2026-06-23*` engine/kpi_photos). Includes the whole high-traffic core (orders, items, sku, sku_catalog, sku_stock, inventory_events, work_assignments, locations, fba_*, the workflow ENGINE tables) — direct probes show 0 cross-org rows. The 10 unforced are platform/system/global BY DESIGN (external `hermes_*`, platform `pipeline_*`/`training_*`, global STN); `workflow_nodes`/`edges` are child-scoped via the FORCEd `workflow_definitions`.
- **C (route GUC-scoping) DONE** (agent waves + owner Wave-1/2 commits). Remaining file-level audit hits are false-positives (owner-pool idempotency/audit, or helper-delegated the static scan can't see through). **D1 (Ably) DONE** (channels require orgId, token endpoint org-scoped + fail-closed). Crons fan out per-org. C5 repos on `withTenantDrizzle`; `recordTestVerdict` OFF-path org-scoped.
- **The safe FORCE recipe:** tenant-owned + armed policy + (usav-fallback default OR every INSERT stamps org) + NOT NULL (SET NOT NULL after verifying 0 nulls) + non-platform/system; guarded per-table FOREACH migration. FORCE is dual-pool-safe (owner bypass / tenant-pool GUC; no direct `tenantPool` usage).

**What's LEFT (all human-owned, deploy-coupled, or deferred-product — an agent cannot safely do these on live prod):**
1. **[you] Stripe go-live** (Keystone #1 below) — env + `setup-webhook-and-portal.mjs`; still the highest revenue-blocking gap.
2. **[you, deploy-coupled] Composite-key uniqueness** — `sku_catalog`/`fba_fnskus` are FORCEd but still carry global `UNIQUE(sku)`/`PRIMARY KEY(fnsku)` → a tenant #2 can't insert a sku/fnsku org A already has. Apply `2026-06-14_sku_catalog_composite_unique.sql.gated` + `_fba_fnskus_composite_pk.sql.gated` **WITH** the `ON CONFLICT (organization_id, …)` code flip in the same deploy (or first rewrite the upserts to org-scoped SELECT-then-upsert to decouple — the bose_models pattern). Latent (no dogfood break).
3. **Phase F (deferred-product, P2):** full owner email auth + verification (signup already captures `email`); F4-lite onboarding for a fresh org; F3 per-org roles (kept global today by design); legal baseline (ToS/privacy/DPA).
4. **Optional hardening:** move the workflow engine store off `neon-http` onto `withTenantDrizzle` (engine already FORCEd + explicit-predicate-scoped + owner-bypass, so this is defense-in-depth on a hot path — not required).

---

## 0. The one-paragraph orientation

This is a single-codebase, single-database, multi-tenant SaaS. Tenancy is keyed on `organization_id` (the dogfood "USAV" org is `00000000-0000-0000-0000-000000000001`). The multi-tenant *skeleton* is built (orgs table, GUC plumbing, signup, Stripe code, RLS infra functions). The work is **hardening and wiring**, not a rewrite. Two things gate everything: (1) **Stripe live config** so we can charge, and (2) the **`app_tenant` DB role** so RLS can actually apply (today the app connects as a BYPASSRLS owner, making every RLS policy inert). Both are *owner* (human) steps — an agent cannot run them. Everything an agent can do is request-path leak-closure, write-correctness fixes, per-org cron conversion, and Phase B schema columns — all of which is *prepared-but-unenforceable* until the two keystones land.

---

## 1. TL;DR — current state

- The **logical-RLS** tenant-isolation initiative is well underway, has been through a codebase-wide adversarial audit, and the **build is green** (`tsc` clean except unrelated eBay/Amazon WIP; 5 tenancy e2e specs + the unit suites pass).
- **Physical DB-per-tenant was evaluated and rejected** as a verified trap for this codebase (see §2). Logical RLS is the confirmed path.
- **Nothing is `FORCE`-enforced yet.** That is gated on the owner step **E1** (the `app_tenant` role). Everything completed so far is request-path leak closure + write correctness + the enablement wiring that makes an *incremental*, non-breaking rollout possible.
- A codebase-wide adversarial audit (8-agent investigate → verify → synthesize) found **8 real cross-tenant defects** (all single-tenant-inert, so tests passed) plus 3 recommended follow-ups — **all fixed, re-verified, tsc-clean, e2e re-confirmed.**
- **Ground-truth numbers (live DB, Phase A scan):** 173 tables, 93 with `org_id`, **0 FORCEd**; 572 routes, 7 GUC-wrapped, 342 raw-pool, **243 critical + 158 high** leak routes. These move as the burn-down proceeds — always regenerate (see §7) rather than trusting this snapshot.

---

## 1b. Production-readiness scan (2026-06-14) — what actually breaks, and when

Two distinct failure classes. Don't conflate them.

**Class A — breaks in production NOW (single tenant, today). → SCANNED, CLEAN.**
The acute risk is the *loud-fail write-bug*: a table whose `organization_id` default is `NULLIF(current_setting('app.current_org'),'')::uuid` **and** `NOT NULL` will throw a not-null violation on any INSERT that neither sets the GUC nor stamps org. There are **23 loud-fail tables** (regenerate: `grep loud-fail docs/tenancy/org-id-coverage.generated.md`). Verified:
- Every raw-SQL INSERT into all 23 stamps `organization_id` in its column list (0 misses), via explicit `ctx.organizationId`, **subquery-derive** (`(SELECT organization_id FROM <parent> WHERE id=$n)`), or `USAV_ORG_ID` for the one session-less sync (`zoho-receiving-sync.ts`).
- The 2 Drizzle `.insert()` paths into loud-fail tables (`workflow/store.ts` → workflowRuns, itemWorkflowState) stamp org.
- `repairs-queries.ts` (the memory-flagged `unit_repairs` / `repair_failure_resolutions`) uses subquery-derive — **fixed**.
- No `UPDATE … SET organization_id = NULL` anywhere. `inventory_events` is usav-fallback (not loud-fail), so its high-traffic writers don't loud-fail.
- **Verdict: no NOT-NULL write-bugs remain.** Re-run the scan after any new Phase-B `NOT NULL` column lands (that's what re-arms this class).

**Class B — breaks at tenant #2 (cross-tenant data exposure). → MOSTLY CLOSED at the request layer.**
Reads/writes that return/mutate another org's rows once a 2nd tenant exists. The **cold domains AND the hot core are now swept** (3 workflows, ~370 agents, 2026-06-14b): 225 critical/high route files + 7 backbone modules + 51 shared query/aggregator modules made org-aware; **critical 178→49, high →30, GUC-wrapped 59→225** (route-file metric; undercounts helper-pattern domains). tsc clean, guard green. The remaining **49 critical / 30 high are categorized + deferred-by-design** (see checklist): **identity/RBAC layer** (`/api/auth/*`, `/api/admin/staff|roles/*` — Phase F, establishes org), **session-less sync/webhooks** (Zoho/Ecwid/Square/UPS — Phase D, need payload-org/`forEachActiveOrg`), and **NEEDS-COL** tables (no org column — GUC-wrap is plumbing until the columns land). Column migrations written, unapplied: `2026-06-14_org_id_phase_b_needs_col.sql` (suppliers/square_transactions/warehouses/sourcing_*/rma) + `…needs_col_2.sql` (28 more: product_manuals, staff_stations, shipping_tracking_numbers, zoho_po_mirror, messages, operations_kpi_*, …). After those apply + their session-less writers thread org → FORCE per table.

**Class C — owner keystones. → E1 EXECUTED + STAGED (2026-06-14c); live cutover blocked on a redeploy.**
- ✅ `app_tenant` role CREATED on Neon (rolbypassrls=false, rolsuper=false) with full DML grants on all 181 tables + default privileges. **Validated against the live DB:** as `app_tenant`, RLS isolates correctly (product_manuals: GUC=USAV→393 rows, other-org→0, unset→0), grant coverage 181/181, writes permitted. `ENABLE` RLS already bites for the non-bypass role on all 115 armed tables — so this role + the env below = enforcement (no per-table FORCE needed; FORCE is redundant + would trip the guard under the BYPASSRLS owner).
- ✅ `TENANT_APP_DATABASE_URL` (the app_tenant DSN) SET in Vercel **Production** (encrypted). Inert until a redeploy; `DATABASE_URL` stays = owner (two-pool: raw routes bypass, GUC paths enforce).
- ✅ Safety prep applied: `needs_col`/`needs_col_2` columns + `org_id_needs_col_usav_default` (defaults → COALESCE(GUC, USAV) so session-less owner-pool inserts never produce NULL-org rows that RLS would hide). 0 NULL-org rows across all 115 armed tables.
- ⛔ **BLOCKED: the activating redeploy fails** at `pnpm install` on the in-flight `motion-plus` private tokened dep (`api.motion.dev/registry?...&token=`) — not the tenancy work. Lockfile was regenerated/committed (fixed the frozen-lockfile check) but motion-plus won't install on Vercel's build machine (token/registry). **Enforcement auto-activates on the next SUCCESSFUL production deploy.** To deploy without activating yet: `vercel env rm TENANT_APP_DATABASE_URL production` first. Rollback after activation: same `env rm` + redeploy (reverts GUC paths to owner instantly).
- Still owner-only: Stripe live config (note: `STRIPE_WEBHOOK_SECRET` is already set in prod) + the composite-PK `.sql.gated` migrations (coordinated code+migration deploy). **Migration progress (2026-06-14c):** the additive NEEDS-COL column migrations (`needs_col` + `needs_col_2`, 35 tables) are **APPLIED to the live DB** (nullable + USAV-backfill + armed RLS; zero behavior change — owner pool bypasses). Still **gated/deploy-coupled (NOT applied):** the composite-PK migrations (`*.sql.gated`) — they must redeploy *with* the `ON CONFLICT (organization_id, …)` code flip or live prod upserts break. Until **E1** (the non-BYPASSRLS `app_tenant` role on Neon + `TENANT_APP_DATABASE_URL` in Vercel — a console/env step the agent cannot do), every armed RLS policy on every columned table is **inert** (the owner pool bypasses RLS). E1 is the single switch that flips all of this prepared isolation from "ready" to "enforced."

**Bottom line:** the platform is safe to keep running for the single (USAV) tenant — Class A is clean. It is **not yet safe to onboard tenant #2** until the hot core is swept + Class C lands.

---

## 2. Why logical RLS, not physical DB-per-tenant (settled — do not relitigate)

Physical DB-per-tenant is a **verified trap** here, confirmed by the user 2026-06-13. Three code facts force it:

1. **Org identity is resolved by a DB query.** `loadSession` reads `staff_sessions.organization_id` through the single shared pool. You cannot pick a tenant DB without *first* splitting sessions/staff/orgs/roles onto a control DB and rewriting the auth core.
2. **One module-level pool, imported everywhere.** `export default pool` is imported across **522 files** with zero per-request threading and no `AsyncLocalStorage`. Making it tenant-aware needs an ALS proxy whose failure mode (any query outside the request store) *is* the cross-tenant leak — strictly more dangerous than RLS.
3. **The GUC plumbing is needed anyway.** The `org_id` NOT-NULL default is `NULLIF(current_setting('app.current_org'), '')::uuid`, so per-DB does not skip the GUC plumbing.

**Decision:** ship the logical-RLS vertical slice over the ~15–25 hot tables. If a partner ever demands physical isolation *now*, the escape hatch is a **separate Vercel deployment** with its own `DATABASE_URL` + `STRIPE_*`/`PLAN_PRICE_*` env (zero code), **not** an in-app router.

---

## 3. The two keystones — OWNER steps that unlock everything

Both have exact commands in `docs/tier0-go-live-runbook.md`. They are independent and can both be done now.

### Keystone #1 — Stripe go-live (so we can charge)
The billing loop is **fully built in code** (checkout/portal/webhook with hand-rolled HMAC signature verify + `stripe_events` idempotency). The live catalog **exists** in `acct_1QgG6jLvhV85DRvt` (4 products + 6 monthly/annual prices, `metadata.plan`; Enterprise intentionally price-less). What remains is **outward config**, not code:

1. **[you]** Run `STRIPE_SECRET_KEY=sk_live_… node scripts/stripe/setup-webhook-and-portal.mjs --live` (idempotent; creates the webhook endpoint + billing-portal config; prints the `whsec_…` once + the live `STRIPE_PRICE_*` block).
2. **[you]** Set in Vercel **Production** then **redeploy** (env is build-baked):
   - `STRIPE_WEBHOOK_SECRET` = the `whsec_…` — **currently UNSET everywhere → the single highest go-live risk** (customer is charged, nothing mirrors, plan never flips).
   - confirm `STRIPE_SECRET_KEY` = `sk_live_…`, `STRIPE_PUBLISHABLE_KEY` = `pk_live_…` (not test).
   - the 3 **live** price ids (carry `…LvhV85DRvt…`, **not** the local test `…Q2odN2RRiM…`):
     - `STRIPE_PRICE_STARTER=price_1Tht1iLvhV85DRvtUFc2ovPV`
     - `STRIPE_PRICE_GROWTH=price_1Tht1lLvhV85DRvtCAtAI1Xj`
     - `STRIPE_PRICE_PRO=price_1Tht1nLvhV85DRvtrny4be3Z`
   - leave `STRIPE_PRICE_ENTERPRISE` unset; set `NEXT_PUBLIC_APP_URL` + `BILLING_NOTIFICATION_DOMAIN` to the real domain.
3. **[you]** Smoke-test on `/settings/billing`: Upgrade → Checkout (`4242…` in test first, then a real card) → confirm `billing_subscriptions` mirrors + `organizations.plan` flips → open portal → cancel → confirm it flips back.

**Already shipped (code):** catalog created; webhook route deployed (`POST /api/billing/webhook` → 400 `INVALID_SIGNATURE` on prod, i.e. live); `Stripe-Version: 2024-06-20` pinned; `items[].current_period_*` fallback (else a fresh live acct persists NULL periods → "—" in UI); webhook idempotency gate (record + skip dup before any mutation); webhook **retry-safety** (returns 500 on handler error so Stripe retries instead of silently dropping; `recordStripeEvent` returns `shouldProcess`, `markStripeEventProcessed` stamps only after success; migration `2026-06-14_stripe_events_processed_at_nullable.sql`); removed the no-JS `<form>` wrapper around `UpgradeButton`; portal config auto-creation (first config becomes the account default, so `/api/billing/portal` works as-is).

**Known caveat:** `organizations`/`staff` have **no email column**, so checkout's `billing+slug@…` fallback email can't be cleanly fixed without persisting the signup email. Set `BILLING_NOTIFICATION_DOMAIN` meanwhile; persisting signup email is F1 work (§5.E).

### Keystone #2 — E1, the `app_tenant` role (so RLS can apply)

**Why it's the keystone:** the app connects as `neondb_owner`, which has `rolbypassrls=TRUE`, and **BYPASSRLS overrides FORCE**. So `enforce_tenant_isolation()` is **inert** until the runtime's tenant-scoped paths connect under a **new, non-bypassrls, non-owner role** (`app_tenant`). This overrides `phase-1-rls-plan.md`'s "keep neondb_owner + FORCE" decision (that path ships RLS that looks on but is fully bypassed).

**The architecture (already wired in `src/lib/db.ts` — inert until env is set):**
- Default `pool` (`@/lib/db`) stays on `DATABASE_URL` = **owner**. Un-migrated raw-pool routes, migrations, MV refresh, cron org-enumeration, and the AI read path keep working (owner bypasses `ENABLE`-but-not-`FORCE` RLS).
- `withTenantConnection` / `tenantQuery` / `withTenantTransaction` / `withTenantDrizzle` run on `tenantPool` = `TENANT_APP_DATABASE_URL` (the `app_tenant` role) when set — those paths become RLS-subject.
- A table is `FORCE`-enforced only once **all** routes touching it are GUC-wrapped onto `tenantPool`. That's the per-table gate.
- **Key insight that shaped this:** under a non-owner role, `ENABLE` RLS bites *without* `FORCE`. So the exec-plan's big-bang `DATABASE_URL=app_tenant` would break all ~340 raw-pool routes at once. The two-pool split (default=owner, wrappers=app_tenant) lets per-table `FORCE` roll out **incrementally with no big-bang and no separate `ADMIN_DATABASE_URL`**.

**Steps:**
1. **[you]** Apply `src/lib/migrations/2026-06-21_app_tenant_role.sql.template` in the Neon SQL console (replace `:'app_tenant_pw'` with a strong secret — **do not commit it**). Verify: `SELECT rolname, rolbypassrls, rolsuper FROM pg_roles WHERE rolname='app_tenant';` → expect `app_tenant | f | f`.
2. **[you]** Run the canary (proves RLS isolates a scratch table under the role — no prod-table impact): `TENANT_APP_DATABASE_URL=<app_tenant DSN> node --test --import tsx src/lib/tenancy/cross-org-isolation.test.ts`.
3. **[you]** Set `TENANT_APP_DATABASE_URL` = app_tenant DSN in Vercel Production (+ `.env.local`); keep `DATABASE_URL` = owner; redeploy. Now the already-migrated GUC paths run as `app_tenant`. **No table is FORCEd yet, so nothing breaks.**
4. **[you]** Confirm the guard: `npm run tenancy:guard:check` (invariant B confirms `bypassrls=false` on the runtime role).
5. **Enforce per table** (FORCE), easiest first — see §5.D for the order.

**Until E1, every additional table migration just adds prepared-but-unenforceable surface.** That is still useful (it closes request-path leaks that matter the moment a 2nd tenant exists), but it does not "turn on" isolation.

---

## 4. DONE — the baseline a fresh session can trust

### Tables migrated (request paths, tsc-clean, leak-audited)
| Table | State | Notes |
|---|---|---|
| `reason_codes` | ✅ full | `reason-codes-queries.ts` helpers required-`orgId` + `tenantQuery` + explicit filter; `route.ts` (GET/POST) + `[id]/route.ts` (GET/PATCH/DELETE). FORCE-ready pending E1 + the `warranty/reports.ts` `LEFT JOIN reason_codes` label lookup needing GUC-scoping. |
| `fba` (core) | ✅ request paths | 6 shared helpers (`createFbaLog`/`upsertFnskuCatalogRow`/`replaceTrackingAllocations`/`addFnskuToPlan` + 2 tech SAL helpers) required-`orgId`; 5 route groups (~35 routes); `fetchFbaContext` threaded. Fixed a real cross-tenant `fnsku`-join leak (`fba/shipments/[id]/items` GET). |
| `warranty` (read + write) | ✅ + prod-bug fix | Read path: `claims.ts` readers + 6 read routes thread `ctx.organizationId`. Write path org-stamped — **fixed a prod bug where claim creation 500'd on NULL org** (raw-pool INSERTs relied on a GUC default that's never set). Write-IDOR closed (writes now org-precheck via `getClaimTicketRef`→404). |
| `sku_catalog` (core CRUD + graph) | ✅ + write-bug fix | Row/platform helpers backward-compatible optional-`orgId` (session-less Zoho callers untouched); routes `route`/`[id]`/`search`/`resolve`/`[id]/similar`/`[id]/platform-ids` + graph `children`/`parents`/`tree`/`relationships`. Fixed `createRelationship` NULL-org write bug + closed graph-read cross-org traversal vectors. |
| `receiving` (C4 severe leaks) | ✅ partial | `receiving-lines/route.ts` (all CRUD org-scoped; sku_catalog/receiving/serial_units joins org-aligned; POST stamps org) + `receiving/match/route.ts` (`withTenantTransaction`). Verifier caught + fixed: `photos` COUNT ×4 + `email_delivery_signals` EXISTS leaks. |
| `local_pickup_*` (walk-in) | ✅ full | All 10 routes GUC-safe (`local-pickup-orders` tree + `local-pickups`). Reads org-filtered/GUC-wrapped; `sku_catalog`/`sku_platform_ids`/`items` string joins org-aligned; added a parent-ownership guard on the `local-pickups` upsert/delete (receiving_id IDOR). 3 tables now all-`low` → FORCE-ready post-E1. (2026-06-14) |
| `cycle_count_*` | ✅ full | 4 API routes + both `/admin/inventory/cycle-counts` server-component pages (page reads → `tenantQuery`, server actions resolve org via `getCurrentUser()`) + the `cycle-count.ts` module (5 fns now require `organizationId`). In-domain leaks closed; the `lines/[id]` variance write still flows through the shared `adjustBinQty`/`recordInventoryEvent` (tracked under `bin_contents`/`inventory_events`). (2026-06-14) |
| **Parallel sweep R1 (9 domains)** | ✅ GUC plumbing | `tier0-tenant-sweep.js` workflow (33 agents, disjoint-fileset partition): **locations, staff-messages, suppliers-sourcing, stock-alerts, staff-scheduling, rma, workflows-engine, catalog-types-platforms, square**. GUC put in the `*-queries.ts` helpers (optional/required-org) — so the **route-local audit UNDERSTATES this** (it only sees `tenantQuery` in route files). Verified helpers use the GUC pattern. **Caveat:** `suppliers`/`square_transactions`/`warehouses`/`sourcing_*`/`rma_authorizations` are NEEDS-COL — GUC wrap is RLS-ready *plumbing*, not isolation, until `2026-06-14_org_id_phase_b_needs_col.sql` (column) + writer threading + FORCE. (2026-06-14) |
| **Parallel sweep R2 (5 domains)** | ✅ GUC plumbing | **printer-profiles, payroll-settings, item-stock-cache, auth-audit, sku-pairing-audit** (23 agents). Confirmed the rest of the cold surface is exhausted: 8 domains correctly dropped — `pending_skus` is DEAD CODE, the others are child-scoped-no-column or cross-cutting modules tangled with the hot core. **STRUCTURAL follow-ups** (need a per-org column/design decision, NOT a GUC-wrap): `payroll_settings` (global `id=1` singleton), `product_manuals` (backfill string-match leak), kpi_rollups, mobile_scan_events, failure_modes, unit_quality_*. **Heads-up:** the sku-pairing migration touched `pairing-queries.ts` which is adjacent to live pairing UI work — review that diff before committing. (2026-06-14) |

### Two prod write-bugs fixed (the write-bug class — see §6)
- **warranty**: `createClaim` (+ `insertEvent`/`repair_attempts`/bulk-events subquery-derive), `quotes.ts`/`linkage.ts`/`zendesk-link.ts`/`notify.ts`, and the `clock-sweep` cron — every `warranty_*`/`repair_service` INSERT now stamps `organization_id`. `warranty-zendesk` e2e passes.
- **sku**: `createRelationship` in `sku-relationship-queries.ts`.

### Infra / cross-cutting (all tsc-clean)
- `withTenantConnection` **hardened**: runs in a transaction with `SET LOCAL` so the org GUC auto-clears (no stale-GUC-on-pooled-client leak post-enforcement); `withTenantTransaction` delegates to it.
- `tenantPool` two-pool wiring in `src/lib/db.ts` (the E1 architecture above).
- `withTenantDrizzle(orgId, fn)` — `src/lib/drizzle/tenant-db.ts` (C5): Drizzle over the WS pool inside `withTenantConnection`, so neon-http-only repos can carry the GUC.
- `forEachActiveOrg(fn)` — `src/lib/cron/for-each-org.ts` (D2): per-tenant cron sweep (enumerates on the shared pool today; switches to the owner pool post-E1).
- **Audit-log org-stamping** (D4): `recordAudit` auto-stamps `ctx.organizationId` (cron/transitional callers use `organizationIdOverride`); `createAuditLog` writes `organization_id` (was always NULL). Backward-compatible, zero call-site changes.
- **Rate-limit** (D5, partial): `checkRateLimitForOrg({…, organizationId})` wrapper + a PROD boot-warning when `UPSTASH_REDIS_*` is unset (it was silently failing open under autoscale).
- **PO-Gmail token guards** (D3): `assertUsavMailbox` + USAV-default on `getAccessToken`/`poGmailFetch`/`getConnectedEmail`; fixed a latent index-as-orgId bug; `disconnect`/`oauth-callback`/`status` now `assertUsavMailbox`-guarded.
- **Stripe webhook retry-safety** (see Keystone #1).

### Schema
- **Phase B applied to live DB** (`2026-06-13g` catalog + `2026-06-14_org_id_phase_b_domain_children`): the latter added `organization_id NOT NULL DEFAULT <GUC>` + FK + idx + armed-but-inert RLS to 9 child tables (`handling_units`, `receiving_scans`, `receiving_shipments`, `testing_results`, `repair_actions`, `unit_repairs`, `repair_failure_resolutions`, `local_pickup_orders`, `local_pickup_order_items`). The GUC default **loud-fails inserts without `app.current_org`**, so applying it broke raw-pool/no-GUC writers — **writer fix shipped (commit `69cd4131`):** explicit `organization_id` on each insert (inherit from parent via subquery for child tables; thread `ctx.organizationId` for `handling_units` + `local_pickup_orders`; eslint-disabled `USAV_ORG_ID` for the ctx-less Zoho background sync).

### Realtime
- **Ably D1** isolation (~95% built; channels `org:{uuid}:` namespaced with throw-on-non-uuid, token endpoint rewrite, ~75 publishers + subscriber hooks). Fixed the 2 missed bare-literal subscribers (`OperationsDashboard.tsx`, `StudioShell.tsx`/now `StudioWorkspaceContext`) + org-scoped `getPrimaryTechStaffIds(orgId)`.

### Quality gate
- **Codebase-wide audit + fix loop complete** (8-agent audit → 12-agent fix, 2026-06-14): verdict = sound design + GREEN gate (`tsc` 0; e2e 5/5; unit stripe 6/6 + warranty 41/41 + auth 43/43 + tenancy GUC 3/3 on live DB). The 8 real defects fixed: (a) warranty clock-sweep NULL-org INSERTs; (b) tech/scan raw-pool `fba_*` read+write; (c) `fba/logs/summary` `tech_serial_numbers` CTE leak; (d) warranty lifecycle write-IDOR; (e) sku-catalog unpaired-ecwid read leak; (f) pair-ecwid write leak; (g/h) po-gmail disconnect+oauth-callback (+status). Plus 3 follow-ups: `warranty/coverage.ts` `resolveOrder`+`findExistingClaim` org-scoped; Stripe webhook retry-safety; regenerated coverage docs (`child_scoped` 49→42).

---

## 5. WHAT'S LEFT — prioritized

> **Always check the footprint before grinding a table** (§6). The user edits in parallel; grind the *coldest* area.

### A. Finish request-path table migrations (Phase C — the long pole; ~390 critical/high routes)
Driven off `docs/tenancy/route-scoping-audit.generated.md` (regen: `npm run tenancy:routes`).

- [ ] **`orders`** — biggest (~91 routes; `src/lib/neon/orders-queries.ts` + many routes). **User's hot zone** (Amazon integration WIP). Session-less writers: Zoho/eBay/Amazon order sync → optional-`orgId` on shared helpers.
- [ ] **`serial_units`** (~32 routes). C4 write leaks: `serial-units/[id]/grade`, `move`, `allocate`, `hold`, `release`. Watch the shared `src/lib/inventory/state-machine.ts` (used by all of grade/move/hold/release/allocate) and the Drizzle `repositories/inventory/allocations.ts` (`order_unit_allocations`) — that one needs `withTenantDrizzle`. **User's hot zone** (inventory hold/release edited recently).
- [ ] **`receiving` full sweep** — the ~65 routes beyond `receiving-lines`/`match`.
- [ ] **`sku_catalog` remainder** — pairing/ecwid-sync routes (entangled with active sync), `[id]/manuals`, `[id]/qc-checks` (the last two need Phase B columns on `product_manuals`/`qc_check_templates`). Plus 2 LOW boolean-EXISTS search imperfections.
- [ ] **`fba` enforce-readiness remainder** — the `tech/*` scan routes (cross-domain: `serial_units`/`tech_serial`), cross-domain readers (`work-orders`, `global-search`, `packing-logs`, `sync-sheets`, `google-sheets/execute-script`), and `link-unit`'s `serial_units`/`inventory_events` scoping.

### B. Cross-cutting (Phase D) — required before the hot tables can FORCE
- [ ] **Session-less crons → per-org.** Convert Zoho sync, eBay sync/refresh, sheets transfer, replenishment-detect, and the warranty `clock-sweep` to `forEachActiveOrg` (or a service-org). **These are the FORCE-blockers** for orders/sku/warranty — a table cannot FORCE while a session-less writer touches it without a GUC.
- [ ] **C5 Drizzle repos** — thread `orgId` via `withTenantDrizzle` through `salesOrderRepository` and `repositories/inventory/allocations.ts` (Drizzle-only writers currently bypass `tenantQuery`).
- [ ] Per-route rate-limit `scope: ctx.organizationId` sweep (the capability + boot-warning already shipped; this is the call-site rollout).
- [ ] PO-Gmail `missing-orders`/`triage` reads (lower-pri). Confirm `UPSTASH_REDIS_*` set in Vercel prod **[you]**.

### C. Phase B columns (schema) — extend
- [ ] Remaining Phase B batches (tracking children, staff children, roots) per `docs/tenancy/_analysis/tables.md`.
- [~] **FORCE prerequisite (schema) — migrations WRITTEN, UNAPPLIED (2026-06-14):** `src/lib/migrations/2026-06-14_sku_catalog_composite_unique.sql` (swaps `UNIQUE(sku)`→`UNIQUE(organization_id, sku)`; clean, FKs are on `id`) and `2026-06-14_fba_fnskus_composite_pk.sql` (PK `fnsku`→`(organization_id, fnsku)`; drops + recreates the 4 child FKs as composite, PG15 `ON DELETE SET NULL (fnsku)` for the NOT-NULL-org children, with a pre-flight data check). Under FORCE+app_tenant two orgs can't share an `sku`/`fnsku` string (2nd INSERT hits a unique-violation on an RLS-invisible row), so these are required before those tables FORCE. **Apply each WITH its `ON CONFLICT` code flip** (sites listed in the file headers) — standalone application breaks the upserts.

### D. Phase E — enforce (after E1)
Per-table `SELECT enforce_tenant_isolation('<table>')` migrations, each gated on **all** the table's routes being GUC-safe. Order, easiest first:
1. **Zero raw-pool routes — safe immediately:** `rag_documents`, `rag_document_chunks`, `shipment_orders`.
2. **`reason_codes`** (all routes GUC-wrapped; mind the `warranty/reports.ts` LEFT JOIN).
3. **fba tables** — *first* add the composite `(organization_id, fnsku)` PK to `fba_fnskus` + flip `ON CONFLICT`; then the fba tables whose every toucher is migrated (after the §5.A fba remainder).
4. **warranty** — after the write path moves onto `withTenantConnection` (GUC) + the `clock-sweep` cron is per-org; then flip `getClaim` orgId → required.
- [ ] Wire the cross-org canary into CI (E4).
- [ ] **Do NOT onboard a 2nd tenant** until the hot tables (`orders`/`receiving`/`serial_units` + above) are FORCEd — until then a 2nd tenant's un-migrated raw-pool routes see cross-tenant rows.

### E. Non-isolation foundation (Phase F)
- [ ] **F1** owner email identity + verification (auth is PIN-only today — fine for floor staff, not a B2B owner) + persist signup email (also fixes the billing notification email caveat).
- [ ] **F4-lite** onboarding/activation (a new org currently lands on a blank dashboard).
- [ ] **F3** per-org roles — `role-store.ts` `rolesCache` is **not** a leak today (`roles` has no `organization_id` — global system roles); org-key the cache only when per-org roles land.
- [ ] Legal baseline (ToS / privacy / DPA); set `BILLING_NOTIFICATION_DOMAIN`.

### F. Known low-pri / cosmetic (tracked, not blockers)
- [ ] within-org IDOR on `sku-catalog/[id]/platform-ids` (not tenancy).
- [ ] `fba/items/[id]/link-unit` serial-string scope.
- [ ] Stale comment in `sku-relationship-queries.ts` (re `createRelationship`).
- [ ] `fetchFbaContext` references dropped `ready_item_count`/`packed_item_count` columns (pre-existing; throws on the AI fba intent).
- [ ] Ably: session-less transitional-org publishers (publish-on-status-change, station-activity, sheets-transfer, pipeline) + Square webhook org-resolution + fail-closed signature → defer to 2nd-tenant onboarding. The **external `realtime-db` emitter must send `organization_id` as `orgId`** or every `db.row.changed` 400s post-deploy **[you/infra]**.

---

## 6. The proven migration pattern (apply it; don't reinvent)

Exemplars in-tree: `src/lib/neon/reason-codes-queries.ts`, `src/lib/warranty/mutations.ts` (subquery-derive), `src/app/api/fba/items/scan/route.ts`.

**Structural reality:** every table's queries live in a shared `*-queries.ts` module with multiple callers, *including session-less* (sync/cron). So each table migration is a careful shared-module edit, not a one-file change.

1. **Request-only helpers** → **REQUIRED** `orgId: OrgId`. Run via `tenantQuery` / `withTenantTransaction` (from `@/lib/tenancy/db`). Explicit `AND <t>.organization_id = $n` on reads; stamp `organization_id` on writes.
2. **Shared / session-less helpers** (called by Zoho/cron/sync) → **OPTIONAL** `orgId?`, byte-identical behavior when omitted, so session-less callers don't break. Reference: `getClaim(id, orgId?)`, `sku-catalog-queries.ts`. (These callers need a **service-org** before their tables can FORCE.)
3. **Child-table INSERTs on the raw pool** (events/attempts/etc.) → stamp `organization_id` via **subquery-derive**: `(SELECT organization_id FROM <parent> WHERE id = <fk>)`. **This is the write-bug class** (NULL-violation when a Phase-B GUC-default column has no GUC set) — actively hunt for it.
4. **Joins on STRING keys** (`sku`, `fnsku`, `serial`, `order_number_norm`) → **MUST** add an org-equality predicate; they collide across tenants. Joins on globally-unique integer PKs (`staff.id`, `*_shipments.id`) are safe bare.
5. **`[id]` routes / verb writes** → org-ownership check → **404** on mismatch (never 403). The READ and WRITE sides must **both** be gated (the audit found warranty writes were a write-IDOR while reads were already gated).
6. **Signature safety:** don't change a shared helper's REQUIRED signature if the user may have uncommitted callers — prefer an org pre-check in the route, or an OPTIONAL `orgId`.

**Then always run adversarial verify agents.** They have repeatedly caught real misses the migrator made: a write-bug, a wrong `has_org` deferral (`email_delivery_signals` was wrongly skipped on a false "no org column" premise — it HAS org), missed `photos`/`email_delivery_signals` subqueries, and a write-IDOR. Verify is not optional.

---

## 7. Gotchas (learned the hard way)

- **The user edits in parallel** (commits via GitHub Desktop; HEAD moves mid-session). Before grinding a table, check the footprint: `find src -mmin -25` + `git status --porcelain <area>`. Grind the **coldest** area; never edit files the user has uncommitted or just touched.
  - **Never `git stash`.**
  - **Don't use worktree isolation** for this work — it branches off HEAD and loses the uncommitted parallel work.
  - Current hot zones to avoid: `orders` (8 uncommitted routes), `serial_units` (allocate/hold/release + shared `state-machine.ts`), catalog domain, warranty restore/revert routes, Studio, select-mode, order-labels, billing/trial-gate. `fba` is untouched/safe but is a ~45-file atomic migration — do it as one careful calm-tree pass, don't blast.
- **`docs/tenancy/coverage.generated.json` goes stale.** Regenerate (`npm run tenancy:coverage`) and **trust the live DDL over `schema.ts`** — there is real drift. It was wrong about `email_delivery_signals`, `unit_repairs`, `repair_failure_resolutions` having org columns.
- **The `tracked env-secrets` hazard:** `.env`/`.env.local` are git-**tracked** with live secrets. Never blanket-stage them; unstage env/junk before every commit.
- **`tsc` noise to ignore:** `.next/types/validator.ts` (stale generated stubs) and `src/lib/ebay/client.ts` (user WIP — strict-null errors, not yours). Anything else is yours.
- **The big-bang trap:** do **not** set `DATABASE_URL=app_tenant` (the old exec-plan path). Under a non-owner role `ENABLE` bites without `FORCE`, breaking ~340 raw-pool routes at once. Use the two-pool `TENANT_APP_DATABASE_URL` wiring (§3 Keystone #2).

---

## 8. How to verify your work

- **Typecheck:** `npx tsc --noEmit` — ignore the two noise files above. Whole-repo `tsc` was GREEN at last update.
- **e2e runs LIVE** (the config has **no** `webServer`): dev server must be up on `http://localhost:3000`, chromium installed, saved session at `tests/.auth/admin.json`. Run e.g. `npx playwright test tests/e2e/<spec> --project=desktop`. Tenancy-relevant specs (all green at last update): `crud-catalog-reasoncodes` (note: a pre-existing spec enum bug `category:'e2e'`→`'adjustment'` was fixed), `warranty-zendesk`, `realtime-token` (confirms `org:{uuid}:staff` namespacing), `po-mailbox-fetch`, `receiving-lines-endpoints`.
- **Unit:** `tsx --test src/lib/billing/stripe.test.ts`; `npm run test:warranty`; `npm run test:auth`; `src/lib/tenancy/db.test.ts` (the GUC smoke test — **needs `DATABASE_URL` set**; the env only has `DATABASE_URL_UNPOOLED`, so inject it to actually exercise the test).
- **Tenancy guards:** `npm run tenancy:guard:check` (fails if an enforced table has non-GUC routes, or any table is FORCEd under a BYPASSRLS role); regenerate audits with `npm run tenancy:coverage` / `npm run tenancy:routes`.
- **For a big change, run the audit pattern:** fan out adversarial auditors per area + a build/e2e gate + synthesis (see the `tenancy-update-codebase-audit` / `tenancy-audit-fixes` workflow scripts under the session workflows dir). This is what caught the 8 defects.

---

## 9. Key references
- Spine + sequencing + the BYPASSRLS keystone: `docs/tenancy/multi-tenancy-execution-plan.md`
- Owner go-live steps: `docs/tier0-go-live-runbook.md`
- Line-item tracker: `docs/tier0-execution-checklist.md`
- Generated ground truth: `docs/tenancy/org-id-coverage.generated.md`, `docs/tenancy/route-scoping-audit.generated.md` (regen: `npm run tenancy:coverage` / `npm run tenancy:routes`)
- Enforcement infra: `src/lib/migrations/2026-06-14_rls_enforcement_infra.sql` (`enforce_tenant_isolation` / `relax_tenant_isolation`)
- The `app_tenant` role template: `src/lib/migrations/2026-06-21_app_tenant_role.sql.template`
- Phase B child columns (applied): `src/lib/migrations/2026-06-14_org_id_phase_b_domain_children.sql`
- Phase B NEEDS-COL columns (WRITTEN, UNAPPLIED, nullable): `src/lib/migrations/2026-06-14_org_id_phase_b_needs_col.sql` (suppliers, square_transactions, warehouses, sourcing_*, rma_authorizations)
- Composite-key FORCE prereqs (WRITTEN, UNAPPLIED): `2026-06-14_sku_catalog_composite_unique.sql`, `2026-06-14_fba_fnskus_composite_pk.sql`
- GUC helpers: `src/lib/tenancy/db.ts`; two-pool wiring: `src/lib/db.ts`; per-org cron: `src/lib/cron/for-each-org.ts`; tenant Drizzle: `src/lib/drizzle/tenant-db.ts`
- Cross-org test harness: `src/lib/tenancy/cross-org-harness.ts`, `src/lib/tenancy/cross-org-isolation.test.ts`
- Agent memory: `tier0-sellable-foundation-progress`, `sellable-foundation-prioritization`, `multi-tenancy-hardening-prompt`, `saas-commercialization-plan`.
</content>
</invoke>
