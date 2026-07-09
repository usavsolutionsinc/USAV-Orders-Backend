# Phase 1 — Tenant Isolation via RLS (gated rollout)

**Status:** Plan + infrastructure migration drafted (2026-06-13). Not yet enforced on any table.
**Goal:** A second tenant's data is isolated at the database, even if a handler forgets to filter — closing the cross-tenant leak before onboarding real external customers.

---

## Why this can't be a one-shot migration (audit findings)

A full multi-tenancy audit produced two blocking constraints:

1. **The app connects as the table owner (`neondb_owner`).** Postgres owners *bypass* RLS unless `FORCE ROW LEVEL SECURITY` is set. The ~70 tables that already have `ENABLE ROW LEVEL SECURITY` today are therefore **completely inert** — every query bypasses them. So enforcement requires `FORCE` per table (or moving the app to a non-owner role).

2. **Most routes don't carry the tenant GUC.** Of 571 API routes:
   - **7** run inside `withTenantConnection`/`tenantQuery` (GUC set — RLS-safe).
   - **~343** import the raw `@/lib/db` pool (no GUC).
   - **17** use Drizzle `neon-http`, a stateless HTTP transport that **structurally cannot** carry a session GUC (each query is a separate request).

   The instant RLS is `FORCE`d on a table, any query against it that runs *without* `app.current_org` set returns **zero rows** (SELECT) or hits a **NOT NULL violation** (INSERT). Global enablement would break ~360 routes.

**Conclusion:** enforce **per table**, each gated on the routes touching that table having been migrated to the tenant wrappers. Decision: take the **`FORCE`-per-table** path (keep the single `neondb_owner` role) rather than re-pointing `DATABASE_URL` at a new non-owner role — lower blast radius, and it's what the existing migrations already anticipated.

---

## The footgun to remove (coupled to enablement)

`2026-05-21_org_id_transitional_default.sql` set every `organization_id` column's `DEFAULT` to `COALESCE(current GUC, USAV_ORG_ID)`. So a raw-pool INSERT with no GUC **silently lands the row under the USAV org**. Under strict isolation that's exactly backwards. The drafted helper flips this column default to **loud-fail** (`NULLIF(current_setting('app.current_org', true), '')::uuid`) **per table, at the moment that table is enforced** — never globally, because the raw-pool routes still depend on the old default until they're migrated.

---

## What's drafted now (safe to apply)

`src/lib/migrations/2026-06-14_rls_enforcement_infra.sql` — defines two functions and **enforces nothing**, so applying it changes no runtime behavior:

- `enforce_tenant_isolation(table)` — per table: loud-fail default + `ENABLE` + `FORCE` + canonical `tenant_isolation` policy (USING + WITH CHECK) + preserves the `hermes_agent` read bypass.
- `relax_tenant_isolation(table)` — rollback (drops FORCE, restores the USAV-fallback default) for the migration window.

Per-table rollout then lives in small follow-up dated migrations: `select enforce_tenant_isolation('<table>');`.

---

## Rollout order (each step = migrate routes → enforce → test)

For each table, the unit of work is: **(a)** migrate every route that reads/writes it onto `withTenantConnection`/`tenantQuery`/`withTenantTransaction`, **(b)** `select enforce_tenant_isolation('<table>')` in a new migration, **(c)** run the cross-tenant isolation test.

1. **Pilot — already-wrapped surfaces.** Tables behind the 7 tenant-wrapped routes (`rag_documents`, `rag_document_chunks`, `ebay_accounts`, `ebay_api_calls`). *Caveat:* first confirm no *other* raw-pool route also touches these (per-table access audit), then enforce. This proves the mechanism end-to-end with minimal route migration.
2. **High-value core, by subsystem.** Migrate-then-enforce subsystem by subsystem where routes already have `ctx.organizationId` but don't thread it down: `warranty/*`, `receiving/*`, `inventory/*` + `neon/*`, `reports/*`. These are the bulk of the 343 raw-pool routes.
3. **The 17 Drizzle `neon-http` routes.** Blocked until their data access moves off `neon-http` onto the pooled/WS driver (or a per-query GUC wrapper). Track separately; do **not** enforce their tables until then.

**Exclusions / special cases:**
- `roles`, `staff_roles` — **no `organization_id`** (global by design). Never enforce; exclude from any blanket loop. `role-store.ts` running raw-pool is fine for these.
- `audit_logs.organization_id` is **nullable** (system/no-actor rows). A strict `= GUC` policy would hide NULL-org rows. Either keep it unforced or use a policy that allows `organization_id IS NULL` for the system path.
- Cron/pipeline/realtime paths that call `transitionalUsavOrgId()` (`cron/zoho/orders-ingest-drain`, `lib/pipeline/*`, `lib/realtime/publish.ts`, `lib/jobs/google-sheets-transfer-orders.ts`, `lib/zoho/fulfillment-sync.ts`) have no request-scoped org — give them a real org or a service-role path before enforcing the tables they write.

---

## Verification harness (permanent regression gate)

A two-org isolation test, run after each enforcement step:

```
1. withTenantTransaction(orgA): INSERT a row into the enforced table.
2. withTenantConnection(orgB): SELECT it → expect 0 rows.
3. withTenantConnection(orgB): attempt UPDATE/DELETE of orgA's row → 0 affected.
4. withTenantConnection(orgA): SELECT it → visible.
5. Raw pool (no GUC): INSERT without org → expect NOT NULL violation (loud-fail).
```

Add this as a vitest spec gated in CI so a regression (a new raw-pool route on an enforced table) fails the build.

---

## Migration mechanics
- Files in `src/lib/migrations/`, naming `YYYY-MM-DD_description.sql`, applied by `npm run db:migrate` (`scripts/run-pending-migrations.mjs`), SHA-256 tracked in `schema_migrations` (don't edit an applied file — add a new one).
- `2026-06-14_rls_enforcement_infra.sql` is **function-only / no enforcement** → safe to apply now. Enforcement migrations come after route migration, per the order above.

## Anchors
- Helper: `src/lib/migrations/2026-06-14_rls_enforcement_infra.sql`
- GUC plumbing: `src/lib/tenancy/db.ts` (`withTenantConnection` / `tenantQuery` / `withTenantTransaction`)
- Existing inert policies / template: `2026-05-23_org_id_on_business_tables.sql`, `2026-06-02_hermes_agent_rls_read.sql`
- Transitional default to undo: `2026-05-21_org_id_transitional_default.sql`
- Escape hatch to remove: `transitionalUsavOrgId()` in `src/lib/tenancy/db.ts`
