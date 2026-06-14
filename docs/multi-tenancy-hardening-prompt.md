# Multi-Tenancy Hardening — Comprehensive Upgrade Prompt

> **Goal:** Take this codebase from "single-tenant ops tool with a multi-tenant skeleton bolted on"
> to **safe hard tenant isolation by `organization_id`, one codebase, ready for external paying
> tenants.** The bar is: a malicious or careless authenticated user in Org B can never read,
> mutate, subscribe to, or cache data belonging to Org A — enforced at the **database layer (RLS)**,
> not just in hand-written `WHERE` clauses.
>
> This is a **prompt for an engineering agent (or human)** to execute. It encodes the current state,
> the gaps, the execution order, and the acceptance criteria. Read it top to bottom before touching code.
>
> Authored from a deep scan on 2026-06-13. Related: [docs/saas-commercialization-plan.md](saas-commercialization-plan.md),
> [docs/phase-1-rls-plan.md](phase-1-rls-plan.md).

---

## 0. Mental model — what already exists vs. what's missing

**Do not rebuild the skeleton. It exists and is good.** The work is *enforcement, coverage, and
closing leaks* — not greenfield.

### ✅ Already built (reuse, do not duplicate)

| Capability | Location | State |
|---|---|---|
| `organizations` root table (uuid PK, slug, plan, status, settings jsonb, stripe ids, trial/soft-delete) | `src/lib/drizzle/schema.ts` (~L2285), migration `2026-05-22_organizations_tenancy.sql` | ✅ live |
| Org domain helpers (`getOrganization`, `getOrganizationBySlug`, `createOrganization`, `setOrgPlan/Status/StripeIds`, 30s cache) | `src/lib/tenancy/organizations.ts` | ✅ live |
| Tenant DB helpers — `withTenantConnection` / `tenantQuery` / `withTenantTransaction` set `app.current_org` GUC | `src/lib/tenancy/db.ts` | ✅ live, **underused** |
| Session carries `organizationId` end-to-end (cookie → `staff_sessions.organization_id` → `CurrentUser.organizationId` → `ctx.organizationId`) | `src/lib/auth/session.ts`, `current-user.ts`, `withAuth.ts` | ✅ live |
| Subdomain → `x-tenant-slug` → org resolution at sign-in | `src/proxy.ts`, `src/app/api/auth/staff-picker/route.ts` | ✅ live |
| Per-tenant encrypted credential vault (`organization_integrations`, AES-256-GCM, 5-min cache keyed `orgId:provider:scope`) | `src/lib/integrations/credentials.ts`, migration `2026-05-22_organization_integrations.sql` | ✅ live |
| Per-tenant feature flags (`organization_feature_flags`, async `...ForOrg(orgId)` + 30s cache) | `src/lib/feature-flags.ts`, migration `2026-05-22_organization_feature_flags.sql` | ✅ live |
| Per-tenant org settings (Zod-validated jsonb: timezone, currency, brand, NAS folders, warranty days…) | `src/lib/tenancy/settings.ts` | ✅ live |
| Self-serve signup (org + admin staff + role link, transactional, IP-throttled) | `src/app/api/auth/signup/route.ts` | ✅ live |
| Billing skeleton (subscriptions table, idempotent Stripe webhook, thin Stripe REST client, plans/entitlements with 5 tiers + feature gates) | `src/lib/billing/*`, `src/app/api/billing/*` | ⚠️ built, blocked on Stripe catalog |
| Permission registry (170+ perms, 10 categories, destructive/stepUp flags) + DB-backed role merge | `src/lib/auth/permission-registry.ts`, `permissions-shared.ts`, `role-store.ts` | ✅ live |
| RLS enforcement **infrastructure** — `enforce_tenant_isolation(table)` / `relax_tenant_isolation(table)` SQL functions | migration `2026-06-14_rls_enforcement_infra.sql` | ✅ defined, **0 tables enforced** |
| Per-tenant NAS folder/base-url resolution | `src/lib/nas-photos-server.ts` | ✅ live |

### ❌ The gaps that make it unsafe for external tenants

