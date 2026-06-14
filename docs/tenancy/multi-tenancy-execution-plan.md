# Multi-Tenancy Hardening — Execution Plan (codebase-specific build-out)

> This is the concrete, repo-grounded build-out of [`docs/multi-tenancy-hardening-prompt.md`](../multi-tenancy-hardening-prompt.md).
> It supersedes the role decision in [`docs/phase-1-rls-plan.md`](../phase-1-rls-plan.md) (see **§Phase E / the keystone**).
> Authored 2026-06-13 from a live-DB scan + a 7-agent deep analysis. Ground-truth artifacts:
>
> - [`org-id-coverage.generated.md`](./org-id-coverage.generated.md) — per-table org_id/RLS state, from `pg_catalog` (not `schema.ts`). Regenerate: `node scripts/tenancy-coverage.mjs`.
> - [`route-scoping-audit.generated.md`](./route-scoping-audit.generated.md) — per-route risk + the **reverse index** (routes per table) that gates enforcement. Regenerate: `node scripts/tenancy-route-audit.mjs`.
> - [`_analysis/`](./_analysis/) — the six deep specs (`tables`, `realtime`, `cron`, `infra`, `repos`, `routes`) + `critique.md`. These hold the exhaustive call-site lists; this plan is the spine + the corrections.

---

## 0. The one finding that reorders everything

**`neondb_owner` (the app's connection role) has `rolbypassrls = true`. `BYPASSRLS` overrides `FORCE ROW LEVEL SECURITY`.** Empirically verified against the live DB (temp table, `ENABLE`+`FORCE`+policy scoped to org A, GUC set to org A → the owner connection still saw **both** orgs' rows).

Consequences:

1. The ~68 tables that already have `ENABLE ROW LEVEL SECURITY` + a `*_tenant_isolation` policy are **100% inert**. RLS is decorative today.
2. `enforce_tenant_isolation()` (which sets `FORCE`) will **not** isolate anything while the app connects as `neondb_owner` — it would ship RLS that *looks* on (`pg_policies` populated, `relforcerowsecurity=true`) but is fully bypassed. This is more dangerous than no RLS, because it reads as "done."
3. `docs/phase-1-rls-plan.md`'s decision — *"take the FORCE-per-table path (keep the single `neondb_owner` role)"* — is **wrong** and is hereby overridden. The keystone is a **dedicated non-`BYPASSRLS`, non-owner application role** (Phase E). Every other phase is scaffolding that only becomes load-bearing after that flip.

A standing CI guard now encodes this invariant: `scripts/tenancy-guard.ts` fails the build if any table is `FORCE`d while the live connection role still has `BYPASSRLS` (passes today: 0 forced).

### A correction to the analysis's own critique
The deep-analysis critique flagged `src/lib/auth/role-store.ts` as *"the one live exploitable cross-tenant RBAC leak today"* (process-wide `rolesCache`, `fetchRoles` with no org filter). **This is not a live leak.** Verified: the `roles` table has **no `organization_id` column** (8 global system roles). All tenants legitimately share the same global roles, so the process-wide cache is correct *by design today*. Org-keying `role-store.ts` is **deferred to Phase F3**, coupled with introducing per-org roles. Until then, leave it global (add a doc note explaining why). The genuinely "ship-first" exposure is **Phase E + the Ably token endpoint (D1)**, not role-store.

### Honest status of "live" risk
USAV is currently the **only** real tenant. Therefore *nothing is being exploited right now* — every gap below is **latent**, becoming a real cross-tenant breach the instant a second org onboards. The bar is: **complete Phases B→E (and D1) before onboarding org #2.** Do not onboard a paying tenant against the current code.

---

## 1. Ground truth (live DB, 2026-06-13)

