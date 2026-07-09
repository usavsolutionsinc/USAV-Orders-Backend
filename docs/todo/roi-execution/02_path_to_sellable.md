# Tier 1 — Path to Sellable (the two coupled halves)

**#5 (revenue switch) and #6 (leak closure) ship together.** #5 lets you charge
differentially; #6 makes it safe to put strangers' data in one database. Shipping #5
without #6 = billing external tenants while cross-tenant reads/writes are possible.
**Hard rule: #6 lands first or same deploy as #5.**

---

## #6 — Close the cross-tenant leaks  ·  Reliability + SaaS · Effort M · **do first**

The audit already surfaced these (they are pre-existing, not new). Source of truth:
`docs/tenancy/coverage.generated.json`, `docs/tenancy/org-id-coverage.generated.md`,
`docs/partial/HUMAN-TODO.md` §G3.

### 6a — Route-level logic leaks (🔴 security-grade) — HUMAN-TODO §G3
Handlers call query fns **without org scope** even though the tables are RLS'd — because
these paths use the raw pool, not `withTenantTransaction`:
- `/api/repair-service` GET + PATCH — `getAllRepairs`/`searchRepairs`/update unscoped.
- `/api/shipped` GET (non-search) + PATCH — `getAllShippedOrders`/`updateShippedOrderField`
  missing the `organizationId` arg.
- `/api/packerlogs` PUT + DELETE — no `organization_id` predicate; **delete-by-integer-ID
  is cross-tenant.**

**Do:** thread `ctx.organizationId` into each query fn (make `orgId` **required**, not
optional) and/or wrap the handler in `withTenantTransaction(orgId, …)` so RLS applies.
Add an IDOR regression test per route (mirror `src/lib/tenancy/idor-regression.test.ts`).

**Acceptance:** each route, given org A's session and org B's record id, returns 404 /
refuses — verified by a new test in the tenancy IDOR suite. Run `npm run tenancy:routes`
and `npm run test:tenancy-idor` green.

### 6b — The 8 "USAV-fallback default" tables — org-id-coverage.generated.md L14
`org_id` **defaults to the USAV org**, so an insert that omits an explicit org is silently
misattributed to tenant #1 (e.g. `shipment_tracking_events` ~23k rows,
`shipping_tracking_numbers` ~6,979 rows, `training_runs`).

**Do:** author a migration that drops the `DEFAULT` (making `org_id` NOT NULL with no
default → loud-fail on omission, per `.claude/rules/polymorphic-tables.md`), after
confirming all writers set it explicitly. Backfill any mislabeled rows if detectable.

**Acceptance:** no tenant-owned table silently defaults to the USAV org; writers that omit
org fail loudly, not silently misattribute.

### 6c — The 9 tables missing `org_id` — coverage.generated.json `needs_col: 9`
No RLS possible until the column lands.

**Do:** identify the 9 (`node scripts/tenancy-coverage.mjs`), author a migration adding
`organization_id UUID NOT NULL` + per-org keys + `enforce_tenant_isolation()` in the same
migration (house pattern), backfill from the parent relation.

**Acceptance:** `tenancy:coverage` shows `needs_col: 0` for tenant-owned tables;
`tenancy:guard:check` passes.

---

## #5 — Flip the revenue switch (entitlement enforcement)  ·  Revenue · Effort M

**Now:** billing infra is production-grade (`src/lib/billing/*` — hand-rolled webhook
sig verification, subscription mirror, plan catalog, checkout/portal, meter events), but
enforcement is dormant:
- Only **2** routes gate on plan: `settings/route.ts:91`, `auth/sso/start/route.ts:69`.
- Every gate fails open: `plan-feature-gate.ts:49/72` (`PLAN_FEATURE_ENFORCED`),
  `studio-gate.ts` (`STUDIO_ENTITLEMENT_ENFORCED`), `trial-gate.ts:25` (`TRIAL_ENFORCEMENT`).
- Usage ceilings (`maxStaff`/`maxMonthlyOrders`/`maxWarehouses` in `plans.ts`) checked
  nowhere except `maxIntegrations` (`connections.ts:103`).

**Do:**
1. **Inventory feature→route map.** For each catalog feature (fba, sourcing, aiChat,
   walkIn, advancedVision, studio…), list the route groups that expose it.
2. **Add `requireFeature(...)`** to those ~15–20 route groups (reuse the existing
   `entitlements.ts` / `plan-feature-gate.ts` helpers — do not invent a new mechanism).
3. **Wire the count ceilings** — check `maxStaff` on staff-create, `maxMonthlyOrders` on
   order ingestion, `maxWarehouses` on warehouse-create, against the plan.
4. **Stage the flip:** enable `PLAN_FEATURE_ENFORCED` for a test org; verify a `starter`
   org is denied Growth/Pro features and a Pro org is allowed; then roll wider.

**Acceptance:** a `trial`/`starter` tenant is denied higher-tier features and hitting a
ceiling returns a clear upgrade path; a Pro tenant is unaffected. Tiers are now
differentiable → **the product is invoiceable.**

---

## Sequencing & rollout

```
6a (route leaks + IDOR tests)  ──►  6b (default-org drop)  ──►  6c (missing org_id)
                                          │
                                          ▼
                         5 (requireFeature + ceilings, staged flip)
                                          │
                                          ▼
                      Tier 0 #1 trial expiry + #4 Redis (Plan 01)  ──►  can bill external tenant #2
```

Gate each with the existing harness: `tenancy:audit`, `tenancy:guard:check`,
`test:tenancy-idor`, `audit-route-auth:check`.

## Risks
- **Migrations are deploy-coupled** (HUMAN-TODO §C) — the default-drop / add-column
  migrations must land WITH their code deploy, never standalone. Author with the
  `db-migration-author` skill; apply via the owner's deploy.
- **Fail-open → fail-closed is a behavior change** — stage per-org, watch for false
  denials, keep the flag as an instant revert.

## Cross-references
- [00 — Index](00_INDEX_ROI_EXECUTION.md) · [01 — Tier 0](01_tier0_flip_switch_wins.md) (trial + Redis complete this path)
- `docs/partial/HUMAN-TODO.md` §G3 (leaks), §A4/tier0-execution-checklist, P3-BIZ-01.
- `.claude/rules/polymorphic-tables.md`, `.claude/rules/backend-patterns.md` (org scoping).
