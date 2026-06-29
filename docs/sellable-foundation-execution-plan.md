# Sellable-Foundation — Execution Plan (decisions locked 2026-06-28)

Derived from the answered interview (`docs/sellable-foundation-execution-interview.md`). This is the plan of record. **[you]** = owner-only step an agent cannot do. Each item is tagged **NOW** (this push) / **NEXT** (right after) / **SHELVE** (deferred behind the milestone).

---

## ⭐ BUILD STATUS — 2026-06-28 (code landed this session, tsc-clean)

**Shipped (code in tree, zero new tsc errors):**
- **WS1** — `fba_fnskus` upserts flipped to `ON CONFLICT (organization_id, fnsku)` across 8 sites; `sku_catalog` flips landed via your concurrent refactor; both composite-key migrations **renamed `.sql.gated`→`.sql`** = a coordinated code+migration unit, ready for your next `db:migrate` deploy.
- **WS4.3** — feature gates: `plans.ts` flags `walkIn`/`sourcing`/`support`/`aiChat` FALSE for trial+starter, TRUE Growth+; new `plan-feature-gate.ts` + registered in `feature-gate.ts`; routes under `/api/sourcing|support|walk-in|ai` gated. Enforcement env **`PLAN_FEATURE_ENFORCED` (default OFF)**, USAV-exempt — inert until you flip it.
- **WS5.1** — `zendesk.ts` resolves creds per-org from the vault (backward-compatible optional `orgId`; non-USAV without a vault row degrades, never hits USAV's Zendesk).
- **WS5.2** — `isPoGmailAvailableForOrg()` predicate for graceful non-USAV degrade (security guard untouched).
- **WS5.3** — new `2026-06-28_org_id_shipping_tables.sql` (3 FBA label/scan tables that lacked org_id; the named shipping tables already had it) + a precise code-rewiring checklist for the `transitionalUsavOrgId()` hardcodes.
- **WS6.2** — `WorkspaceSwitcher.tsx` (multi-org switch UI over the existing `/api/auth/switch-org`); needs mounting in OrganizationSection (hot).
- **WS7.1** — PostHog wiring (`lib/analytics/posthog.ts` + provider in `layout.tsx`); no-op until `NEXT_PUBLIC_POSTHOG_KEY` set.
- **WS7.2/7.3** — `beta_waitlist` migration + `POST /api/beta/waitlist` + `GET /api/beta/spots` (CORS for marketing) + `/api/beta/` in proxy PUBLIC_PATHS.
- **WS3.1** — `POST /api/orders/import-csv` + `CsvOrderImport.tsx` (dependency-free CSV, column-map UI); needs mounting (dashboard hot).
- **Security fix** — passkey registration account-takeover closed: `staffId` now derived authoritatively from session/enrollment in `/register/finish`, cookie carries only the challenge.
- **WS1.3** — full residual-leak sweep: **47/52 critical+high genuinely exempt**; 5 real findings (1 fixed = passkey; 4 below).

**Pass 2 (2026-06-28b) — completed the hot-file + Phase-D items (all tsc-clean):**
- ✅ Mounted `CsvOrderImport` (settings/integrations) + `WorkspaceSwitcher` (OrganizationSection).
- ✅ WS2.2 role self-heal + WS6.3 email verification in signup (new `ensure-admin-role.ts`, `email-verification.ts`, `GET /api/auth/verify-email`; reuses the magic-link token pool).
- ✅ WS3.2 typed first-run empty states (new `OrdersFirstRunEmptyState`, wired into the unshipped board + labels/staged queues; first-use vs no-results branching).
- ✅ Sweep findings fixed: `webhooks/ups` now org-scopes the tracking match + writes under the shipment's org; `webhooks/square` fails CLOSED in prod when the signature key is unset; `ebay/refresh-tokens` gated to cron/service identity + cross-org names stripped from the response; `support/overview` threads `ctx.organizationId`.
- ✅ WS6.1 per-staff auth policy: migration `2026-06-28_staff_auth_policy.sql` (staff.auth_method + requires_sensitive_stepup), PIN-signin refuses password-required staff, reusable `requireSensitiveStepUp()` guard (reuses the existing step-up grant) wired into the staff-update route as the reference, admin toggle persisted in `admin/staff/update`. **UI controls skipped** (staff-management cluster hot) — exact mount documented in the agent output (per-row control in `StaffTable.tsx` + add the 2 columns to staff `list` SELECT).

- ✅ **WS6.1 staff-management UI (pass 3, 2026-06-28c):** added the "Auth" column to `StaffTable.tsx` — a PIN/Password select + a "Wall" (sensitive step-up) checkbox per staff, persisting via `/api/admin/staff/update` and surfacing `STEP_UP_REQUIRED`. The staff `list` route + `settings/staff/page.tsx` server query now return `auth_method`/`requires_sensitive_stepup` via a `to_jsonb` fallback so they're **safe before the migration applies** (missing column → 'pin'/false). tsc-clean.

**ALL pending migrations now applied to live DB (2026-06-28e) — runner reports "up to date, 0 pending".** Beyond the safe subset below, also applied + verified this pass: `g_part_links` (table + FORCE RLS; endpoints `/api/inventory/parts/links` ✓), `j_sku_catalog_add_composite_unique` (`sku_catalog_org_sku_key` ✓, code `ON CONFLICT (org,sku)` matches), `q_drop_legacy_shipment_link_tables` (dropped `receiving_shipments`/`order_shipment_links`/`shipment_orders` after owner confirmed the shipment_links cutover is DEPLOYED + the coverage guard showed 0 missing links + a grep proved zero live SQL refs to them), and `d_reason_codes_label_presentation` (added `tone`/`icon` cols — **had to fix the migration**: its flow_context CHECK omitted the existing `inventory_adjust` vocab (36 rows) and failed; I added `'inventory_adjust'` to the allow-list, then it applied).

**Migrations APPLIED to live DB (2026-06-28d, safe/additive subset only):** `staff_auth_policy` (staff columns ✓), `beta_waitlist` (table ✓), `fba_fnskus_add_composite_unique` (NEW expand — `fba_fnskus_org_fnsku_key` ✓, mirrors the user's sku expand pattern so the fba `ON CONFLICT (org,fnsku)` code is supported pre-drop), `org_id_shipping_tables` (no-op — its 3 FBA label/scan tables don't exist in the live DB; guarded-skipped). The two **contract** migrations were RE-GATED to `.sql.gated` (`sku_catalog_composite_unique`, `fba_fnskus_composite_pk`) — they are the phase-2 drops in the user's expand/contract rollout and must run only in the coordinated post-deploy step (an earlier WS1 rename to `.sql` was reverted). The standard `db:migrate` was intentionally NOT run blanket (it would also fire the user's in-flight `g_part_links` / `j_sku_catalog` / `q_drop_legacy_shipment_link_tables`, including a table-drop).