| metric | value |
|---|---|
| base tables (`relkind='r'`, public) | **173** |
| with `organization_id` | 93 (89 NOT NULL) |
| RLS enabled | 68 |
| **RLS FORCEd** | **0** |
| `*_tenant_isolation` policy present | 68 |
| `hermes_agent_read` policy present | 68 |
| tables still on the **USAV-fallback** default (footgun) | 77 |
| tenant-owned tables **missing `organization_id`** | 18 |
| child-scoped (FK to a tenant parent), no own org col | 49 |
| reference — needs an explicit global-vs-tenant decision | 6 |
| system/global (never enforce) | 7 |
| API route files | 572 (436 `withAuth`) |
| routes GUC-wrapped (`tenantQuery`/`withTenantConnection`/`withTenantTransaction`) | **7** |
| routes importing the raw `@/lib/db` pool | 342 |
| routes via Drizzle `neon-http` (cannot carry the GUC) | 17 |
| route risk: **critical** (mutates a tenant table, no org filter, no GUC) | **243** |
| route risk: **high** (reads one, no filter, no GUC) | 158 |
| route risk: medium / low | 71 / 7 |
| cron route handlers | 25 (26 `vercel.json` schedule rows) |
| `USAV_ORG_ID` importers (excl. defs) | 5 |
| `transitionalUsavOrgId()` callers | 8 |

Key infra facts the plan depends on:
- `src/lib/db.ts` is a Neon **WebSocket** `Pool` cast to `pg.Pool` — it **can** carry a session GUC (`SET app.current_org`) and run `BEGIN…COMMIT`. The GUC wrappers in `src/lib/tenancy/db.ts` already use it correctly.
- `src/lib/drizzle/db.ts` is Drizzle **`neon-http`** — stateless one-request-per-statement. It **cannot** carry the GUC. Four tenant tables are reachable *only* via this transport (see Phase C5).
- The post-May tables already use the strict loud-fail default; the pre-May ones use the USAV-fallback `COALESCE(...)` default. `relax_tenant_isolation()` restores the fallback for rollback.

---

## Phase A — Ground truth & guardrails ✅ DONE (in this branch)

| Item | Deliverable | Status |
|---|---|---|
| A1 column inventory | `scripts/tenancy-coverage.mjs` → `docs/tenancy/org-id-coverage.generated.md` + `coverage.generated.json` | ✅ built + run |
| A2 route audit | `scripts/tenancy-route-audit.mjs` → `docs/tenancy/route-scoping-audit.generated.md` + `route-audit.generated.json` (incl. reverse index) | ✅ built + run |
| A3 lint guardrail | `eslint.config.mjs` — `no-restricted-syntax` errors on **new** `USAV_ORG_ID` import / `transitionalUsavOrgId()` call, with the current callers as an explicit burn-down allowlist | ✅ built + verified (fires on a new caller, allowlisted callers pass) |
| A3 CI gate | `scripts/tenancy-guard.ts --check` — (A) an enforced table whose routes aren't all GUC-safe fails; (B) any FORCEd table while the role has `BYPASSRLS` fails | ✅ built (passes today, armed) |
| A4 cross-org harness | `src/lib/tenancy/cross-org-harness.ts` — `ensureTestOrgs`, `appRolePool`, `roleIsRlsSubject`, `enforcedRoleInvariant`, `proveRlsIsolatesScratch` | ✅ built |

**Remaining A wiring (small):** add to `package.json` scripts + `.github/workflows/ci.yml` — see §"CI + package wiring" below.

---

## Phase B — Schema coverage: org_id on every tenant table

Full detail: [`_analysis/tables.md`](./_analysis/tables.md). Decisions:

- **Denormalize `organization_id` onto every tenant-scoped table (including all 49 child-scoped ones).** Do **not** use transitive `EXISTS`-subquery RLS policies. Rationale: the canonical policy that `enforce_tenant_isolation()` generates is a flat `organization_id = GUC` compare (+ `WITH CHECK`); a subquery policy can't reuse the helper, is slow on hot tables (`mobile_scan_events` 17k, `shipment_tracking_events` 18k, `station_activity_logs` 13k), and creates ordering hell because some parents only get the column in this same phase. Backfill each child from its org-bearing parent in one `UPDATE`.
- Use the established idempotent DO-block pattern from `2026-05-23_org_id_on_business_tables.sql`: `ADD COLUMN … DEFAULT '<USAV>'` (backfill) → flip default to `NULLIF(current_setting('app.current_org',true),'')::uuid` → FK `organizations(id) ON DELETE RESTRICT` → `CREATE INDEX (organization_id)` → `ENABLE RLS` + non-FORCE policy.
- **Every B-batch file header must carry this warning:** *"ENABLE RLS + policy here is INERT until the app role loses BYPASSRLS (Phase E). This migration is correctness scaffolding; it grants ZERO isolation on its own."* (Prevents shipping B1–B6 and believing tenants are isolated.)
- Do **not** call `enforce_tenant_isolation()` (FORCE) in any B file — that's Phase E, gated per table.

