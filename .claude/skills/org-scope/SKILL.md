---
name: org-scope
description: Migrate a single API route, domain module, or query to tenant-isolated (RLS GUC) scoping — convert raw @/lib/db pool reads/writes to withTenantTransaction / tenantQuery(orgId, …), thread ctx.organizationId from withAuth (never the body), and re-verify with the existing tenancy audit + guard. Use for incremental org-scope hardening; the tier0-* workflows do the bulk sweeps.
allowed-tools: Read, Grep, Glob, Edit, Bash
---

# Org-scope a route (tenant isolation)

Threads one unit of work onto the per-org GUC path so RLS (`app.current_org`) can
back it up. This is the **incremental** tool — the `tier0-*` workflows migrate whole
route domains at once. Read `.claude/rules/backend-patterns.md` ("Tenant scoping via
GUC") and `docs/tenancy/multi-tenancy-execution-plan.md` before non-trivial work.

**Strategy anchor:** the plan is *logical RLS* (one DB, `organization_id` + GUC),
NOT db-per-tenant. Enforcement only bites under the non-BYPASSRLS `app_tenant` role —
`neondb_owner` has BYPASSRLS which defeats `FORCE`. A table may be `FORCE`-enforced
only once **every** route touching it is GUC-wrapped (that's the gate the guard checks).

## Don't reinvent — the audit tooling already exists

```bash
npm run tenancy:coverage   # DB ground-truth: each table's org_id/RLS/FORCE state
npm run tenancy:routes     # static scan: per-route risk + tenantWrapped/rawPool + table reverse index
npm run tenancy:audit      # both of the above
npm run tenancy:guard:check # CI gate: enforced tables must have all routes GUC-wrapped + role not BYPASSRLS
```

Generated outputs (already committed): `docs/tenancy/route-audit.generated.json`,
`coverage.generated.json`, and the human `*.generated.md` triage docs.

## Step 0 — pick the target (and classify it)

Find unwrapped routes that touch tenant tables, worst-risk first:

```bash
jq -r '.routes[]
  | select(.tenantWrapped==false and (.touched|length>0))
  | "\(.risk)\t\(.route)\t[\(.touched|join(","))]"' \
  docs/tenancy/route-audit.generated.json | sort | head -40
```

**Classify before fixing — most "critical" entries are noise.** A route that touches
`staff` for auth (`/api/auth/*`), a cron, or a global-reference table is not a tenant
leak. A real leak is a business-data route (orders/receiving/inventory/sku/customers…)
that reads or writes a tenant-owned table through the raw pool without an org filter.
When unsure whether a table is tenant-owned, check its classification in
`coverage.generated.json`. Skip auth/session/global-reference tables.

## Step 1 — read the route, find the raw-pool calls

Grep the target for the raw pool and unscoped writes:
```bash
grep -nE "import pool|from '@/lib/db'|pool\.query|\.query\(" <route file>
```
Each `pool.query(sql, params)` on a tenant table is a candidate. Note whether the SQL
already has an `organization_id = $N` filter (keep it — see Step 2).

## Step 2 — convert to the GUC path

- One-off query → `tenantQuery(ctx.organizationId, sql, params)`.
- Multi-statement / write transaction → `withTenantTransaction(ctx.organizationId, async (client) => { … })`.
- Import from `@/lib/tenancy/db`; drop the `import pool from '@/lib/db'` if now unused.
- `organizationId` comes from `ctx.organizationId` (collection routes via `withAuth`) or
  `gate.ctx.organizationId` (`[id]` routes via `requireRoutePerm`) — **never the request body.**
- **Keep the explicit `AND organization_id = $N` filter.** Defense in depth: the GUC is a
  backstop for forgotten filters, not a replacement. The reference migration keeps both:

```ts
import { tenantQuery } from '@/lib/tenancy/db';
// …
const { rows } = await tenantQuery(
  ctx.organizationId,
  `SELECT … FROM customers WHERE id = $1 AND organization_id = $2 LIMIT 1`,
  [id, ctx.organizationId],
);
```
(see `src/app/api/customers/[id]/route.ts` for the canonical shape.)

- Status changes still go through `transition()` / `applyTransition()`, never raw
  `UPDATE … current_status` (the sot-guard hook enforces this).
- Do NOT use `transitionalUsavOrgId()` / `USAV_ORG_ID` in new code — those are the
  deprecated escape hatch for callers that don't yet have an orgId threaded.
- Session-less crons have no `ctx`: thread a service org id explicitly (see the
  tier0 identity-and-crons pattern), not the transitional hatch.

## Step 3 — re-verify

```bash
npm run tenancy:routes                       # regenerate the audit
jq -r '.routes[] | select(.route=="<your route>")' docs/tenancy/route-audit.generated.json
```
Confirm the entry now shows `"tenantWrapped": true` and its `risk` dropped. Then:
```bash
npm run tenancy:guard:check                  # must stay green
npx --no-install next lint --file <relative route path>
```
If you GUC-wrapped the **last** raw-pool route touching a table, that table becomes a
candidate for `FORCE` enforcement — note it for the owner, but don't enable FORCE here
(that's a coverage/role decision, and only safe under the `app_tenant` role).

Report: route, the queries converted, before/after risk, and guard status. Don't commit
(user commits via GitHub Desktop).

## Rules

- `organizationId` from the auth context, never the body.
- Keep explicit `organization_id` filters — GUC is a backstop, not a substitute.
- Don't enforce (`FORCE`) a table from this skill; wrapping routes is the prerequisite, not the act.
- Classify before migrating — auth/session/cron/global-reference tables are not tenant leaks.
- Regenerate the audit after the change so `route-audit.generated.json` stays truthful.