**Truly remaining — owner-only (cannot be done "in the codebase"):**
- **[you] deploy/env:** Stripe `sk_live` go-live (WS4.1); deploy the in-tree `ON CONFLICT (org,…)` code, then apply the two **contract** `.gated` migrations as the post-deploy phase-2 (with the fba PK-swap pre-flight check in its header); set `NEXT_PUBLIC_POSTHOG_KEY`; optionally flip `PLAN_FEATURE_ENFORCED=1` / `TRIAL_ENFORCEMENT`. (The expand constraints are already live, so new code is safe to deploy now.)
- **Follow-ups (non-blocking):** thread `orgId` into the Zendesk callers listed by WS5.1; remove the `transitionalUsavOrgId()` hardcodes per the WS5.3 rewiring checklist once the shipping migration applies.

---

## Milestone (locked)

Dogfood is effectively done (USAV's fulfillment Google Sheet is retired). The next milestone is **external-tenant readiness, validated by you running yourself as your own 2nd tenant** (Q1, Q5). Scope is **most of the system** — station scans + the outbound tracker, not outbound-only (Q3). **Target: aggressive / today-ish** (Q2) → we ship the critical path first and let the long-pole de-USAV work trail.

**Critical path to "I can onboard a 2nd tenant":**
1. Composite-key uniqueness on `sku_catalog` + `fba_fnskus` (Tier 1) — **the one hard isolation blocker left**.
2. The 2nd-tenant onboarding + verification checklist (`docs/second-tenant-onboarding-checklist.md`) — so you can prove it.
3. De-USAV-ification of the hardcoded-credential features (Tier 5) — so the 2nd tenant isn't silently coupled to USAV.

---

## Decision record (your 24 answers, locked)

| Q | Decision |
|---|---|
| Q1 | Milestone = external-tenant readiness (dogfood already retired the sheet). |
| Q2 | Target = today / aggressive — ship critical path first. |
| Q3 | Scope = most of the system (station scans + tracker), not outbound-only. |
| Q4 | Composite-key: do **both** (a) rehearsed runbook + (b) decouple via SELECT-then-upsert; give a **test list**. |
| Q5 | You self-test as your own 2nd tenant → **written checklist doc** (delivered). |
| Q6 | Run the adversarial sweep over the ~22 residual route exemptions. |
| Q7 | Auto role-seeding plan: proceed (add a self-heal safety net at org creation). |
| Q8 | Per-staff auth method: admin/owner can toggle **PIN vs password per staff**, with a **sensitive-information wall** (password required for staff touching sensitive data). |
| Q9 | Build **multi-org switching under Settings**. |
| Q10 | First channel = **both** — API sign-in (eBay/Amazon OAuth) **and** CSV import for products. |
| Q11 | Build the **generic CSV import lane**. |
| Q12 | Onboarding = **typed empty states first** (checklist later). |
| Q13 | USPS matters but **launch with UPS + FedEx only**; add USPS when their OAuth lands. |
| Q14 | Pricing confirmed: **Starter $49 / Growth $149 / Pro $399** monthly. |
| Q15 | **Allow a free trial for customers** (keep the 14-day trial; do not hard-lock at expiry yet). |
| Q16 | Paywall behind paid tiers: **walk-in, sourcing, support, studio, AI chat, and most admin features** (Growth/Pro). "quarters" was a typo — dropped. |
| Q17 | OK to run Stripe `sk_live` go-live with a prepared runbook. |
| Q18 | Move toward **multi-tenant readiness — no hardcoded credentials**. |
| Q19 | Add **multi-org support** to the currently USAV-locked features (Zendesk, PO-Gmail, shipping tables). |
| Q21 | Beta funnel = **after dogfood proves the product** (now satisfied; gate on milestone). |
| Q22 | Beta v1 = **lightweight waitlist** (email capture + video preview), no $50 deposit yet. |
| Q23 | **Wire PostHog** (feature-adoption telemetry from the first tenant). |
| Q24 | Make the "spots left" counter **data-driven**. |

**Clarifications resolved (2026-06-28):**
- **Trial access = Starter-only.** During the 14-day trial a tenant gets the **Starter feature set**; paid features (walk-in, sourcing, support, studio, AI chat, FBA, repair, admin) stay locked until they subscribe to Growth/Pro. So WS4.3 gates by *plan capability* regardless of trial state — `trial` and `starter` resolve to the same Starter entitlement set.
- **"quarters" = typo, dropped.** Gate only: walk-in, sourcing, support, studio, AI chat, and most admin features.

---

## Workstreams (sequenced)

### WS1 — Close the last isolation blocker · **NOW** · [agent build + you deploy]
- **W1.1** Refactor `sku_catalog` + `fba_fnskus` upserts to org-scoped `SELECT-then-upsert` so the migration is decoupled from the code flip (Q4b, lower blast radius). Sites: `src/lib/neon/sku-catalog-queries.ts` (ON CONFLICT (sku)) + the fba fnsku upserts.
- **W1.2** Then apply the gated migrations `2026-06-14_sku_catalog_composite_unique.sql.gated` + `2026-06-14_fba_fnskus_composite_pk.sql.gated` with the `ON CONFLICT (organization_id, …)` flip in the **same deploy**. **[you]** runs the prod deploy; I prep the rehearsed runbook + the test list (Q4a).
- **W1.3** Adversarial sweep over the ~22 residual "critical" route-audit hits (Q6) to confirm they're genuine exemptions; fix any real leak found.

### WS2 — 2nd-tenant onboarding + verification · **NOW** · [you test]
- **W2.1** `docs/second-tenant-onboarding-checklist.md` — delivered. You stand up a 2nd org via `/signup`, run the verification matrix (isolation, provisioning, billing, day-one value).
- **W2.2** Add the org-creation **role self-heal**: if no `admin` role exists, seed system roles inline so a fresh DB never strands a new tenant (Q7). Small, safe, idempotent.

### WS3 — Day-one value path · **NEXT** · [agent]
- **W3.1** Generic **CSV product/order import lane** (upload → column-map → org-scoped insert), since the Sheets path is USAV-locked (Q10, Q11).
- **W3.2** **Typed empty states** on the dashboard/outbound board + "Connect your first channel" CTA (Q12; `EmptyState` primitive exists). Defer the full read-time checklist.
- **W3.3** Confirm eBay/Amazon OAuth connect → sync is clean for a fresh org (already connection-driven).

### WS4 — Billing go-live + plan gating · **NEXT** · [you env + agent gates]
- **W4.1** **[you]** Stripe go-live: run `scripts/stripe/setup-webhook-and-portal.mjs --live`, set `STRIPE_WEBHOOK_SECRET` + live price ids ($49/$149/$399) + `sk_live`/`pk_live` in Vercel Prod, redeploy, smoke-test (Q14, Q17). I prep the runbook.
- **W4.2** Keep trial **non-enforcing** for now (free trial, Q15) — leave `TRIAL_ENFORCEMENT` off; revisit when you want hard cutoffs.
- **W4.3** Wire the **feature gates** behind paid tiers (Q16): walk-in, sourcing, support, studio, AI chat, admin features. `trial` + `starter` share the Starter entitlement set (trial = Starter-only); Growth/Pro unlock the gated features. Pattern = `feature:` flag in `withAuth` + `useEntitlements()` in UI (mirror the existing `studio`/`sso`/`maxIntegrations` gates). First step: add `walkIn`/`sourcing`/`support`/`aiChat` flags to `plans.ts` (some already exist) and confirm Starter tier excludes them.

### WS5 — De-USAV-ification (no hardcoded creds) · **NEXT→ongoing** · [agent]
Make these per-tenant via the `organization_integrations` vault + add org columns (Q18, Q19):
- **W5.1** **Zendesk** → per-org vault credentials (today: global env + hardcoded `usav` subdomain). Highest-value, ~1–2 days.
- **W5.2** **PO-Gmail** → per-org tokens / graceful skip for non-USAV (today: `assertUsavMailbox` hard-throws).
- **W5.3** **Shipping tables** → add `organization_id` columns; remove the `transitionalUsavOrgId()` hardcode in `shipping/track/sync-one` + `google-sheets/transfer-orders`.

### WS6 — Identity hardening · **NEXT** · [agent]
- **W6.1** **Per-staff auth toggle** (PIN vs password) + **sensitive-info wall** (Q8) — admin sets which staff must use a password to reach sensitive surfaces.
- **W6.2** **Multi-org switching under Settings** (Q9) — surface the existing `/api/auth/switch-org` membership switch in Settings → Organization.
- **W6.3** Email verification on signup (protects recovery + billing email).

### WS7 — Telemetry + beta funnel · **SHELVE until milestone hit** · [you keys + agent]
- **W7.1** Wire **PostHog** (Q23) — `NEXT_PUBLIC_POSTHOG_KEY` **[you]** + client init + feature-first-use events. Worth doing early so dogfood emits adoption data.
- **W7.2** **Lightweight beta waitlist** (Q22): email-capture table + `POST /api/beta/waitlist` (CORS for marketing) + video-preview link. No $50 deposit yet.
- **W7.3** **Data-driven spots counter** (Q24): `GET /api/beta/spots` off the waitlist count.

---

## Immediate next actions
1. **WS1.1** (decouple the composite-key upserts) — safe, on the critical path, no prod risk until the deploy step.
2. **WS2.2** (role self-heal) — tiny safety net.
3. Resolve the **two clarifications** (Q16 "quarters", Q15/Q16 trial-access line) so WS4.3 isn't built wrong.