1. **~80 of ~114 tables have no `organization_id`** (or have it in SQL migrations but not reflected/queried). Critical missing-or-unenforced: `receiving`, `receiving_lines`, `receiving_shipments`, `work_assignments`, `serial_units`, `serial_unit_condition_history`, `inventory_events`, `locations`, `bin_contents`, `tech_serial_numbers`, `sku_catalog`/`sku_stock`, all `fba_*`, `qc_check_templates`, `tech_verifications`, `reason_codes`, `shifts`, `staff_goals`, `audit_logs`, `auth_audit`. **(Schema-vs-migration drift exists — verify each table's true column state against `information_schema`, do not trust `schema.ts` alone.)**
2. **RLS enabled on ~73 tables but never `FORCE`d, and 0 tables call `enforce_tenant_isolation()`.** App connects as table owner (`neondb_owner`), which **bypasses non-forced RLS entirely**. So today RLS is decorative.
3. **~500+ raw-SQL routes don't filter by org.** The dominant pattern is `pool.query(...)` (NOT `tenantQuery`) with hand-written SQL, and most omit `WHERE organization_id = $n`. `ctx.organizationId` is *available* in every `withAuth` handler but *used* in only ~90–137 of ~572 routes.
4. **Riskiest unscoped reads (cross-tenant data leak today):** `GET /api/receiving-lines`, `GET /api/work-orders`, `POST /api/receiving/match` (can cross-wire one org's cartons to another's orders), `GET /api/serial-units`, `GET /api/inventory`, `/api/sku-*`, `/api/reason-codes`, `/api/shifts`, `/api/staff-goals`, and most `/api/admin/staff/[id]/*` (no `staff.organization_id = ctx.organizationId` check → an admin can edit another org's staff by guessing an id).
5. **Realtime (Ably) channels are global** — `orders:changes`, `repair:changes`, `db:*` carry no org prefix and the token endpoint grants them without org validation. Org B can subscribe to Org A's live order stream. (`src/lib/realtime/channels.ts`, `src/app/api/realtime/token/route.ts`)
6. **Cron / background jobs have no session → mostly run globally.** Only `cron/zoho/orders-ingest-drain` iterates per-org. The rest (`replenishment-detect`, `inventory/drift-check`, `po-sync`, tracking sweeps…) assume one tenant.
7. **Audit logs are not org-scoped.** `audit_logs` / `auth_audit` lack `organization_id` in the write path (`src/lib/audit-logs.ts`).
8. **PO-Gmail mailbox is a per-deployment singleton** (`google_oauth_tokens WHERE provider='po_gmail' LIMIT 1`, no org column) — multiple tenants would corrupt each other's OAuth token on refresh. (`src/lib/po-gmail/client.ts`)
9. **Client-side module-scope caches are not org-keyed** — `src/lib/staffCache.ts`, `src/lib/receivingCache.ts`, `src/lib/cache.ts` (keys `domain:id`), and the server-side `rolesCache` in `src/lib/auth/role-store.ts`. Two tenants sharing a warm serverless instance / browser session cross-contaminate.
10. **`USAV_ORG_ID` hardcoded as a fallback in ~8 places** (`staff-picker`, `ebay/browse-client`, `credentials.ts`, `transitionalUsavOrgId()` callers). Each is latent single-tenant debt.
11. **`roles` table is global**, no per-org custom roles; **no multi-org membership** (one `staff` row → one org, no `staff_organization_memberships` bridge); **no org-switcher UI**.

---

## 1. Non-negotiable principles for this upgrade

1. **Defense in depth, DB-first.** The end state is **`FORCE ROW LEVEL SECURITY` on every tenant table**, with the app connecting under a role that does *not* bypass RLS. Hand-written `WHERE organization_id = $n` stays as a second layer, but **RLS is the backstop that makes a forgotten filter non-fatal.** Do not ship "we'll just be careful in every query" as the isolation story.
2. **The GUC is the contract.** Every request path that touches tenant data must run with `app.current_org` set — i.e. inside `withTenantConnection` / `tenantQuery` / `withTenantTransaction`, OR set the GUC equivalently for any other connection style. Raw `pool.query` without the GUC must be eliminated for tenant tables.
3. **`organization_id` is server-derived, never client-supplied.** Always from `ctx.organizationId` (session). Never from request body, query param, or path — except the org-resolution-at-login path which validates against `staff.organization_id`.
4. **Stamp-on-insert via DEFAULT, fail-closed when unset.** Column default = `NULLIF(current_setting('app.current_org', true),'')::uuid`, column `NOT NULL`. If the GUC isn't set, the insert fails loudly rather than silently writing an unscoped row.
5. **Gated, reversible rollout.** Use the existing `enforce_tenant_isolation` / `relax_tenant_isolation` pair. Enforce **table-by-table**, each gated on "every route + cron + job touching this table is confirmed GUC-scoped," with a one-command rollback.
6. **Prove isolation with tests, not inspection.** Every enforced table gets a cross-org regression test: seed Org A + Org B, authenticate as B, assert 0 rows / 403 / blocked write against A's data.
7. **No new `USAV_ORG_ID` / `transitionalUsavOrgId()` callers.** Add a lint rule to block them; burn down existing ones.

---

## 2. Execution plan (phased, each phase independently shippable)

### Phase A — Ground truth & guardrails (do first, ~1 day)

- [ ] **A1. Generate the real column inventory.** Query `information_schema.columns` for every table; produce `docs/tenancy/org-id-coverage.generated.md` listing each table and whether `organization_id` exists, is `NOT NULL`, has the GUC default, and has RLS enabled/forced. **This is the source of truth — `schema.ts` has drifted from the SQL migrations.**
- [ ] **A2. Generate the route scoping inventory.** Script over `src/app/api/**/route.ts`: for each handler, detect (a) uses `withAuth`, (b) references `ctx.organizationId`, (c) uses `tenantQuery`/`withTenantConnection` vs raw `pool.query`, (d) the tables it touches. Output a triage table sorted by risk. Land it as `docs/tenancy/route-scoping-audit.generated.md`.
- [ ] **A3. Lint guardrails.** Add ESLint rules: (1) forbid new imports of `USAV_ORG_ID` / `transitionalUsavOrgId` outside an allowlist; (2) flag `pool.query(` / `db.query(` inside `src/app/api/**` route handlers in favor of the tenant helpers (warn, then error). Wire into CI.
- [ ] **A4. Cross-org test harness.** Add a test fixture that seeds two orgs with overlapping data and a helper `asOrg(orgId)` that runs a request with that org's session. This harness backs every later acceptance test.

### Phase B — Schema coverage: org_id on every tenant table (~3–5 days)

- [ ] **B1. Classify all ~114 tables** into: **tenant-owned** (needs `org_id` + RLS), **globally-shared reference** (e.g. `roles` today, `reason_codes` if intentionally global, lookup taxonomies — decide explicitly), and **child-scoped** (isolated transitively via a FK to a tenant-owned parent, e.g. `workflow_nodes` via `workflow_definitions`). Record the decision per table.
- [ ] **B2. Add `organization_id` to every tenant-owned table** still missing it, in dependency order (parents before children). Use the established pattern: `organization_id uuid NOT NULL DEFAULT NULLIF(current_setting('app.current_org', true),'')::uuid`, FK to `organizations(id)`, backfill existing rows to `USAV_ORG_ID`, add a covering index `(organization_id, <hot key>)`. One idempotent migration per domain group (receiving, inventory/serial, fba, qc/repair, sourcing, ops/workflow, lookups, audit).
- [ ] **B3. Reconcile `schema.ts` with the DB.** Add the `orgIdCol()` column to every Drizzle table def that now has it, so ORM paths and types match reality. Resolve the drift the scan found (e.g. `serial_units`, `receiving*` org_id added in SQL but absent from `schema.ts`).
- [ ] **B4. Add `organization_id` to `audit_logs` and `auth_audit`**; thread it through `createAuditLog` params and every caller (default to `ctx.organizationId`).

### Phase C — Application-layer scoping: make every route honest (~5–8 days, parallelizable)

Work the Phase-A2 triage table from highest risk down. For each route:

- [ ] **C1. Route the connection through the GUC.** Replace raw `pool.query` with `tenantQuery(ctx.organizationId, …)` / `withTenantConnection` / `withTenantTransaction`. For multi-statement handlers use the transaction wrapper so `SET LOCAL` covers the whole unit.
- [ ] **C2. Add explicit `WHERE organization_id = $n`** (belt-and-suspenders) on every read/update/delete touching a tenant table, and stamp `organization_id` on inserts (or rely on the DEFAULT once the GUC is set — prefer explicit for clarity in hot paths).
- [ ] **C3. Fix path-param ownership checks.** Every `/api/.../[id]/...` that loads by id must also assert the row's `organization_id = ctx.organizationId` (esp. all `/api/admin/staff/[id]/*`, `serial-units/[id]/*`, `receiving/[id]/*`). Guessing an id from another org must 404, not act.
- [ ] **C4. Priority targets (do these first — known live leaks):** `receiving-lines`, `work-orders`, `receiving/match`, `serial-units`, `inventory`, `sku-*`, `reason-codes`, `shifts`, `staff-goals`, `admin/staff/[id]/*`.
- [ ] **C5. Repositories & query modules.** Update `src/lib/repositories/*` and `src/lib/queries/*` to require and apply `orgId`. These are the reusable choke-points — fix once, many routes benefit.

### Phase D — Cross-cutting infrastructure leaks (~3–5 days)

- [ ] **D1. Realtime (Ably) org isolation.** Namespace every channel with the org (e.g. `org:{uuid}:orders:changes`). Update `src/lib/realtime/channels.ts` builders, all `publish*` call sites, the client subscribers, and **the token endpoint** (`src/app/api/realtime/token/route.ts`) so capability grants are derived from `ctx.organizationId` and a client can only ever be granted its own org's channels. This is the single most exploitable gap — prioritize it.
- [ ] **D2. Cron / background jobs.** Convert single-tenant jobs to **iterate over active orgs** (`SELECT id FROM organizations WHERE status='active' AND deleted_at IS NULL`), running each org's work inside `withTenantConnection(orgId, …)`. Audit every route under `src/app/api/cron/**` and any QStash-scheduled job. Per-org failures must isolate (one org's error doesn't abort the sweep).
- [ ] **D3. PO-Gmail per-org mailbox.** Add `organization_id` to `google_oauth_tokens` (and any po_gmail config), scope lookups/refresh by org, and update `src/lib/po-gmail/client.ts`. Until multi-tenant Gmail is needed, at minimum guard so a non-USAV org can't read/refresh USAV's token.
- [ ] **D4. Cache key hygiene.** Org-key every cache that holds tenant data: `src/lib/staffCache.ts`, `src/lib/receivingCache.ts`, `src/lib/cache.ts` (prefix keys with org), and `src/lib/auth/role-store.ts` (`rolesCache` → keyed by org if roles become per-org; otherwise document why global is safe). Verify the endpoints these caches hit are themselves org-scoped (Phase C).
- [ ] **D5. Rate limiting.** Make the `scope` in `src/lib/api-guard.ts` default to `ctx.organizationId` for authenticated routes so one tenant can't exhaust another's budget; confirm Redis-backed mode in prod (in-memory multiplies across instances).
- [ ] **D6. File storage paths.** Confirm NAS/WebDAV write paths and any Vercel Blob keys are org-partitioned (folders already resolve per-org via `nas-photos-server.ts`; verify no shared-path collisions across tenants).

### Phase E — Turn on enforcement (RLS), table by table (~3–5 days)

- [ ] **E1. App DB role that does NOT bypass RLS.** Today the app connects as table owner → RLS is bypassed even when enabled. Introduce a non-owner application role (or `FORCE` RLS, which applies policies even to the owner). The existing `enforce_tenant_isolation()` already sets `FORCE` — that's the lever. Decide and document the connection-role strategy; ensure `@neondatabase/serverless` pool + the Drizzle `neon-http` client both connect under the enforced role.
- [ ] **E2. Enforce per table, gated.** For each tenant table, once Phase C+D confirm *all* touchpoints are GUC-scoped, run `SELECT enforce_tenant_isolation('<table>');` in a migration. Start with the highest-value, best-covered tables (orders, receiving, serial_units). Keep `relax_tenant_isolation('<table>')` as the documented one-line rollback.
- [ ] **E3. Handle the read-only cross-tenant role** (`hermes_agent`) the infra already preserves — confirm AI/agent read paths still work post-FORCE, or scope them too.
- [ ] **E4. Cross-org regression test per enforced table** (Phase A4 harness): authenticated as Org B → SELECT/UPDATE/DELETE/INSERT against Org A's rows returns empty / blocked / errors. Gate the enforce migration on the test passing.

### Phase F — Identity, membership, lifecycle (post-isolation; required to actually sell)

- [ ] **F1. Email-based identity** beyond PIN: magic-link or email+password, email verification gate on signup, password/PIN reset. (Blocks self-serve B2B.)
- [ ] **F2. Multi-org membership + org switcher** — `staff_organization_memberships(staff_id, org_id, role_id)`, `POST /api/auth/switch-org` that re-mints session org context, header switcher UI. (Session already stores active org per the existing comments — extend, don't redesign.)
- [ ] **F3. Per-org roles** if needed — `org_id` on `roles` or an org-roles overlay; today roles are global system roles.
- [ ] **F4. Onboarding / template seeding** for new orgs (reuse Operations Studio seed templates) so a fresh tenant isn't blank.
- [ ] **F5. Stripe catalog** (the separate revenue blocker): create products + prices, set `STRIPE_PRICE_STARTER/GROWTH/PRO/ENTERPRISE`. Tracked in [saas-commercialization-plan.md](saas-commercialization-plan.md) — not part of isolation but required to charge.

---

## 3. The canonical patterns (copy these)

**Read in a route:**
```ts
export const GET = withAuth(async (req, ctx) => {
  const { rows } = await tenantQuery(
    ctx.organizationId,
    `SELECT … FROM receiving_lines WHERE organization_id = $1 AND …`,
    [ctx.organizationId, …],
  );
  return NextResponse.json(rows);
}, { permission: 'receiving.view' });
```

**Multi-statement / write:**
```ts
await withTenantTransaction(ctx.organizationId, async (client) => {
  await client.query(`INSERT INTO receiving (…) VALUES (…)`, [...]); // org_id via DEFAULT/GUC
  await client.query(`UPDATE … WHERE id = $1 AND organization_id = $2`, [id, ctx.organizationId]);
});
```

**Path-param ownership:**
```ts
const { rows } = await tenantQuery(ctx.organizationId,
  `SELECT id FROM serial_units WHERE id = $1 AND organization_id = $2`, [id, ctx.organizationId]);
if (!rows.length) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
```

**Cron per-org sweep:**
```ts
const orgs = await pool.query(`SELECT id FROM organizations WHERE status='active' AND deleted_at IS NULL`);
for (const { id: orgId } of orgs.rows) {
  try { await withTenantConnection(orgId, (c) => doWork(c)); }
  catch (e) { logger.error({ orgId, e }, 'per-org job failed'); /* continue */ }
}
```

**Org-scoped Ably channel:**
```ts
const ch = `org:${ctx.organizationId}:orders:changes`; // never the bare global name
```

---

## 4. Acceptance criteria (definition of done for "safe for external tenants")

- [ ] Every tenant-owned table has `organization_id NOT NULL` with the GUC default, and `FORCE ROW LEVEL SECURITY` + the `tenant_isolation` policy via `enforce_tenant_isolation`.
- [ ] The app connects under a role for which RLS is **not** bypassed.
- [ ] Zero `pool.query`/raw-SQL on tenant tables inside `src/app/api/**` without the GUC set (lint-enforced).
- [ ] Cross-org regression suite is green: for every enforced table, an Org-B session cannot read/write Org-A rows (empty/404/403/error).
- [ ] All Ably channels are org-namespaced; the token endpoint grants only the caller's org channels; a manual test confirms Org B cannot subscribe to Org A.
- [ ] Every cron/QStash job iterates per active org and isolates per-org failures.
- [ ] Audit logs carry `organization_id`; PO-Gmail and any OAuth tokens are org-scoped or guarded.
- [ ] No client/server cache mixes tenants (org-keyed or proven global-safe).
- [ ] No new `USAV_ORG_ID` / `transitionalUsavOrgId` callers; existing count is burning down with a tracked list.

---

## 5. Sequencing & risk notes

- **Order matters: B (columns) → C (route scoping) + D (infra) → E (enforce).** Forcing RLS before routes are GUC-scoped will break ~hundreds of raw-`pool.query` routes (they'll see zero rows). The `enforce_tenant_isolation` gate per table is exactly to prevent that — never enforce a table whose touchpoints aren't all confirmed scoped.
- **The schema-vs-migration drift is a real hazard.** Phase A1 (`information_schema` truth) is mandatory before B/C — multiple tables already have `org_id` from SQL migrations that `schema.ts` and the route code don't reflect.
- **Highest-exploitability-first within Phase C/D:** Ably token endpoint (live cross-tenant stream), `receiving-lines`/`work-orders`/`receiving/match` (live cross-tenant data + cross-wiring), `admin/staff/[id]/*` (cross-tenant mutation). Land these even before the full sweep completes.
- **Keep USAV (`00000000-0000-0000-0000-000000000001`) as the dogfood tenant** through the whole migration — it's the backfill target and the canary that nothing broke for the existing single tenant.

---

*End of prompt. Start at Phase A. Produce the two generated audit docs first — they convert this plan into a concrete, trackable checklist against the real database.*
