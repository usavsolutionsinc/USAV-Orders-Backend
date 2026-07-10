# SaaS Commercialization Plan — Getting to Industry Standard

**Status:** Plan of record · authored 2026-06-13 · **~75% (updated 2026-07-10):** billing loop
code-complete, RLS isolation live, identity beyond plan (magic-link/passkeys/OIDC/invitations).
**2026-07-09/10 wave closed the buildable residuals:** plan ceilings wired
(`src/lib/billing/plan-ceilings.ts` — maxStaff on staff-create/invite ×3 routes,
soft maxMonthlyOrders on manual create + button sync, maxWarehouses helper ready [no create route
exists]; dormant behind `PLAN_FEATURE_ENFORCED`, dogfood-exempt, fail-open, 10 tests); feature
gates extended (fba 26 / repair 38 / support 14 handlers); connect-path guard
(`assertCanConnectProvider`); dunning hook (`src/lib/billing/delinquency.ts`); activation
instrumentation (`src/lib/billing/activation-events.ts`); trial gate test-pinned. **Remaining =
external/owner:** Stripe live catalog + counsel review + staged enforcement flips.
**Owner:** infodensense@gmail.com
**Scope:** What it takes to turn this platform from "internal ops tool with a multi-tenant skeleton" into a sellable, self-serve B2B SaaS at industry standard.

---

## 0. Executive summary — where we actually are

This is **further along than it looks**. A prior build wave already shipped most of the *skeleton* of a multi-tenant SaaS. The gap to "sellable" is not a rewrite — it's **finishing, hardening, and wiring** what exists, plus the go-to-market funnel.

### Distribution decision (settled)
Ship as a **browser-based web app** at `app.<domain>`, marketing site separate (CycleForge repo). **No desktop app.** The value is server-side (data, integrations, workflow engine); a native shell adds cost without value. The only future-native exception is a *thin* Tauri helper for warehouse hardware the browser genuinely can't reach (label printers, scale drivers) — never the primary product, and not needed for launch.

### What already exists (verified in code)
| Capability | State | Evidence |
|---|---|---|
| Multi-tenant data model | **Built** | `organizations` table; `organization_id` on business tables; `withTenantConnection`/`tenantQuery`/`withTenantTransaction` in `src/lib/tenancy/db.ts` |
| Self-serve signup | **Built & live** | `POST /api/auth/signup` + `/signup` page → creates org + admin staff + 14-day trial + session |
| Stripe subscription *code* | **Built** | `/api/billing/checkout`, `/api/billing/portal`, `/api/billing/webhook`; `billing_subscriptions` + `stripe_events` tables |
| Plan catalog + entitlements | **Built** | `src/lib/billing/plans.ts` — 5 tiers, 11 feature flags, hard ceilings |
| Billing UI | **Built** | `/settings/billing` |
| Transactional email | **Partial** | Resend shim `src/lib/email/send.ts`; only the welcome email is wired |
| Session auth + permissions | **Built** | `usav_sid` cookie; 170+ permission registry; roles |
| Beta intake funnel | **Spec only (0% code)** | `docs/beta-intake-funnel-plan.md` |

### The blockers that actually stop a sale (in priority order)
1. **🔴 Billing is wired to products that don't exist.** Code reads `STRIPE_PRICE_STARTER/GROWTH/PRO/ENTERPRISE`; the live Stripe account (`acct_1QgG6jLvhV85DRvt`, "Densense") has **zero subscription products** — only one-time physical-goods SKUs from another line. Any "Upgrade" click returns `PRICE_NOT_CONFIGURED` (503). **Nothing can be sold until the catalog is created.**
2. **🔴 Tenant isolation has no DB backstop.** `src/lib/tenancy/db.ts` says it plainly: *"RLS isn't enforced yet."* Isolation depends entirely on every handler remembering to filter by `organization_id`. Worse, `2026-05-21_org_id_transitional_default.sql` defaults orphan rows to the **USAV org**, and `transitionalUsavOrgId()` is a live escape hatch. The first real second tenant turns any forgotten filter into a cross-tenant data leak. **This must be closed before onboarding a stranger's data.**
3. **🟠 Owner identity is PIN-only, no email verification.** PIN auth is right for the warehouse floor, wrong for a B2B *account owner*. No email verification = spam orgs; no password reset = support load; PIN-only owner login is below B2B expectation.
4. **🟠 No activation/onboarding.** New signups land in a raw dashboard with no data, no guided setup, no template seeding. Trials die at the empty state.
5. **🟠 No go-to-market funnel.** Beta funnel + pricing page + lifecycle email are unbuilt.
6. **🟡 No legal/compliance baseline.** No ToS, Privacy Policy, DPA, or cookie consent. Required to charge money and to land any business customer.

