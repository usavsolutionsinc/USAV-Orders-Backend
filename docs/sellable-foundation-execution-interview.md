# Sellable-Foundation — Execution Interview

**Purpose:** a decision interview to drive the last mile of the sellable foundation (the 6 capabilities below). Each section states the **verified current state** (checked against live code 2026‑06‑28, not the 2‑week‑old memories) and then asks the **decisions only you can make**. Answer inline (`Q1: …`) and the answers become the execution plan.

The 6 capabilities under assessment:

| # | Capability | "Done" means |
|---|---|---|
| 1 | Tenant isolation (RLS) | A 2nd org's data can never leak across the wall |
| 2 | Tenant provisioning & identity | Stand up a brand‑new empty org + owner login from scratch, no DB surgery |
| 3 | Day‑one value (tracking front door) | New org connects a channel → sees outbound orders + tracking |
| 4 | Billing & plan gating | A tenant subscribes; plan→permission + trial expiry enforced |
| 5 | De‑USAV‑ification & seeding | A non‑USAV org runs receiving→ship without USAV's Zoho/NAS/Zendesk |
| 6 | Beta funnel → first tenants + telemetry | A real external warehouse is live + trialing/paying |

---

## Tier 0 — The launch gate (answer this first; it reorders everything below)

The two memories that steer this work disagree on the **launch event**, and that single fork changes the critical path:

- `v1-tracker-tier-strategy`: **"First customer = USAV itself (dogfood). Done = the fulfillment Google Sheet is retired, ~2 weeks on the app with zero fallback."** Outbound‑only. Receiving/Zendesk/Zoho coupling doesn't matter for v1.
- The capability table in your prompt: **"onboard a stranger's org"** — which makes tenant #2 isolation + de‑USAV‑ification the gate.

These are *different products shipped in a different order*. Dogfood‑first means tiers 1/5 can stay partially coupled; external‑first means tiers 1/5 must fully close before anyone touches the product.