**Batch order (parents before children), one dated migration each:**

| File | Group | Notes |
|---|---|---|
| `2026-06-15_org_id_phase_b_roots.sql` | independent roots | `warehouses`, `shipping_tracking_numbers` (5.7k), `suppliers`, `zoho_po_mirror` (3.5k), `zoho_item_images`, `sku_management`, `square_transactions`, `messages`, `google_photos_albums/settings`, `operations_kpi_rollup_state`, `api_idempotency_responses`, `hermes_insights/precision_scores/thresholds`. Backfill = USAV. `warehouses` + `shipping_tracking_numbers` **must** be first (large fan-in). |
| `2026-06-16_org_id_phase_b_tracking_children.sql` | children of roots | `shipment_tracking_events` (18k)←tracking#, `hermes_outcomes`←insights, `repair_failure_resolutions`. |
| `2026-06-17_org_id_phase_b_staff_children.sql` | `staff`-scoped (largest group) | `auth_audit`, `mobile_scan_events`, `pay_periods`, `payroll_settings`, `staff_*` (availability_rules, enrollments, goal_history, goals, passkeys, pay_rates, schedule_overrides, stations, todo*/todos, week_plans, weekly_schedule), `time_off_requests`, `time_punches`, `operations_kpi_rollups_daily/hourly`, `google_photos_backup_runs`, `staff_stepups`←staff_sessions. Backfill `FROM staff`. **⚠ Remove `google_oauth_tokens` from this batch** (see Phase D3 — it's a singleton with no staff_id; gets a dedicated `(organization_id, provider)` migration). |
| `2026-06-18_org_id_phase_b_domain_children.sql` | sku/receiving/orders/serial/repair children | `product_manuals`, `sourcing_candidates`, `sourcing_alerts`, `pending_skus`, `sku_pairing_suggestions`, `sku_pairing_audit`, `local_pickup_orders`/`local_pickup_order_items`, `receiving_scans`, `receiving_shipments`, `tracking_exceptions`, `picking_sessions`, `rma_authorizations`, `repair_actions`, `part_acquisitions`, `unit_quality_scores`, `unit_failure_tags`, `unit_repairs`, `testing_results`, `handling_units`, `replenishment_tasks`, `shift_templates`, `shifts`, `station_scan_sessions`. Backfill from the first org-bearing parent (prefer `staff`). |
| `2026-06-19_org_id_phase_b_workflow_children.sql` | workflow graph | `workflow_edges`, `workflow_nodes` ← `workflow_definitions`. |
| `2026-06-20_rls_phase_b_enable_armed.sql` | RLS-only (already have the column) | The ~23 tables that have `organization_id` but no policy yet: `staff`, `staff_sessions`, `staff_messages`, `billing_subscriptions`, `email_delivery_signals`, `email_missing_purchase_orders`, `item_workflow_state`, `order_ingest_queue`, `organization_integrations`, `rag_documents`/`rag_document_chunks`, `sku_relationships`, `station_definitions`, `stripe_events`, `ticket_links`, `unfound_overlay`, `warranty_claims`/`warranty_claim_events`/`warranty_quotes`/`warranty_repair_attempts`, `workflow_definitions`/`workflow_runs`/`workflow_node_stats`. ENABLE + canonical policy only (still non-FORCE). |

**Reference-decide (6) — explicit calls (this is a used-goods reseller; Bose parts knowledge is shared):**

| Table | Decision | Why |
|---|---|---|
| `bose_models`, `bose_serial_prefixes`, `part_compatibility` | **global-shared reference** | Compatibility/serial-prefix knowledge is industry data, not tenant data. Keep global; never enforce. If a tenant needs private overrides later, add an optional `organization_id` overlay table, don't tenant the base. |
| `failure_modes` | **global default + per-org overlay (future)** | Ship a global taxonomy now; add per-org custom modes in Phase F. |
| `available_sku_suffixes`, `return_dispositions` | **per-tenant** | These are operational config a tenant tunes. Add org_id (fold into B4-domain batch). |

**Nullable-org tables (keep nullable, never FORCE with a strict `=GUC` policy):** `audit_logs` (system rows have no actor — see D4), `order_ingest_queue` (cross-org drain claim), `stripe_events` (global webhook log), `zoho_fulfillment_sync` (already stamps org per row but cross-org reconcile reads). For any of these that must be RLS'd, use a policy that allows `organization_id IS NULL OR organization_id = GUC` for the system path.

**B3 schema.ts reconciliation:** add `orgIdCol()` (helper at `src/lib/drizzle/schema.ts:5`) to every Drizzle table def that now has the column, so ORM/type paths match the DB. Known current drift: `serial_units`, `receiving*`, and others have org_id in SQL but not in `schema.ts`. Drive this from `coverage.generated.json` (`has_org=true`) vs the Drizzle defs.

---

## Phase C — Application-layer scoping: make every route honest

Full detail: [`_analysis/routes.md`](./_analysis/routes.md) (priority targets, adversarially verified) + the burn-down list in `route-audit.generated.json`.

**The four canonical fix shapes** (apply per route):
1. **Read** → `tenantQuery(ctx.organizationId, sql, [...params, ctx.organizationId])` + `AND <t>.organization_id = $n` on every SELECT.
2. **Write / multi-statement** → `withTenantTransaction(ctx.organizationId, …)` so the column default resolves to the real tenant on INSERT, and every UPDATE/DELETE gains `AND organization_id = $n`.
3. **`[id]` routes** → ownership re-check returning **404** (never 403 — don't reveal existence) on org mismatch.
4. **Child-scoped tables without an org col yet** (`shifts`, `staff_goals`, `receiving_scans`, `testing_results` before Phase B lands their column) → gate through the org-bearing parent (`staff`/`receiving`/`serial_units`).

**C4 — Priority targets (verified REAL LEAKS; land these first, even before the full sweep):**

| Route | Verdict | Root cause |
|---|---|---|
| `receiving-lines/route.ts` | REAL | all CRUD on `receiving_lines`+joins via raw pool, no org filter |
| `receiving/match/route.ts` | REAL (write) | manual tx, no GUC; can match/mutate another tenant's lines + `work_assignments` |
| `work-orders/route.ts` | REAL (write) | `getOrders`/`upsertAssignment` + blind `UPDATE receiving`/`fba_shipments` unscoped |
| `serial-units/[id]/grade` · `move` · `allocate` | REAL (write) | unit/order/location resolves unscoped → grade/move/pair another tenant's unit |
| `inventory/units/route.ts` | REAL | `serial_units` list/count, no org predicate (this is the real "serial-units list"; top-level `serial-units/route.ts` does **not** exist) |
| `sku-catalog/route.ts` + `[id]` | REAL (write) | helpers unscoped; `[id]` uses `requireRoutePerm` — read/edit/delete any org's SKU |
| `reason-codes/route.ts` + `[id]` | REAL (write) | list + helpers unscoped |
| `shifts/route.ts` + `[id]/cover` | PARTIAL | `shifts` has no org col → leak via unscoped `staff` parent + cross-tenant cover/session-revoke |
| `staff-goals/route.ts` | PARTIAL | leak via unscoped `staff` + `station_activity_logs` |
| `admin/staff/[id]` + `/roles` + `/reset-pin` | REAL (write) | target staff id from URL, no `staff.organization_id` gate → cross-tenant disable / role-grant / **PIN-reset = account takeover** |

> Note for the 4 routes using `requireRoutePerm` (`sku-catalog/[id]`, `reason-codes/[id]`, `shifts/[id]/cover`): confirm `gate.ctx.organizationId` is populated; if not, switch them to `withAuth`.

**C-sweep (the other ~390 critical/high routes):** drive off `route-audit.generated.json`, highest-risk first. Each table's reverse-index list in `route-scoping-audit.generated.md` is the **gate**: a table cannot be enforced (Phase E) until every route in its list is `low` (GUC-wrapped). `tsc` + the tenancy guard make the burn-down measurable.

**C5 — Repositories & query choke-points + the neon-http blocker.** Full detail: [`_analysis/repos.md`](./_analysis/repos.md).
- Add `src/lib/drizzle/tenant-db.ts` → `withTenantDrizzle(orgId, fn)`: checks out a client from the Neon **WS** pool, `set_config('app.current_org', …)`, runs Drizzle (`drizzle-orm/neon-serverless`) on that session-carrying client. This keeps the typed query builders while making the GUC + RLS actually work.
- Thread `orgId` + WHERE/INSERT filters through `src/lib/repositories/inventory/{stockLedger,inventoryEvents,serialUnits,allocations,conditionHistory,locations}.ts`, `src/lib/repositories/{customerRepository,itemRepository,salesOrderRepository,syncCursorRepository}.ts`, `src/lib/workflow/{store,tap,node-stats}.ts`, and the pg-client paths `src/lib/inventory/{unit-events,tech-serial}.ts`, `src/lib/neon/repairs-queries.ts` (these last three → `withTenantTransaction`, and add `organization_id` to the inline `sku_stock_ledger` INSERT in `unit-events.ts`).
- **4 tenant tables reachable ONLY via neon-http** — `item_workflow_state`, `workflow_runs`, `workflow_node_stats`, `zoho_locations`. **Hard ordering dependency:** migrate the workflow trio onto `withTenantDrizzle` (repos step 1–2) **before** `enforce_tenant_isolation()` on them, or FORCE locks the workflow engine out entirely (GUC always empty → policy denies all).

---

## Phase D — Cross-cutting infrastructure leaks

### D1 — Ably realtime (the single worst gap). Full spec: [`_analysis/realtime.md`](./_analysis/realtime.md)
Three compounding flaws: all channel names are global (`orders:changes`, `db:*`, …); the token endpoint grants `db:*`/`station:*`/`phone:*`/`packer:*`/`inbox:*` wildcards (with publish) to **every** authenticated user; and `clientId` derives from the client-supplied `x-user-id` header, not the session.
- **Channel scheme:** every channel becomes `org:{orgId}:{suffix}`. Every builder in `src/lib/realtime/channels.ts` takes `orgId` first and `orgChannelPrefix(orgId)` **throws on a non-uuid** (two tenants can never collapse onto one channel). Rename the per-staff `station:{staffId}` bridge to `staffstation:{staffId}` so the `station:*` grant doesn't widen to the global station feed.
- **Token endpoint rewrite** (`src/app/api/realtime/token/route.ts`): `orgId = ctx.organizationId`, `clientId = org:{orgId}:staff:{ctx.staffId}`, capabilities are concrete `org:{orgId}:…` names + a single `org:{orgId}:db:*` wildcard, per-staff channels locked to the caller's own `staffId` (no cross-staff wildcard), plus a fail-closed loop asserting every granted resource starts with the org prefix. The full rewritten file is in the spec.
- **Thread `orgId` through ~70 publisher call sites** (`src/lib/realtime/publish.ts` + every route/job that publishes; `db-events.ts`, `walkin-events.ts`, `workflow/events.ts`) and **~24 client subscribers** (extend `AuthSessionUser` with `organizationId` from `/api/auth/me`; move module-top-level `const X = getXChannelName()` into hook/component bodies; gate `enabled` on `!!orgId`). Make `orgId` a **required** param so `tsc` surfaces every un-migrated call site.
- **Rollout:** dual-publish window (publish to both old global + new org name for one deploy, flip subscribers, then drop the global grant) — or one coordinated deploy (acceptable while USAV is the only tenant).
- **Open design gaps (not renames):** `webhooks/square/route.ts` (resolve org from the Square account→org mapping) and `webhooks/realtime-db/route.ts` (the DB trigger/sidecar must emit `orgId`). `getPrimaryTechStaffIds()` must be org-filtered or it nudges techs across orgs.

### D2 — Cron / background jobs. Full spec: [`_analysis/cron.md`](./_analysis/cron.md)
- Add `src/lib/cron/for-each-org.ts` → `forEachActiveOrg(fn)`: enumerates active orgs and runs `fn` per org inside `withTenantConnection(orgId)` with per-org try/catch isolation. **Correction (from the critique):** the org-enumeration `SELECT id FROM organizations …` and any `REFRESH MATERIALIZED VIEW` / cross-org claim must run on a **privileged `adminPool`**, NOT the tenant role — post-Phase-E the tenant role (with FORCE on `organizations`) would return only its own row or nothing. Plan a **two-pool split**: `adminPool` (owner, for enumeration/MV/cleanup/cross-org claims) + the tenant `pool` used inside `withTenantConnection`.
- **Convert-now** (DB-only, no per-org external creds): `inventory/drift-check` (after `v_sku_stock_drift` is made org-aware), `stock-alerts`, `sourcing/scan`, `sku-catalog/refresh-suggestions`, `staff-goals/history`, `workflow-node-stats`, `replenishment-detect`/`replenishment/sync`, `shipping/reconcile-delivered`, `receiving/incoming-tracking-sync`, `zoho/orders-ingest-drain` (org already per-row — the template for "row carries its own org"), `reconcile-unmatched` (also decide schedule-or-retire — it's orphaned).
- **Blocked on per-org credentials** (`organization_integrations` rows per tenant; `getIntegrationCredentials` only env-falls-back for `USAV_ORG_ID`): all `shipping/subscribe-{fedex,ups,usps}`, `shipping/sync-due`, `ebay/refresh-tokens`, `sourcing/replenish`, all three `zoho/*`.
- **Blocked: neon-http + hardcoded single-tenant source:** `google-sheets/transfer-orders` (single `SOURCE_SPREADSHEET_ID`, Ecwid creds USAV-only, writes via neon-http → keep explicit org-stamping or migrate to the pool).
- **Org-exempt:** `cleanup`, `refresh-reports` (MV refresh needs the privileged role), `shipping/metrics` (read-only), and `src/lib/pipeline/*` + `training_samples` (classify as system/global — self-improvement CLI, keep `transitionalUsavOrgId()`).
- **Cross-org budget math:** `shipping/sync-due` + subscribe jobs have a fixed `limit`/`concurrency` — divide across orgs or shard orgs across schedule ticks, or a per-org loop blows `maxDuration`.

### D3 — PO-Gmail singleton. Full spec: [`_analysis/infra.md`](./_analysis/infra.md) §D3
`google_oauth_tokens` has no org column and is a `WHERE provider='po_gmail' LIMIT 1` singleton. This phase: add `assertUsavMailbox(orgId)` guard + an `orgId = USAV_ORG_ID` default param to `getAccessToken`/`poGmailFetch`/`getConnectedEmail` so a non-USAV org can never read/refresh USAV's token. Real fix (later): a dedicated `(organization_id, provider)` unique migration (template in the spec) — **this is the migration that owns `google_oauth_tokens`, not the B3 staff-child batch.**

### D4 — Caches. Full spec: [`_analysis/infra.md`](./_analysis/infra.md) §D4
- `src/lib/cache.ts`, `staffCache.ts`, `receivingCache.ts` — **client-side, per-tab → global-safe by construction.** No key change; add a SAFETY doc note and ensure `cacheClear()`/`invalidateStaffCache()` fire on sign-out / org-switch.
- `src/lib/auth/role-store.ts` — **leave global for now (corrected).** `roles` has no `organization_id`, so the process-wide cache is correct today. Add a doc note: *"global because `roles` is global; org-key this in Phase F3 when per-org roles land."*

### D5 — Rate limiting. Full spec: [`_analysis/infra.md`](./_analysis/infra.md) §D5
`src/lib/api-guard.ts` already supports `scope`; it's almost never passed. Add `checkRateLimitForOrg({…, organizationId})` and pass `ctx.organizationId` on every authed route (keep IP as the within-tenant dimension; `auth/signup` stays IP-only). **Finding to action:** `UPSTASH_REDIS_*` is not in any local env — confirm both vars exist in Vercel **Production** (`vercel env ls production | grep UPSTASH`); if absent, the limiter silently falls back to per-instance in-memory (effectively off under autoscale). Add a boot warning when Redis is unconfigured.

### D4-cross-cut + B4 — Audit logs carry org. Full spec: [`_analysis/infra.md`](./_analysis/infra.md)
`audit_logs.organization_id` exists (nullable, indexed) but `createAuditLog`'s INSERT omits it → every row writes NULL. Add `organizationId` to `CreateAuditLogParams` + the INSERT; `recordAudit` pulls `ctx.organizationId` (it already has `ctx`). Add a **required** `organizationIdOverride` for the 7 transitional/cron callers (`ctx=null`) so cron audit rows aren't NULL-org. `auth_audit` has no org column — leave child-scoped via `staff` (note as debt).

---

## Phase E — Turn on enforcement (the keystone)

**E1 — Non-`BYPASSRLS` application role.** This is what makes everything above real. Template authored at `src/lib/migrations/2026-06-21_app_tenant_role.sql.template` (NOT auto-applied — it needs a secret + a coordinated `DATABASE_URL` change). Strategy:

1. Create a dedicated runtime role with **no** `BYPASSRLS`, **no** superuser, **no** ownership:
   ```sql
   CREATE ROLE app_tenant WITH LOGIN PASSWORD :'app_tenant_pw'
     NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;
   GRANT CONNECT ON DATABASE neondb TO app_tenant;
   GRANT USAGE ON SCHEMA public TO app_tenant;
   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_tenant;
   GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_tenant;
   GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO app_tenant;
   -- future tables created by the migration owner stay reachable:
   ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public
     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_tenant;
   ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public
     GRANT USAGE, SELECT ON SEQUENCES TO app_tenant;
   ```
   Verify: `SELECT rolbypassrls FROM pg_roles WHERE rolname='app_tenant';` → **false**. Because `app_tenant` is a non-owner, `ENABLE ROW LEVEL SECURITY` alone subjects it to policies (FORCE is only needed for the owner — but keep FORCE for defense-in-depth so even an accidental owner connection is bound).
2. **Two-pool split.** Runtime app + crons connect via `app_tenant` (the new `DATABASE_URL`). Keep a privileged `adminPool` (the `neondb_owner` DSN, e.g. `ADMIN_DATABASE_URL`) for: migrations, the cron org-enumeration, `REFRESH MATERIALIZED VIEW`, cross-org claims (`order_ingest_queue` drain), and any genuinely cross-tenant admin read (the `hermes_agent` AI path — E3). Wire both the `@neondatabase/serverless` WS pool (`src/lib/db.ts`) and the `withTenantDrizzle` adapter onto `app_tenant`.
3. `hermes_agent` (the read-everything AI role the infra preserves) keeps its `hermes_agent_read` policy — confirm AI/agent read paths connect as `hermes_agent` (or the `adminPool`), not `app_tenant`, or they'll be RLS-scoped too.

**E2 — Enforce per table, gated.** For each tenant table, once Phase C+D confirm **all** routes/crons/repos touching it are GUC-scoped (the route-audit reverse index is all `low`, and the tenancy guard is green), run `SELECT enforce_tenant_isolation('<table>');` in a dated migration. Start with the best-covered, highest-value tables (`orders`, `receiving`, `serial_units`). `relax_tenant_isolation('<table>')` is the one-line rollback. **Never enforce a neon-http-only table until it's on `withTenantDrizzle` (Phase C5).**

**E4 — Cross-org regression test per enforced table.** Built harness: `src/lib/tenancy/cross-org-harness.ts`. The canary that **gates the role flip**: `proveRlsIsolatesScratch(appRolePool)` — under `app_tenant`, a `SELECT` with **no** WHERE filter under org B's GUC returns **0** of org A's rows, and a GUC-cleared INSERT loud-fails. Add `src/lib/tenancy/cross-org-isolation.test.ts` wiring the harness (skips cleanly until `TENANT_APP_DATABASE_URL` is set). Plus a per-enforced-table spec asserting an Org-B session gets 404/empty on Org-A rows for each priority route from `_analysis/routes.md`.

---

## Phase F — Identity, membership, lifecycle (to actually sell)

- **F1** Email identity beyond PIN (magic-link or email+password, verification gate, reset). Blocks self-serve B2B.
- **F2** `staff_organization_memberships(staff_id, org_id, role_id)` + `POST /api/auth/switch-org` (re-mints session org) + header switcher. Session already stores active org — extend, don't redesign.
- **F3** Per-org roles — add `organization_id` to `roles` (today global) **and** org-key `role-store.ts` (the deferred D4d work) in the same change. Until then roles stay global.
- **F4** Onboarding/template seeding (reuse Operations Studio + reseller seed templates) so a new tenant isn't blank.
- **F5** Stripe catalog (`STRIPE_PRICE_*`) — tracked in [`saas-commercialization-plan.md`](../saas-commercialization-plan.md); not isolation, but required to charge.

---

## Sequencing (hard dependencies)

```
A (done) ─▶ B (columns) ─▶ C+C5 (route/repo GUC scoping) ─┬─▶ E1 (role) ─▶ E2 (enforce per table, gated) ─▶ E4 (canary gates)
                           D (realtime/cron/audit/cache)  ─┘
```
- **B before C**: routes can't filter a column that doesn't exist.
- **C+D before E**: forcing RLS before touchpoints are GUC-scoped breaks ~400 raw-pool routes (they'd see 0 rows). The per-table `enforce_tenant_isolation` gate exists exactly to prevent this — never enforce a table whose reverse-index isn't all `low`.
- **C5 workflow-trio WS migration before E2 on those tables** — or FORCE locks the workflow engine out.
- **E1 (role flip) before any E2** — FORCE is inert under `BYPASSRLS`; the canary test must pass first.
- **D1 (Ably) is independent of RLS** (separate plane) — ship it early; it's the worst exposure.
- Keep **USAV (`00000000-0000-0000-0000-000000000001`)** as the dogfood/backfill/canary tenant throughout.

---

## Acceptance criteria → how each is proven

| Criterion | Proof |
|---|---|
| Every tenant table: `org_id NOT NULL` + FORCE + policy under a non-bypass role | `coverage.generated.json` (org/forced) + `tenancy-guard.ts (B)` invariant + `cross-org-isolation.test.ts` canary |
| App connects under a role RLS is not bypassed for | `enforcedRoleInvariant()` / `tenancy-guard.ts (B)` |
| Zero raw pool on enforced tenant tables | `tenancy-guard.ts (A)` (reverse-index gate) + ESLint escape-hatch guard |
| Cross-org regression suite green | `cross-org-harness.ts` per-table specs (E4) |
| Ably org-namespaced; token grants only caller's org | token-endpoint rewrite + a test asserting org A's token has no `org:{B}:*` capability (D1) |
| Every cron iterates per active org, isolates failures | `forEachActiveOrg` + per-job conversion (D2) |
| Audit logs carry org | `audit-logs.ts` org thread (D4-cross-cut) |
| PO-Gmail / OAuth scoped or guarded | `assertUsavMailbox` (D3) |
| No cache mixes tenants | client caches proven per-tab; `role-store` documented global-until-F3 (D4) |
| No new `USAV_ORG_ID`/`transitionalUsavOrgId` callers | ESLint guard (A3) + burn-down allowlist shrinking to empty |

---

## Open decisions to confirm before coding the blocked items
1. **Square webhook org resolution** (`webhooks/square/route.ts`) — map Square account → org.
2. **realtime-db webhook** must emit `orgId` from the DB row's `organization_id`.
3. **Materialized views** (`mv_bin_utilization`, `mv_sku_velocity_30d`, `mv_dead_stock`) aggregate across orgs — need an `organization_id` dimension or per-org MVs before multi-tenant dashboards are correct.
4. **Upstash Redis** — confirm `UPSTASH_REDIS_REST_URL`/`_TOKEN` exist in Vercel Production.
5. **Per-org integration onboarding** — `organization_integrations` rows per tenant is the gating dependency for every integration-backed cron (Zoho/eBay/carriers).