---

## 1. The eight pillars of "industry standard"

Standard B2B SaaS readiness = these eight. Current grade in brackets.

- **A. Billing that works** [code ✅ / live ❌] — real Stripe catalog, portal, webhook resilience, dunning, trial→paid enforcement.
- **B. Safe multi-tenancy** [⚠️ skeleton] — DB-enforced isolation (RLS), no transitional defaults, tenant-scoped roles.
- **C. Identity & access** [⚠️] — email verification, owner credential (magic-link/password), password reset, team invites, SSO for enterprise.
- **D. Onboarding & activation** [❌] — guided first-run, template seeding, empty states, "aha" path.
- **E. Go-to-market funnel** [❌] — marketing site, pricing page, beta funnel, trial CTA.
- **F. Lifecycle communications** [⚠️] — transactional email suite, dunning, trial-ending, receipts.
- **G. Legal & compliance** [❌] — ToS, Privacy, DPA, cookie consent, PCI (via Stripe), data export/delete.
- **H. Observability & support** [unknown] — product analytics, error monitoring, support channel, status page, SLA.

---

## 2. Phased roadmap

Phases are ordered by "what unblocks revenue and safety first." Each phase is independently shippable.

### Phase 0 — Make billing real (revenue unblock) · ~2–3 days
**Goal:** a tenant can pick a plan and pay, end to end, in test mode then live.

0.1 **Create the Stripe subscription catalog** (use Stripe MCP):
  - 4 Products: `Starter`, `Growth`, `Pro`, `Enterprise` (Enterprise = sales-assisted, no self-serve price needed but create the product for invoicing).
  - Recurring Prices for each, **monthly + annual** (annual ≈ 2 months free). Set `lookup_key` per price (e.g. `starter_monthly`) so the catalog is portable across test/live.
  - Build the catalog in **test mode first**, validate the full flow, then replicate to live.
  - Tag each price with metadata `plan: starter|growth|pro|enterprise` so `planFromPriceId()` and the webhook can resolve plan from price defensively.
0.2 **Wire env vars:** set `STRIPE_PRICE_STARTER/GROWTH/PRO/ENTERPRISE` (and annual variants if we add a billing-interval toggle) in Vercel for Preview + Production. Remember `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`.
0.3 **Register the webhook endpoint** (`/api/billing/webhook`) in Stripe → store its signing secret. Confirm it handles `customer.subscription.created|updated|deleted` and `checkout.session.completed` and is idempotent via `stripe_events`.
0.4 **Configure the Billing Portal** in Stripe (allowed actions: update payment method, cancel, switch plan, view invoices) — the `/api/billing/portal` route already mints sessions against it.
0.5 **Trial→paid enforcement:** confirm `organizations.trial_ends_at` is actually checked somewhere that gates access (today signup sets it, but nothing appears to enforce expiry). Add a trial-state gate + an in-app "trial ends in N days" banner.
0.6 **Plan-limit enforcement UX:** `plans.ts` defines ceilings (maxStaff, maxMonthlyOrders, etc.) — verify they're enforced at the mutation routes and surface a graceful "upgrade to add more" instead of a hard error.
0.7 **Test the full loop** in Stripe test mode with `4242…` card: signup → trial → upgrade → webhook mirrors to `billing_subscriptions` → entitlements flip → portal cancel → downgrade.

**Exit criteria:** a fresh test org can self-upgrade to a paid plan and the entitlement flips, verified in DB and UI.

### Phase 1 — Make multi-tenancy safe (the data-leak fix) · ~3–5 days
**Goal:** a second tenant's data is isolated even if a handler forgets to filter.

1.1 **Enable Postgres RLS** on every business table that has `organization_id`:
  - Policy: `USING (organization_id = current_setting('app.current_org', true)::uuid)` for SELECT/UPDATE/DELETE, `WITH CHECK` for INSERT.
  - The GUC plumbing already exists (`withTenantConnection` sets `app.current_org`), so this is additive — but **audit that every data path runs inside `withTenantConnection`/`tenantQuery`** first, or RLS will start throwing.
  - Use a `FORCE ROW LEVEL SECURITY` + a dedicated app DB role that is *not* the table owner, so the app can't bypass RLS.