- **Q1.** What is the **first real milestone** you're driving to?
  - (a) **Retire USAV's fulfillment sheet on the app** (dogfood, single tenant) — recommended per your own anti‑drift anchor.
  - (b) **Onboard the first paying external tenant** (the beta funnel's converted org).
  - (c) Both, sequenced (a) → (b).
- **Q2.** What is your honest **target date / horizon** for that milestone (so I can rank ruthlessly: finish‑now vs shelve)?
- **Q3.** Scope for v1: is v1 **outbound‑only** (sold→packed→shipped+tracking+late flags), with receiving/inventory/testing/Studio explicitly deferred behind paid tiers — still the line? (Confirms whether Tier 5 below is even in scope for launch.)

---

## Tier 1 — Tenant isolation (RLS)

**Verified state (much further along than the memories say):**
- E1 keystone is **live**: `app_tenant` role (NOBYPASSRLS) exists on Neon, `TENANT_APP_DATABASE_URL` set in prod, two‑pool split active (`src/lib/db.ts`).
- **~177 tenant tables are FORCE‑enforced and verified isolating** (cross‑org probes return 0 rows). The hot core (orders, items, sku_catalog, inventory_events, fba_*, workflow engine) is included. CI guard (`scripts/tenancy-guard.ts`) passes; route audit shows critical leak routes down from 243 → ~22 (the residual are categorized preauth/cross‑org‑by‑design exemptions).
- **One true blocker remains for tenant #2:** `sku_catalog` (`UNIQUE(sku)`) and `fba_fnskus` (`PRIMARY KEY(fnsku)`) still have **global** uniqueness. Two migrations are written but **gated/unapplied** (`2026-06-14_sku_catalog_composite_unique.sql.gated`, `2026-06-14_fba_fnskus_composite_pk.sql.gated`). They must deploy *in the same release* as the `ON CONFLICT (organization_id, …)` code flip in `src/lib/neon/sku-catalog-queries.ts`, or live upserts break.
- `transitionalUsavOrgId()` still has ~38 callers — all session‑less webhooks/crons (by design until per‑org payload threading lands).

**Decisions I need:**
- **Q4.** The composite‑key fix is a **coordinated migration+code deploy on live prod** (the one risky step left for isolation). Do you want me to (a) prep the exact change set + a rehearsed runbook for you to deploy, or (b) refactor the upserts to org‑scoped SELECT‑then‑upsert first (decouples migration from code, lower blast radius, slightly more work)? Recommend (b) if any external tenant is imminent, (a) if it's just dogfood.
- **Q5.** **Hard gate to confirm:** no 2nd tenant gets provisioned until those two tables are composite‑keyed. Agreed? (If yes, this becomes a checklist precondition on Tier 2.)
- **Q6.** Are you comfortable that the ~22 residual "critical" route‑audit hits are genuinely exemptions (preauth identity + session‑less webhooks on the owner pool), or do you want a fresh adversarial sweep over them before declaring isolation "done"?

---

## Tier 2 — Tenant provisioning & identity

**Verified state:**
- `POST /api/auth/signup` works end‑to‑end in one transaction: creates org (`plan='trial'`, `trial_ends_at = now()+14d`, `billing_email` persisted), admin staff (PIN hashed), global `account` + `membership`, seeds catalog (`platforms`/`types`) and clones a system workflow template if one exists.
- Identity layer (`accounts`, `memberships`, `org_invitations`, passkeys, magic‑link email login) is **shipped**. Owner can log in via **PIN** (set at signup) or **email magic‑link**.
- **Real gaps:** (1) **roles are global and seeded by a script** (`scripts/seed-roles.mjs`) — a fresh signup's admin gets `staff.role='admin'` but may have **no `staff_roles` row**, so permissions can resolve to `'unknown'` (zero perms) until roles are seeded once per DB. (2) **No email verification** — a typo in the signup email silently breaks magic‑link/billing email. (3) Account password is `null` at signup (magic‑link is the only password‑less path). (4) No `owner_account_id` column; owner is "first admin staff." (5) Account‑merge across orgs not built.

**Decisions I need:**
- **Q7.** **Roles seeding is the one thing that can make a fresh org look broken.** Do you want me to make role seeding **automatic at org creation** (so signup self‑provisions the admin role + permissions), rather than relying on a global script? (Strongly recommend yes — it's the highest‑leverage provisioning fix.)
- **Q8.** Owner identity for a B2B buyer: is **PIN + email magic‑link acceptable for v1**, or do you want full **email+password + verification** before any external owner signs up? (PIN‑only is fine for floor staff; the question is the *owner*.) Recommend: add **email verification** (cheap, protects recovery + billing email) but keep magic‑link as the password‑less login; defer full password auth.
- **Q9.** Do you need **multi‑org owner switching** (same human owns >1 org) for the first milestone, or is single‑org‑per‑owner fine? (Account‑merge is unbuilt; building it now is only worth it if a beta applicant will run two orgs.)

---

## Tier 3 — Day‑one value (tracking front door)

**Verified state:**
- The outbound tracker (the v1 north star) is **real and tenant‑generic**: `/outbound` → `OutboundWorkspace` → `/api/orders?awaitingOnly=true`, fully org‑scoped, no USAV shape.
- **eBay + Amazon order sync is genuinely connection‑driven** (connect → `ebay_accounts`/`amazon_accounts` row → `syncConnection`/cron `runOrdersSyncAllOrgs`). Square/Ecwid connectors are registered but `sync()` is **not implemented** (Phase 2+).
- **Tracking is tenant‑generic**: UPS/FedEx poll globally, each shipment carries its own org via parent. **USPS is disabled** (waiting on OAuth creds) — affects everyone, not just new orgs.
- **Two real gaps for a fresh org:** (1) the generic **CSV/manual import lane is effectively missing** — `/api/import-orders` exists but isn't surfaced in UI, and the Google‑Sheets transfer path is **hardcoded to `transitionalUsavOrgId()`** (single‑tenant, has a TODO). (2) **No guided onboarding** — a new org lands on a blank board with no "connect your first channel" prompt. A full plan exists at `docs/onboarding-foundational-plan.md` (read‑time checklist + typed empty states) but is **unbuilt**.

**Decisions I need:**
- **Q10.** What is the **first channel a real customer connects** — eBay, Amazon, or a generic CSV/ShipStation‑style import? This decides what I harden first. (Your strategy memory says "eBay live sync + generic manual/CSV import from day one.")
- **Q11.** Do you want me to build the **generic CSV import lane** (upload → map columns → org‑scoped insert into `orders`), since the Sheets path is USAV‑locked? This is likely the single biggest "day‑one value for a stranger" unlock. Yes/no/priority.
- **Q12.** Onboarding: ship the **full read‑time checklist** (`onboarding-foundational-plan.md`, ~M effort) or just **O0 typed empty states** ("Connect your first channel" CTA, ~S effort) for the first milestone? Recommend empty‑states‑first; checklist when external tenants start.
- **Q13.** Is **USPS tracking a launch blocker**, or acceptable to ship UPS/FedEx‑only and add USPS when their OAuth lands?

---

## Tier 4 — Billing & plan gating

**Verified state:**
- The Stripe loop is **code‑complete and tenant‑safe**: checkout stamps `organization_id` on session+subscription metadata; webhook verifies HMAC signature, is idempotent (`stripe_events` + `processed_at`), derives plan via `planFromPriceId`, flips `organizations.plan`, retry‑safe (500 on handler error). `plans.ts` defines 5 tiers + ~14 feature flags + ceilings.
- **Trial enforcement is OFF by default** (`TRIAL_ENFORCEMENT` env); wired to return 402 in `withAuth` + redirect in page‑guard when on.
- **Plan→permission gating is partial:** genuinely enforced = `maxIntegrations`, `studio` (off by default), `sso`, and settings‑registry entitlements (`nasArchive`, `advancedVision`). **Not enforced** = `fba`, `repair`, `aiCopilot`, `advancedRoles`, `automations`, `customBranding`, `auditLogExport`, `maxWarehouses`, `maxMonthlyOrders` (defined in the catalog, no route checks).
- **Owner‑only go‑live (the highest revenue‑blocking gap):** run `scripts/stripe/setup-webhook-and-portal.mjs --live`, set `STRIPE_WEBHOOK_SECRET` + the 3 **live** price ids + `sk_live`/`pk_live` in Vercel Production, redeploy, smoke‑test. (Note: memory says `STRIPE_WEBHOOK_SECRET` may already be set in prod — needs reconfirming.)

**Decisions I need:**
- **Q14.** Confirm the **live pricing** you're launching with (memory has Starter $49 / Growth $149 / Pro $399 monthly; your strategy memory floated lower anchors ~$19–29 / ~$59–99 / ~$149–299). Which numbers are real for go‑live?
- **Q15.** **Trial enforcement**: flip `TRIAL_ENFORCEMENT=1` for the first external tenant (no perpetual free tier per your strategy)? And for the dogfood USAV org (which is `plan='enterprise'`, immune) — leave as is?
- **Q16.** Which **feature gates must actually be enforced before launch?** For an outbound‑only v1, the clean line is: gate **inbound/inventory/receiving, FBA, repair, Studio** behind Growth/Pro so Starter = tracker only. Do you want me to wire those gates now, or keep everything open during dogfood and gate only when external tenants arrive? (This is the "upsell ladder = switch on what exists behind a paywall" work.)
- **Q17.** Do you (the owner) want to **run the Stripe go‑live steps yourself** with a runbook I prepare, or walk through them together in a `!`‑prefixed session? (I can't run `sk_live`/Vercel auth.)

---

## Tier 5 — De‑USAV‑ification & seeding

**Verified state (ranked by how blocking each is for a non‑USAV org running receiving→ship):**
- **PO‑Gmail triage — hard‑blocks non‑USAV** (`assertUsavMailbox()` throws for any non‑USAV org; `google_oauth_tokens` is a singleton with no org column). 93 instances / 20 routes.
- **Zendesk (warranty/support) — hard‑blocks** for those features: credentials are global env vars, falling back to a hardcoded `'usav'` subdomain. Needs migration to the per‑tenant `organization_integrations` vault.
- **Shipping tables — known TODO**: several shipping tables lack `organization_id`, ship‑confirm/tracking‑sync hardcoded to `USAV_ORG_ID` (`shipping/track/sync-one/route.ts`).
- **Zoho — per‑tenant‑capable** (each org needs its own OAuth vault row; degrades gracefully if absent). **NAS — per‑org configurable** already (`organization.settings.nasStorageTargets`). **Reference data** (reason_codes global, platforms/types auto‑seeded) — fine.
- Estimated ~1 week to make the full pipeline tenant‑neutral; a 2‑day MVP exists by **skipping** PO‑Gmail + Zendesk + tracking‑sync for the first non‑USAV pilot.

**Decisions I need:**
- **Q18.** Given Tier 0: **is receiving→ship even in scope for the first milestone?** If v1 is outbound‑only/dogfood, most of Tier 5 can be *shelved* — the USAV coupling only matters when a non‑USAV org runs the inbound pipeline. Confirm so I don't burn the week prematurely.
- **Q19.** If/when a non‑USAV org does need it: which of the three hard‑couplings do you want made tenant‑neutral, and in what order — **Zendesk** (warranty), **PO‑Gmail** (PO email triage), **shipping‑table org columns**? Or is the MVP "**skip all three for the pilot, use manual PO entry + no warranty**" acceptable?
- **Q20.** For seeding a fresh org's reference data — beyond catalog/workflow, is there any USAV‑specific data (default settings, conditions, platform accounts) you consider **mandatory at org creation** that I should fold into an `ensureOrgDefaults` seeder?

---

## Tier 6 — Beta funnel → first tenants + adoption telemetry

**Verified state — almost entirely spec‑only in this repo:**
- **`beta_applications` table, `POST /api/beta/apply`, CORS for the marketing domain — none built.** The plan is solid (`docs/beta-intake-funnel-plan.md`): $50 refundable Stripe Payment Link, async approval ≤48h, ontology‑based form, pipeline waitlist→…→converted.
- Stripe/Resend plumbing exists, but **no `/api/beta/*` public path**, no payment‑link wiring, no beta email templates.
- **PostHog is NOT wired in this repo** (only a comment hook + Vercel Analytics). **No feature‑adoption instrumentation** — you can't currently see which parts of the product a tenant uses.
- The marketing site's "**7 of 20 spots left**" is hardcoded (trust risk) — needs a data‑driven `GET /api/beta/spots` or removal.

**Decisions I need:**
- **Q21.** Is the beta funnel **on the critical path for the first milestone**, or does it come *after* dogfood proves the product? (Your beta memory warns "intake without product drifts into consultancy.") Recommend: build it only once Tier 0's milestone is hit.
- **Q22.** When you do build it: do you want the **full $50‑deposit async funnel** (table + apply API + CORS + payment link + 3 email templates + spots endpoint, ~2 days), or a **lightweight waitlist capture** first (email → table, no deposit) to start collecting intent now?
- **Q23.** **Adoption telemetry** — wire **PostHog** now (so you have feature‑usage data from the very first tenant, including USAV dogfood), or defer? Recommend wiring it *before* dogfood cutover so the "which parts they adopt" signal exists from day one. Confirm `NEXT_PUBLIC_POSTHOG_KEY` is/will‑be available.
- **Q24.** The marketing "spots left" counter — make it **data‑driven** off `beta_applications`, or **remove it** until the funnel is real?

---

## How to use this

Answer the questions that matter most first — **Q1–Q3 (the launch gate) reorder everything else**. You don't need to answer all 24; even just Q1/Q2/Q3 + the per‑tier "is this in scope" questions (Q5, Q10, Q14, Q18, Q21) lets me produce a ruthlessly‑prioritized, sequenced execution plan with the finish‑now vs shelve calls made explicit.

Owner‑only steps that no agent can do (so you'll see them tagged **[you]** in the plan): Stripe `sk_live` go‑live (Q17), the composite‑key prod deploy (Q4), and any Vercel env / PostHog key provisioning.
