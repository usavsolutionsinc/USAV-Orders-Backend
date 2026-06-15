# Tier 0 Go-Live Runbook — Stripe billing + E1 tenant enforcement

The two owner-gated keystones that unlock the sellable foundation. Part A (Stripe) is fully ready now. Part B (E1) is now wired in code for an **incremental, non-breaking** rollout — you provision the role + set one env var, then tables get enforced one at a time.

Legend: **[you]** = a step you run (Neon / Vercel / Stripe). **[done]** = already in the codebase.

---

## Part A — Stripe go-live (charge real customers)

Everything is built + verified; what remains is live config.

1. **[you] Create the live webhook endpoint + billing portal.** In your terminal (the `!` prefix keeps it in this session), with your real live secret key:
   ```
   STRIPE_SECRET_KEY=sk_live_xxx node scripts/stripe/setup-webhook-and-portal.mjs --live
   ```
   It is idempotent and prints `STRIPE_WEBHOOK_SECRET=whsec_…` (shown once — copy it) + the live `STRIPE_PRICE_*` block.

2. **[you] Set in Vercel → Production**, then **redeploy** (env is build-baked):
   - `STRIPE_WEBHOOK_SECRET` = the `whsec_…` from step 1 *(currently unset everywhere — the single highest go-live risk: without it a customer is charged but nothing mirrors and no plan flips)*
   - confirm `STRIPE_SECRET_KEY` = `sk_live_…` and `STRIPE_PUBLISHABLE_KEY` = `pk_live_…` (not test)
   - `STRIPE_PRICE_STARTER=price_1Tht1iLvhV85DRvtUFc2ovPV`
   - `STRIPE_PRICE_GROWTH=price_1Tht1lLvhV85DRvtCAtAI1Xj`
   - `STRIPE_PRICE_PRO=price_1Tht1nLvhV85DRvtrny4be3Z`
   - (leave `STRIPE_PRICE_ENTERPRISE` unset; set `NEXT_PUBLIC_APP_URL` + `BILLING_NOTIFICATION_DOMAIN` to the real domain)

3. **[you] Smoke-test** on `/settings/billing`: Upgrade → Stripe Checkout (card `4242 4242 4242 4242` in test first, then a real card live) → confirm `billing_subscriptions` mirrors + `organizations.plan` flips → open the portal → cancel → confirm it flips back.

[done] catalog created, webhook route deployed, `Stripe-Version` pinned, idempotency gate, portal config auto-creation (becomes the account default).

---

## Part B — E1: the `app_tenant` role + incremental enforcement

**Why:** the app connects as `neondb_owner`, which has `BYPASSRLS` — so every RLS policy is inert today. Enforcement requires the runtime's tenant-scoped paths to connect under a non-bypass role.

**The architecture (now wired in `src/lib/db.ts`):**
- The default `pool` (raw `@/lib/db`) stays on `DATABASE_URL` = **owner**. Un-migrated raw-pool routes keep working (the owner bypasses `ENABLE`-but-not-`FORCE` RLS).
- `withTenantConnection` / `tenantQuery` / `withTenantTransaction` / `withTenantDrizzle` run on `tenantPool` = **`TENANT_APP_DATABASE_URL`** (the `app_tenant` role) when that env is set — so those paths become RLS-subject.
- A table is `FORCE`-enforced only once **all** routes touching it are GUC-wrapped (on `tenantPool`). That's the per-table gate; raw-pool (owner) access to a `FORCE`d table is then blocked, which is why every toucher must be migrated first.
- No separate `ADMIN_DATABASE_URL` is needed in this design — migrations, `forEachActiveOrg` enumeration, MV refresh, and the AI read path all use the default (owner) `pool`.

### Steps
1. **[you] Create the role.** In the Neon SQL console, run `src/lib/migrations/2026-06-21_app_tenant_role.sql.template` (replace `:'app_tenant_pw'` with a strong secret — do not commit it). Verify:
   ```sql
   SELECT rolname, rolbypassrls, rolsuper FROM pg_roles WHERE rolname='app_tenant';  -- expect: app_tenant | f | f
   ```
2. **[you] Run the canary** (proves RLS isolates a scratch table under the role — **no prod-table impact**):
   ```
   TENANT_APP_DATABASE_URL=<app_tenant DSN> node --test --import tsx src/lib/tenancy/cross-org-isolation.test.ts
   ```
3. **[you] Set `TENANT_APP_DATABASE_URL`** = the `app_tenant` DSN in Vercel Production (+ `.env.local`); keep `DATABASE_URL` = owner. Redeploy. Now the already-migrated GUC paths (`reason_codes`, `fba`, `warranty` reads, the 7 original) run as `app_tenant`. **No table is `FORCE`d yet, so nothing breaks** — `app_tenant` simply respects RLS where the GUC is set.
4. **[you] confirm the guard:** `npm run tenancy:guard:check` — invariant (B) should confirm `bypassrls=false` on the runtime role.
5. **Enforce per table** (FORCE), easiest first. For each, add a dated migration `SELECT enforce_tenant_isolation('<table>');`, apply via `npm run db:migrate`, then run the per-table cross-org test:
   - **First (zero raw-pool routes — safe immediately):** `rag_documents`, `rag_document_chunks`, `shipment_orders`.
   - **Then:** `reason_codes` (all routes GUC-wrapped).
   - **fba tables** — but **first** add a composite `(organization_id, fnsku)` PK to `fba_fnskus` (today it's bare-global `fnsku`; under FORCE two orgs can't share an FNSKU string) and flip its `ON CONFLICT`. Then the fba tables whose every toucher is migrated. (The cross-domain readers `work-orders`/`global-search`/`packing-logs` + the `tech/*` scan routes must be GUC-wrapped before their shared fba tables can FORCE.)
   - **warranty** — after the warranty write-path + the `clock-sweep` cron are migrated (the cron must loop orgs via `forEachActiveOrg` or run on the owner pool).
6. **Do NOT onboard a second tenant** until the hot tables (`orders`/`receiving`/`serial_units` + the above) are `FORCE`d. Until then a 2nd tenant's un-migrated raw-pool routes would see cross-tenant rows.

### Rollback
- Per table: `SELECT relax_tenant_isolation('<table>');` (drops FORCE).
- Whole role: unset `TENANT_APP_DATABASE_URL` (wrappers fall back to the owner pool) + redeploy.

---

## Sequencing
`Stripe (Part A)` and `E1 steps 1–4` are independent and can both be done now. `E1 step 5` (per-table FORCE) proceeds as the route burn-down completes for each table — tracked in `docs/tier0-execution-checklist.md`.
