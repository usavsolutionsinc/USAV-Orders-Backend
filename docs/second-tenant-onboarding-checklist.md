# 2nd-Tenant Onboarding & Verification Checklist

**For:** you, standing up a brand-new org and exercising it as your own "tenant #2" to prove the platform is safe to sell (Q4 + Q5).
**Read first:** `docs/sellable-foundation-execution-plan.md`. **Golden rule:** the test only means something if tenant #2 is a *real different org* and you confirm it can **never** see USAV's rows.

Mark each row `[x]` pass / `[!]` fail (note what broke).

---

## 0 · Preconditions (must be true before you start)

- [ ] **Composite-key migrations applied** (`sku_catalog` → `UNIQUE(organization_id, sku)`, `fba_fnskus` → `PK(organization_id, fnsku)`) **with** the `ON CONFLICT (organization_id, …)` code flip deployed. *Without this, tenant #2 cannot insert any SKU/FNSKU that USAV already has — the test will fail on first product ingest.* (WS1)
- [ ] **`app_tenant` role live** — `TENANT_APP_DATABASE_URL` set; `npm run tenancy:guard:check` passes (confirms runtime role is `bypassrls=false`).
- [ ] **Global roles seeded** — `SELECT count(*) FROM roles WHERE is_system;` returns 8. (If 0, run `node scripts/seed-roles.mjs` once; signup wires the new admin to the global `admin` role, so this must exist or tenant #2's admin lands with zero permissions.)
- [ ] You have a **second email** you control (not USAV's) for the new owner identity.

---

## 1 · Stand up tenant #2 (no DB surgery)

- [ ] Go to `/signup`. Create org: distinct **company name**, **slug**, **fullName**, **new email**, a non-obvious **PIN**.
- [ ] Signup returns `{ orgId, slug, staffId }` and drops you on `/dashboard` — note the **new orgId** (call it `ORG2`).
- [ ] Confirm in DB the org exists and is on trial:
  `SELECT id, slug, plan, trial_ends_at FROM organizations WHERE slug = '<your-slug>';` → `plan = 'trial'`, `trial_ends_at ≈ now()+14d`.
- [ ] Confirm the admin staff is wired to a role:
  `SELECT s.id, s.role, r.key FROM staff s LEFT JOIN staff_roles sr ON sr.staff_id = s.id LEFT JOIN roles r ON r.id = sr.role_id WHERE s.organization_id = '<ORG2>';` → at least one row with `r.key = 'admin'`. *(If `r.key` is NULL, the admin role wasn't seeded — fix preconditions and re-test.)*
- [ ] Confirm catalog seeded for ORG2: `SELECT count(*) FROM platforms WHERE organization_id = '<ORG2>';` → > 0.

---

## 2 · Provisioning & login (Tier 2)

- [ ] Log out, log back in as the ORG2 admin **via PIN** → lands on `/dashboard`.
- [ ] Request an **email magic-link** for the new owner email → receive it → it logs you into ORG2.
- [ ] The admin can reach an admin-gated page (e.g. `/settings/integrations`) **without** a "not authorized" — confirms permissions resolved (not the `'unknown'` role).
- [ ] *(After WS6)* multi-org switcher under **Settings → Organization** lets the same account hop USAV ⇄ ORG2 without re-auth.

---

## 3 · Tenant isolation — the load-bearing test (Tier 1)

Do these **as the ORG2 admin** (the runtime uses the RLS-subject `app_tenant` pool):

- [ ] **Orders:** the outbound board (`/outbound`) shows **zero** orders (ORG2 is brand new) — **not** USAV's queue.
- [ ] **Direct probe** (run as the tenant pool / via the app, not the owner pool): `SELECT count(*) FROM orders;` while scoped to ORG2 → returns only ORG2's rows (0 initially), never USAV's.
- [ ] **SKU catalog:** create a SKU in ORG2 that **also exists in USAV** (same `sku` string). It must succeed (proves the composite key) and must be invisible to USAV.
- [ ] **Search/global search** in ORG2 returns no USAV serials/SKUs/orders.
- [ ] **Cross-org canary:** `npm run tenancy:guard:check` still green; optionally run `src/lib/tenancy/cross-org-isolation.test.ts`.
- [ ] **Negative test:** try to open a USAV record by id while logged into ORG2 (e.g. `/api/orders/<a-USAV-order-id>`) → **404**, never the row.

---

## 4 · Day-one value path (Tier 3)

- [ ] **Empty state:** fresh dashboard shows a "connect your first channel" CTA, not a broken-looking blank board *(after WS3.2)*.
- [ ] **Channel connect:** connect an eBay (or Amazon) account **to ORG2** → it lands in `ebay_accounts`/`amazon_accounts` stamped with ORG2 → "Sync now" pulls **ORG2's** orders only.
- [ ] **CSV import:** import a CSV of products/orders *(after WS3.1)* → rows land org-scoped to ORG2, visible only in ORG2.
- [ ] **Tracking:** an ORG2 shipment with a UPS/FedEx tracking number gets polled and shows status (USPS excluded by design, Q13).

---

## 5 · Billing (Tier 4) — run in Stripe **test** mode first

- [ ] `/settings/billing` → **Upgrade** → Stripe Checkout opens with the right price ($49 Starter).
- [ ] Pay with `4242 4242 4242 4242` → webhook fires → `organizations.plan` for ORG2 flips `trial → starter`; `billing_subscriptions` mirrors with `organization_id = ORG2`.
- [ ] Open the **billing portal** → cancel → plan flips back. Confirms the full loop is org-scoped (USAV's plan untouched).
- [ ] **Trial:** confirm a fresh trial tenant still has **full access during the 14 days** (free-trial preview, Q15) — no hard lock.

---

## 6 · De-USAV coupling awareness (Tier 5) — expected limitations, not failures

These are **known** until WS5 lands; verify they **degrade, not crash**, for ORG2:

- [ ] **Zendesk / warranty:** if ORG2 has no Zendesk configured, warranty/support features should degrade gracefully (not POST to USAV's Zendesk). *(Until WS5.1 this may be coupled — note it.)*
- [ ] **PO-Gmail triage:** ORG2 hitting PO-Gmail should be **blocked cleanly** (it can't read USAV's mailbox), not error the whole page. *(WS5.2)*
- [ ] **Shipping sync:** confirm ORG2's tracking isn't silently scoped to USAV. *(WS5.3 removes the `transitionalUsavOrgId()` hardcode.)*

---

## 7 · Sign-off

- [ ] Sections 1–5 all `[x]`. Section 6 limitations are **documented and acceptable** for the first external tenant, or fixed.
- [ ] No step surfaced a single USAV row inside ORG2. **If any did — stop; that's a hard blocker, do not onboard a real tenant.**

> When this checklist passes end-to-end, the platform is **technically safe to onboard a paying external tenant.**
