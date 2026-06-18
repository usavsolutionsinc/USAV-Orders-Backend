# Tenant-isolation vertical slice — per-table runbook

This is the repeatable recipe for taking ONE table from "armed but inert" to a
**real enforced tenant boundary**, without a big-bang flip. Worked example:
`reason_codes` (2026-06-16, the first slice).

The horizontal plan in `multi-tenancy-execution-plan.md` (B all columns → C all
routes → E all enforce) is the strategy; this is how we execute it as small
vertical slices so each one ships a *provable* boundary in days.

## Why slices, and why a leaf first

`enforce_tenant_isolation(t)` cannot pass `tenancy:guard` until **every** route,
lib, and cron that touches `t` is GUC-wrapped. For a hub like `orders` (~60
querying routes) that's weeks of prerequisite. A **leaf** table (few consumers)
proves the whole pipeline — migration + canary + guard — cheaply, and leaves a
template. Pick first slices by fan-in:

```sh
# routes that actually query a table
grep -rEl "\b(FROM|JOIN|INTO|UPDATE)\s+(public\.)?<table>\b" src/app/api --include=route.ts -i | wc -l
# all consumers (don't forget src/lib, crons)
grep -rEn "(FROM|JOIN|INTO|UPDATE)[[:space:]]+(public\.)?<table>\b" src --include="*.ts" -i
```

## The 6 steps

1. **Confirm org_id is armed.** Table must be in the `2026-05-23` business-table
   list (org_id column + GUC-reading default + ENABLE RLS + `*_tenant_isolation`
   policy). If not, add it to a Phase B batch first.

2. **Audit every consumer.** Each SQL hit (step above) must run under
   `tenantQuery` / `withTenantConnection` (GUC set) **and** filter/stamp
   `organization_id`. Watch for:
   - raw `pool` imports used only for `recordAudit` → fine (audit_logs is separate).
   - cross-table JOINs on a natural key → must add `AND a.organization_id = b.organization_id`
     (see `warranty/reports.ts` joining `reason_codes` on `code`).
   - crons → must use `forEachActiveOrg` + `withTenantConnection`.

3. **Fix tenant-blind constraints.** A column-level `UNIQUE(code)` is global and
   will reject a second tenant's identical value. Make it `UNIQUE(organization_id, code)`.
   Ship as a normal `*.sql` (safe now). → `2026-06-16_reason_codes_per_org_unique.sql`

4. **Write the FORCE as a `.sql.template`.** `SELECT enforce_tenant_isolation('<table>');`
   The runner only applies `*.sql`, so `.sql.template` stays gated until the
   coordinated E1 promotion. → `2026-06-16_enforce_tenant_isolation_reason_codes.sql.template`

5. **Add a self-arming canary** to `cross-org-isolation.test.ts`: skip unless the
   table's `relforcerowsecurity` is true, then prove org B sees 0 of org A's rows
   with no WHERE filter (insert under A, flip GUC to B mid-tx, assert, ROLLBACK —
   no permanent writes).

6. **Promote (owner-only, with Phase E1).** Rename the template to drop `.template`,
   `npm run db:migrate`, `npm run tenancy:guard:check`. The canary arms itself.
   Rollback = `SELECT relax_tenant_isolation('<table>');`.

## Slice batch status (2026-06-16)

**14 tables slice-ready** (consumers GUC-safe, FORCE templates written + gated).
All promotion is owner-gated on Phase E1 (app runs as `app_tenant`). Guard green
(0 forced), tsc clean, dry-run shows only the 2 correctness migrations pending.

| Cohort | Tables | Consumer work done this session |
|---|---|---|
| reason_codes | reason_codes | already GUC-safe; `UNIQUE(code)`→per-org |
| cohort_1 | serial_unit_condition_history, cycle_count_campaigns, cycle_count_lines, printer_profiles, credit_notes | already GUC-safe, no fixes |
| cohort_2 | favorite_skus, favorite_sku_workspaces, repair_issue_templates, location_transfers | converted raw-pool/dual-mode helpers → `tenantQuery`/`withTenantConnection`; `favorite_skus` `UNIQUE(sku_normalized)`→per-org |
| cohort_3 | entity_notes, model_versions, stock_alerts, qc_check_templates | converted drizzle-neon-http → `withTenantDrizzle`; raw `queryRaw` server component → `tenantQuery` |

Files: `2026-06-16_*_per_org_unique.sql` (apply-now correctness) +
`2026-06-16_enforce_tenant_isolation_*.sql.template` (gated FORCE) +
canaries in `cross-org-isolation.test.ts` (reason_codes behavioral + a generic
"every FORCEd table has a complete tenant_isolation policy" guard).

## Remaining / next

- **`bin_contents`** — DEFERRED: fan-in 16 with 8 distinct non-GUC consumers
  (drizzle repo, cron sourcing-scan, admin page, bose-model-queries, sku-catalog,
  locations swap, pick-face, location-queries). Hub-class; needs its own focused
  pass like `orders`.
- **Hubs** (`orders` ~60, `sku_catalog` 41) — defer until route fan-in is wrapped.
- **Lesson:** trust the per-table audit (reads the specific CREATE TABLE) over a
  file-level `grep UNIQUE` — shared migration files (zoho domain, sku_catalog_hub)
  produced false-positive constraint flags on credit_notes/entity_notes/qc_check_templates.