1.2 **Kill the transitional USAV default.** Drop the `DEFAULT … USAV_ORG_ID` from `2026-05-21_org_id_transitional_default.sql` columns — replace with `NOT NULL` and let RLS/`INSERT` carry the org explicitly. Orphan rows defaulting to USAV is the single most dangerous footgun for a 2nd tenant.
1.3 **Remove `transitionalUsavOrgId()` callers.** Grep for it + any hardcoded `USAV_ORG_ID` in request paths; thread `ctx.organizationId` through instead. The `scripts/audit-route-auth.ts` audit is the gate.
1.4 **Tenant-scope roles.** `roles` is currently global. Add `organization_id` (nullable for system/global roles, set for tenant-custom roles), backfill USAV's, scope all role queries. The `permission-registry-guard` agent + `route-permission-manifest.test.ts` already gate permission changes — extend coverage.
1.5 **Cross-tenant test harness:** create two orgs in a test DB, write a spec that asserts org A cannot read/write org B's orders, serials, receiving, etc. This becomes a permanent regression gate.

**Exit criteria:** automated test proves org isolation; RLS denies cross-org access at the DB; `audit-route-auth` is green; no `transitionalUsavOrgId` in request paths.

### Phase 2 — Self-serve identity & onboarding · ~5–7 days
**Goal:** a stranger can sign up, verify, get in, and reach first value unaided.

2.1 **Email verification on signup.** Issue a verification token, gate trial features (or at least billing) behind a verified email. Stops spam orgs and is table-stakes.
2.2 **Owner credential beyond PIN.** Keep PIN for floor staff; add **magic-link (passwordless) or email+password** for the account owner/admin. Recommended: magic-link (lowest friction, no password storage). The `sso-oidc.ts` scaffold can later cover SSO; magic-link covers the gap now.
2.3 **Password/credential reset + account recovery.** Today a forgotten PIN = support ticket. Email-based recovery is mandatory.
2.4 **Team invitations.** Admin invites teammates by email → invite link → they set their PIN/credential and land scoped to the org. (Admin-create exists; the *self-serve email invite* loop does not.)
2.5 **Guided onboarding / activation:**
  - Empty-state setup checklist on first login (connect a channel, import/seed a workflow, add a teammate, do a test scan).
  - **Template seeding:** drop a reseller starter graph (the seeds from the node/operations-studio plan — "Standard refurb-and-list", "Returns triage") into a new org so the canvas isn't blank. This is the documented onboarding story; build the import.
  - Define and instrument the **activation event** ("aha" = first item moved through a workflow / first order received) so we can measure trial→active.

**Exit criteria:** a brand-new email can sign up, verify, invite a teammate, import a template, and complete the activation event with zero hand-holding.

### Phase 3 — Go-to-market funnel · ~3–5 days (parallel with 1–2)
**Goal:** demand → trial/beta, measured.

3.1 **Pricing page** on the marketing site (CycleForge) mirroring `plans.ts` tiers + the new Stripe prices. Clear CTA: "Start free trial" → `/signup`.
3.2 **Beta intake funnel** — build the spec in `docs/beta-intake-funnel-plan.md`:
  - Migration: `beta_applications` table.
  - `POST /api/beta/apply` (public, CORS from marketing site, Zod, honeypot, IP rate-limit); add `/^\/api\/beta\//` to `PUBLIC_PATHS` in `src/proxy.ts`.
  - One Stripe **Payment Link** ($50, "fully refundable, credited at signup"); v1 manual reconcile, v2 extend webhook on `checkout.session.completed` + `client_reference_id`.
  - Auto-confirmation email (code) + manual approval/rejection templates (ops doc).
3.3 **Marketing analytics:** the CycleForge repo already has PostHog + edge A/B (`cycleforge-posthog-ab`) — connect funnel events (apply, pay, approve, convert) end-to-end.
3.4 **Self-serve vs sales-led split:** Starter/Growth/Pro = self-serve checkout; Enterprise = "Contact sales" (route already returns `CONTACT_SALES`). Add a contact/demo form.

**Exit criteria:** a visitor can either start a trial or pay the $50 beta fee, and every step is tracked in PostHog.

### Phase 4 — Lifecycle, legal & operational polish · ~4–6 days
**Goal:** retain, comply, and operate like a real vendor.

4.1 **Transactional email suite** (Resend, build on `send.ts` + real `EMAIL_FROM` + verified domain):
  - Welcome (exists), email verification, magic-link, team invite, password/PIN reset.
  - Billing: receipt, trial-ending (T-3/T-1), payment-failed/dunning, subscription cancelled.
  - Use Stripe's built-in receipt + dunning emails where possible; layer product-side comms on top.
4.2 **Dunning / failed-payment flow:** on `invoice.payment_failed`, mark org `past_due`, show an in-app banner, restrict gracefully (don't hard-lock immediately), email the owner. Stripe Smart Retries handles the retries.
4.3 **Legal pages:** Terms of Service, Privacy Policy, Subscription/refund terms, **DPA** (B2B customers will ask), cookie consent banner (CycleForge already has PostHog cookie bucketing — gate it on consent). PCI scope stays minimal because Stripe Checkout/Elements never touches card data on our servers — keep it that way.
4.4 **Data rights:** per-org **data export** and **account deletion/offboarding** (soft-delete exists via `organizations.deleted_at`; add the export + hard-delete-on-request path for GDPR/CCPA).
4.5 **Observability & support:**
  - Error monitoring (Sentry or Vercel's) wired to alert on billing/webhook failures specifically.
  - Product analytics in-app (PostHog) to measure activation, feature adoption, churn signals.
  - Support channel (shared inbox / Zendesk — Zendesk integration already exists) + in-app "Contact support".
  - Status page (or at least `/api/health` + `/api/ready` already exist — expose a public status).
4.6 **Subscription edge cases:** proration on upgrade/downgrade, annual→monthly switches, seat/usage metering if any plan becomes usage-based later (Stripe metered prices).

**Exit criteria:** a paying customer who fails a payment is dunned and recovered without manual intervention; legal pages live; data export works; billing failures page someone.

---

## 3. Stripe catalog — proposed starting point

> **Pricing is a business decision — these are defaults to react to, not a recommendation to bank on.** Comps: ShipStation ($10–100+/mo), Inventory Lab ($49–69), SKULabs ($299+), Sellbrite (~$19–99+). This is an *operations platform* (heavier than a label tool), targeting small/mid resellers.

| Plan | Monthly | Annual (≈2mo free) | Ceiling highlights (from `plans.ts`) |
|---|---|---|---|
| **Starter** | $49 | $490 | 10 staff · 1k orders/mo · 1 warehouse · 3 integrations · walk-in |
| **Growth** | $149 | $1,490 | 50 staff · 10k orders/mo · 3 warehouses · 8 integrations · +FBA, repair, AI copilot, advanced roles, branding |
| **Pro** | $399 | $3,990 | 250 staff · 100k orders/mo · 10 warehouses · unlimited integrations · +automations, webhooks, audit export |
| **Enterprise** | Custom | Custom | Unlimited · +SSO, priority support · sales-assisted |
| **Trial** | Free 14d | — | 5 staff · 100 orders · 1 warehouse · 2 integrations (no FBA/repair/AI) |

Implementation notes:
- Set `lookup_key` on each Price (`starter_monthly`, `starter_annual`, …) so env wiring is stable across test/live.
- Add Price metadata `plan: <tier>` so the webhook resolves plan defensively even if env drifts.
- If we want a monthly/annual toggle in `/settings/billing`, extend `PLAN_PRICE_IDS` to hold both intervals (small change to `plans.ts`).

---

## 4. Decisions needed before execution

1. **Pricing numbers** — accept the table above or set your own per tier (monthly/annual).
2. **Mode to build first** — Stripe **test** catalog first (recommended; validate end-to-end before live) vs straight to live.
3. **Owner auth** — keep PIN-only / add **magic-link** (recommended) / add email+password.
4. **Launch motion** — lead with **self-serve trial**, the **$50 beta funnel**, or both in parallel.

---

## 5. Sequencing & effort

| Phase | What | Effort | Blocks |
|---|---|---|---|
| 0 | Stripe catalog + billing loop | 2–3 d | **Revenue** |
| 1 | RLS + isolation hardening | 3–5 d | **Safety / 2nd customer** |
| 2 | Identity + onboarding | 5–7 d | Self-serve conversion |
| 3 | GTM funnel (parallel) | 3–5 d | Demand capture |
| 4 | Lifecycle + legal + ops | 4–6 d | Retention + compliance |

**Critical path to "can sell safely":** Phase 0 → Phase 1. ~1 week of focused work makes the product *transactable* and *isolated*. Phases 2–4 make it *grow-able*.

---

## 6. Related docs & code anchors
- Billing: `src/lib/billing/plans.ts`, `src/lib/billing/stripe.ts`, `src/app/api/billing/{checkout,portal,webhook}/route.ts`, `/settings/billing`
- Tenancy: `src/lib/tenancy/db.ts`, `src/lib/tenancy/constants.ts`, `src/lib/tenancy/organizations.ts`, migrations `2026-05-2*_org_id_*`
- Signup/auth: `src/app/api/auth/signup/route.ts`, `src/lib/auth/session.ts`, `src/lib/auth/permission-registry.ts`
- Email: `src/lib/email/send.ts`
- Beta funnel: `docs/beta-intake-funnel-plan.md`
- Onboarding/templates: `docs/operations-studio/operations-studio-plan.md`, `/reseller-flow` skill
- Marketing/funnel analytics: CycleForge repo (PostHog + edge A/B)
