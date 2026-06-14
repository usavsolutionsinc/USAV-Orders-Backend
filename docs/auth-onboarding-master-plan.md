# Auth + Onboarding — Master Plan & Build Prompt

**One document, two halves.** Part I is the **plan** (strategy, current-state ground truth,
phased roadmap, the beta funnel spec). Part II is the **build prompt** (an executable,
file-anchored implementation brief). Hand Part II to a build agent; keep Part I for context,
decisions, and sequencing.

- **Status:** Plan of record · authored 2026-06-13 (merges
  `saas-commercialization-plan.md` + `beta-intake-funnel-plan.md` + the deep-scan upgrade prompt)
- **Owner:** infodensense@gmail.com
- **Use case:** Self-serve signup → email verify → guided onboarding, with the **$50
  refundable beta intake funnel as the v1 front door**.
- **Scope:** Pillar **C (Identity & access)** + Pillar **D (Onboarding & activation)** of the
  eight-pillar SaaS-readiness model, plus the **beta funnel**. Billing catalog (Phase 0) and
  RLS hardening (Phase 1) are **adjacent prerequisites** — referenced, not built here.

---
---

# PART I — THE PLAN

## 1. The one-paragraph mission

A stranger lands on the marketing site (CycleForge), applies to the beta (pays $50, fully
refundable, credited at signup), gets approved, and clicks through to a **self-serve signup**
that **verifies their email**, drops them into a **guided onboarding** that seeds their org
with a starter operations graph and walks them to first value — all without a human touching
the account. The account **owner** authenticates with **email + magic-link** (not the
warehouse PIN), **invites teammates by email**, and can **recover access** themselves. Every
state transition emits a **transactional email** and a **product-analytics event**.

## 2. Where we actually are (this is finish-and-wire, not a rewrite)

A prior wave shipped most of the *skeleton* of a multi-tenant SaaS. The eight pillars of
"industry standard," with current grade:

- **A. Billing that works** [code ✅ / live ❌] — Stripe code exists; the live catalog doesn't.
- **B. Safe multi-tenancy** [⚠️ skeleton] — `organization_id` everywhere, GUC plumbing ready,
  but **RLS not enforced**; a transitional default silently lands orphan rows under the USAV org.
- **C. Identity & access** [⚠️ PIN-only] — **this plan.** No email verification, no owner
  email credential, no password reset, no self-serve email invites.
- **D. Onboarding & activation** [❌] — **this plan.** Blank dashboard, no seeding, no trial
  enforcement.
- **E. Go-to-market funnel** [❌] — **beta funnel built here as v1**; pricing page on CycleForge.
- **F. Lifecycle communications** [⚠️] — Resend shim, only welcome + invite wired.
- **G. Legal & compliance** [❌] — ToS/Privacy/DPA/cookie consent (out of scope here).
- **H. Observability & support** [unknown] — analytics/error-monitoring (activation events here).

**Critical-path framing:** Phase 0 (Stripe catalog) → Phase 1 (RLS) makes the product
*transactable* and *isolated*. **This plan (C + D + beta) makes it *grow-able*** — a stranger
can onboard unaided. C/D can proceed in parallel with 0/1 because they touch different
surfaces (new auth/onboarding routes vs the billing catalog and DB policies).

## 3. Ground truth — what exists today (verified by deep scan, do not re-derive)

### Auth / session (built, PIN-centric)
- **Sessions:** `src/lib/auth/session.ts` — opaque server sessions in `staff_sessions`
  (cookie `usav_sid`, 32-byte hex). `createSession`/`loadSession`/`touchSession`/`revokeSession`/
  `revokeAllSessionsForStaff`. Device-kind idle/absolute windows + per-staff policy.
- **Auth context:** `src/lib/auth/withAuth.ts` → `AuthContext { user, staffId,
  organizationId, role, permissions, markAuditWritten }`. `organizationId` is read from
  `staff_sessions.organization_id` (org-switching-ready). `allowAnonymous: true` →
  `AnonymousAuthContext`.
- **Current user:** `src/lib/auth/current-user.ts` → `getCurrentUserBySid(sid)` merges roles +
  per-staff permission overrides; `admin` role short-circuits to all permissions.
- **Signup (built & live):** `src/app/api/auth/signup/route.ts` + `src/app/signup/page.tsx`.
  Public, IP-throttled (5/10min), Zod `{ companyName, slug?, fullName, email, pin }`. Creates
  org (`plan='trial'`, `trial_ends_at=now()+14d`, `status='active'`), first admin staff
  (`pin_hash`), `admin` role, mints session, best-effort welcome email + Stripe customer.
  **The collected `email` is not persisted to a queryable column and never verified.**
- **Sign-in (built, PIN-only):** `src/app/api/auth/signin/route.ts` — `{ staffId, pin }`,
  scrypt verify, shift-aware session window. `AUTH_PINLESS_SIGNIN` bypass flag exists.
- **Passkeys (built):** `src/lib/auth/webauthn.ts` + `/api/auth/passkey/*` (`staff_passkeys`).
- **SSO/OIDC (scaffold):** `src/lib/auth/sso-oidc.ts` + `/api/auth/sso/{start,callback}`,
  `organization_sso_providers` + `sso_auth_state` tables. **TODO in code:** ID-token
  signature is NOT verified (`decodeIdTokenClaimsUnsafe`); one provider per org. SSO is
  enterprise-gated via `hasFeature(orgId, 'sso')`.
- **Enrollment (built):** `/api/admin/staff/invite` issues a 14-day enrollment token →
  `/m/enroll/[token]` → `/api/auth/enroll/[token]` sets PIN, flips staff `status` to `active`.
- **Proxy gate:** `src/proxy.ts` — edge middleware, cookie-presence only (no DB).
  `PUBLIC_PATHS` allowlist + tenant subdomain extraction (`x-tenant-slug`). `AUTH_V2_ENABLED`.

### Staff / org schema (built)
- **`staff`** (`src/lib/drizzle/schema.ts` ~L38–67): `id` (serial), `name`, `role`,
  `employeeId`, `active`, `pinHash`, `pinSetAt`, `pinFailedCount`, `pinLockedUntil`,
  `status` (`active|invited|suspended|disabled`), `ssoSubject`, `ssoProvider`,
  `permissionsAdded[]`, `permissionsRemoved[]`, `organizationId` (uuid, NOT NULL).
  **❌ NO `email`, NO `email_verified`, NO `password_hash`.**
- **`organizations`** (migration `2026-05-22_organizations_tenancy.sql`): `id`, `slug`
  (unique), `name`, `plan`, `status`, `stripe_customer_id`, `stripe_subscription_id`,
  `settings` (jsonb), `trial_ends_at`, timestamps, `deleted_at`. Repo:
  `src/lib/tenancy/organizations.ts`. Settings schema `src/lib/tenancy/settings.ts` already
  carries `emailFirstSignin` + `requirePasskeyForNewStaff` flags + a `brand` object.
- **Audit:** `auth_audit` table + `audit_logs` floor in `withAuth`.

### Email (partial)
- **`src/lib/email/send.ts`** — `sendEmail` / `sendEmailBestEffort`, Resend when
  `RESEND_API_KEY` set, console fallback in dev. `EMAIL_FROM` env. **No template engine** —
  inline strings. Only 2 call sites: signup welcome, staff invite.

### Onboarding (missing)
- New org lands on `src/app/dashboard/page.tsx` raw — **no checklist, no seeding, no empty
  state guidance.** `src/app/admin/page.tsx` has 15+ tabs and no first-run wizard.
- **`trial_ends_at` is set but never enforced or surfaced** beyond a static date on
  `src/app/settings/billing/page.tsx`. No banner, no gate, no auto-downgrade.
- **No org-seeding code.** Workflow defs (`src/lib/workflow/`), station registries
  (`src/lib/stations/`, `src/lib/schemas/stations.ts`) exist but nothing seeds a new org.
  Reseller starter templates are specified in the `/reseller-flow` skill + operations-studio plan.

### Beta funnel (plan-only, 0% code)
- Fully specced (see §5). **Nothing built:** no `beta_applications` table, no
  `/api/beta/apply`, not in `PUBLIC_PATHS`. Form UI lives in the **CycleForge repo**
  (`/Users/icecube/repos/CycleForge`) — out of scope here except the API it POSTs to.

### Migrations & conventions
- SQL migrations in `src/lib/migrations/`, run via `npm run db:migrate`
  (`npm run db:migrate:dry` to preview), runner `scripts/run-pending-migrations.mjs`. Naming:
  `YYYY-MM-DD[suffix]_description.sql`. Drizzle mirror: `src/lib/drizzle/schema.ts`. Follow the
  `/db-migrate` flow. **Tenant writes must go through `withTenantConnection`/`tenantQuery`/
  `withTenantTransaction`** (`src/lib/tenancy/db.ts`) so the `app.current_org` GUC is set
  (RLS-ready). Pre-tenant tables (beta) are org-less.

## 4. The eight blockers, narrowed to this plan's responsibility

| # | Blocker | Owned by | This plan? |
|---|---|---|---|
| 1 | Billing wired to nonexistent Stripe products | Phase 0 | prerequisite |
| 2 | Tenant isolation has no DB backstop (RLS off) | Phase 1 | prerequisite |
| 3 | **Owner identity is PIN-only, no email verification** | **Part A** | ✅ |
| 4 | **No activation/onboarding; trials die at empty state** | **Part B** | ✅ |
| 5 | **No go-to-market funnel** | **Part C (beta v1)** | ✅ |
| 6 | **Lifecycle email suite incomplete** | **Part D** | ✅ |
| 7 | No legal/compliance baseline | Phase 4 | out of scope |
| 8 | Observability/support | Phase 4 | activation events only |

## 5. Beta intake funnel — full spec (the v1 front door)

**Why:** the "visual ops builder for SMB used-goods resellers" niche is open. The funnel
validates demand and harvests structured operational data **while** the product onboarding is
being built. **Async-first, no forced call** — the $50 buys a *tangible deliverable* (their
floor, mapped as a canvas graph + a 3–5 min personalized walkthrough video), not a meeting.
The optional call is offered in the approval email, not gated at application.

### The funnel
```
visitor on CycleForge
   ├── low intent ─► Waitlist (free): email + 3 picks                  → status: waitlist
   └── high intent ─► Application (~10–12 q, 3–4 min)
                        submit → POST /api/beta/apply                  → status: applied
                        → Stripe Payment Link ($50, fully refundable)
                        → paid (v1 manual reconcile; v2 webhook)        → status: paid
                        → auto-confirmation email (instant)
                        → APPROVAL email (manual, ≤48h SLA)            → status: approved
                              + their mapped floor + walkthrough video
                              + cohort spot + founding-pricing lock
                              + optional booking link
                        → (optional) call                              → status: call_booked
                        → tenant onboarding (Part A/B)                 → status: converted
                        (refunded is a valid exit from any state)      → status: refunded
```
Approval is **manual on purpose**: keeps "N spots" honest, lets us refund bad fits instantly,
and forces studying one real operation per approval (the data-gathering point). Production
cost per approval must stay ≤ ~30 min or the manual step becomes the bottleneck. Every
approval doubles as a real company's graph seeded in the template system — Part B practice.

### Application ontology (answers aggregate structurally onto workflow nodes/edges)
Business type · monthly volume band · stations run (multi) · what happens on test-fail ·
sales channels + split · current tools · what they scan today · floor team size · grading
method · the ONE workflow to fix first (free text) · "no-brainer" objection mining (free
text) · anything unusual (optional). **Waitlist** asks only: email, business type, volume
band, top pain.

### Data model — `beta_applications` (org-less; pre-tenants)
`id uuid pk` · `email` · `company_name` · `tier (waitlist|application)` · `answers jsonb` ·
`status (waitlist|applied|paid|approved|call_booked|converted|refunded|rejected)` ·
`stripe_ref` · `approval_note` · `floor_map_url` · `converted_org_id uuid` (forward-link) ·
`created_at` / `updated_at` / `status_changed_at`. No FK into tenant tables. The status column
makes the table double as the pipeline tracker — no separate CRM.

### Payments — Stripe **Payment Link** only, zero payments code
One dashboard Payment Link ($50, "fully refundable, credited at signup"), `client_reference_id`
= application id via URL. v1 reconcile manual (flip `status` to `paid`). v2 extend
`/api/billing/webhook` for `checkout.session.completed` → auto-flip. Refund promise is
operational policy; "fully refundable, any time, no questions" appears verbatim on form,
payment page, and both emails. **SLA discipline (48h, no exceptions) is the trust mechanism**
of an async funnel — if volume exceeds capacity, close applications ("cohort full") rather
than slip the SLA.

## 6. Decisions to confirm before/while building
1. **Owner credential:** magic-link only (recommended) vs magic-link **+** optional password.
2. **Email uniqueness scope:** per-org (recommended) vs global.
3. **Verification gating:** soft (verify gates billing + invites only; recommended) vs hard.
4. **Default starter template:** which reseller graph seeds — confirm vs `/reseller-flow`.
5. **Analytics transport:** in-app PostHog SDK vs thin server emitter to CycleForge's project.
6. **Launch motion:** lead with self-serve trial, the $50 beta funnel, or both in parallel.

## 7. Sequencing & effort
| Step | Part | Why | Effort |
|---|---|---|---|
| 1 | A1–A3 | Email-on-signup + verification — the headline ask, unblocks all | 1.5–2 d |
| 2 | D1–D2 | Templates needed by A3/A4 anyway; build once | 1 d |
| 3 | A4–A6 | Magic-link + reset + email invites complete owner identity | 2 d |
| 4 | B1–B3 | Seed + checklist + trial enforcement turn signups into activations | 2.5–3 d |
| 5 | C1–C6 | Beta funnel front door (parallelizable with B) | 1–1.5 d |

**Critical path to "a stranger can onboard unaided":** A1→A3→D→A4→B. Beta (C) runs in
parallel — only new public routes + one proxy line.

---
---

# PART II — THE BUILD PROMPT

Build the deliverables below in order. Each is independently shippable and gated by `tsc` +
build + `scripts/audit-route-auth.ts` (every new route registered in the permission/public
manifest) and the `route-permission-manifest.test.ts` guard. Run the `permission-registry-guard`
agent after any `src/lib/auth/**` change.

## PART A — Owner identity: email as a first-class credential
**Goal:** the owner authenticates by email (magic-link primary, password optional), not the
warehouse PIN. PIN stays for floor staff.

**A1. Schema — email + credential columns on `staff`.** Migration
`YYYY-MM-DD_staff_email_credentials.sql` + Drizzle mirror:
- `email text` — unique **per org**: `UNIQUE (organization_id, lower(email))` partial where not null.
- `email_verified_at timestamptz`.
- `password_hash text` (nullable; scrypt, reuse the existing PIN hash format/params helper
  in `src/lib/auth/`). Password is optional — magic-link is the default owner path.
- `is_owner boolean default false` (or reuse the `admin` role) to mark the billing/account
  owner for lifecycle emails. Decide and document.
- Backfill: wire the signup `email` onto the owner staff row (see A3).

**A2. One token mechanism for verify / magic-link / reset.** New table `auth_tokens`:
`id uuid pk` · `staff_id int` · `organization_id uuid` · `purpose (email_verify|magic_link|
password_reset|email_change)` · `token_hash text` (SHA-256 of token; never store raw) ·
`email text` (target) · `expires_at` · `consumed_at` · `created_at`. TTLs: verify 24h,
magic-link 15m, reset 1h. Helper `src/lib/auth/auth-tokens.ts`: `issueToken(purpose, staffId,
opts)` → returns raw token (emailed) + stores hash; `consumeToken(purpose, rawToken)` →
**atomic** `UPDATE ... WHERE consumed_at IS NULL AND expires_at > now() RETURNING` (replay-safe,
mirror the `sso_auth_state` atomic-pop).

**A3. Email verification on signup (headline ask).**
- `src/app/api/auth/signup/route.ts`: persist `email` onto the owner staff row, issue an
  `email_verify` token, send the verification email (D). Keep minting the session (don't block
  login); mark the org email-unverified and **gate billing/upgrade + teammate-invite behind
  verification, not basic dashboard access** (soft gate, avoids dead-ends).
- New `GET /api/auth/verify-email/[token]` (public, add to PUBLIC_PATHS) → consume → set
  `staff.email_verified_at = now()` → redirect `/onboarding?verified=1`.
- New `POST /api/auth/verify-email/resend` (authed self, rate-limited).
- In-app "Verify your email" banner until verified.

**A4. Magic-link sign-in for owners.**
- `POST /api/auth/magic-link/request` (public; Zod `{ email, slug? }`; IP + email rate-limit;
  honeypot). Resolve staff by `(org via slug/subdomain, lower(email))`. **Always 200** (no
  account enumeration). If matched + active, issue `magic_link` (15m) + email it.
- `GET /api/auth/magic-link/[token]` (public, PUBLIC_PATHS) → consume → `createSession`
  (deviceKind `personal`) → set `usav_sid` → redirect `defaultHomePath` (or `?next=`).
- Reuse `createSession` from `session.ts` verbatim — no parallel session format.

**A5. Password reset (only if A1 password path enabled).**
- `POST /api/auth/password/request-reset` (public, non-enumerating, rate-limited) → `password_reset`.
- `POST /api/auth/password/reset` (public, `{ token, newPassword }`) → consume → set
  `password_hash` → `revokeAllSessionsForStaff`.
- `POST /api/auth/signin/email` (public) → email + password → scrypt verify → session. Leave
  the PIN `/api/auth/signin` untouched.

**A6. Email-based teammate invites (close the self-serve loop).** Extend, don't replace, the
existing `/api/admin/staff/invite` → `/m/enroll/[token]` flow: capture the teammate's `email`
on the pending staff row; enrollment landing lets them choose PIN (floor) and/or set an email
credential (owner-style). Gate self-serve invite behind owner email verification (A3).
Idempotent: re-invite same email → re-issue token, never duplicate staff.

**Acceptance:** a new email signs up → verifies → requests a magic link → lands in-session,
zero PIN. Enumeration impossible on all public auth POSTs. `audit-route-auth` green.

## PART B — Guided onboarding & activation
**Goal:** first login is a seeded canvas + a checklist, not a blank dashboard.

**B1. Org seeding on signup.** New `src/lib/onboarding/seed-org.ts`:
`seedNewOrg(orgId, { template })` inside `withTenantTransaction(orgId, ...)` — drops a reseller
starter graph (templates from operations-studio plan / `/reseller-flow`, e.g. "Standard
refurb-and-list", "Returns triage") into the workflow/station tables + default non-admin roles
(`tech`, `packer`) + a default station layout. Idempotent (guard on a `seededAt` flag). Call
from signup after org creation (best-effort, logged; never fail signup on seed error). Store
`onboarding` in `organizations.settings` (tolerant zod bag) as `{ seededAt, checklist, dismissedAt }`.

**B2. First-run checklist UI.** New `/onboarding` route + a dismissible checklist on
`src/app/dashboard/page.tsx` while onboarding is incomplete. Steps, each linking to the real
existing surface and marking done on completion: verify email (A3) · invite a teammate (A6) ·
connect an integration (existing IntegrationsTab) · confirm a starter workflow (B1) · do a
test scan/receive (existing receiving flow). Persist in `settings.onboarding.checklist`.
Follow the `/sidebar-mode` skill (mode/route, not an ad-hoc panel); use the `onboard` skill for
empty-state polish.

**B3. Activation event + trial enforcement.** Define activation ("aha" = first unit through a
workflow / first order received). Emit it + signup/verify/invite-sent/invite-accepted/
checklist-step events to PostHog (in-app SDK or thin `src/lib/analytics/track.ts` server
emitter). Wire trial state: `getTrialState(org)` helper + "Trial ends in N days" banner; on
expiry, soft-gate mutations via the existing `requireFeature`/entitlements path
(`src/lib/billing/entitlements.ts`) rather than hard-lock. Add T-3/T-1 trial-ending email (D).

**Acceptance:** a fresh org logs in to a seeded canvas + checklist, completes steps unaided,
fires the activation event, sees a live trial countdown.

## PART C — Beta intake funnel (public API only; form lives in CycleForge)
**C1.** Migration `YYYY-MM-DD_beta_applications.sql` + Drizzle mirror per §5 (org-less, incl.
`converted_org_id`).
**C2.** `POST /api/beta/apply` — public (`allowAnonymous: true`), Zod against the §5 ontology,
honeypot, IP rate-limit (5/hour, reuse signup throttle), writes `applied`/`waitlist`, fires
auto-confirmation email (D), returns the Stripe Payment Link URL with
`client_reference_id=<application id>`. **CORS** allowlisting the CycleForge domain +
`localhost:3001`.
**C3.** Add `/^\/api\/beta\//` to `PUBLIC_PATHS` in `src/proxy.ts`.
**C4.** Stripe **Payment Link** only ($50). v1 manual reconcile; v2 extend
`/api/billing/webhook` for `checkout.session.completed` + `client_reference_id` → auto-flip.
**C5.** `GET /api/beta/spots` (public) → `approved + paid` count so CycleForge's "N of 20
spots" is data-driven, never faked.
**C6.** Converted→tenant bridge: signup accepts optional `?beta=<application_id>` → sets
`beta_applications.converted_org_id` + credits the $50.

**Acceptance:** CycleForge form POSTs cross-origin, a row lands, confirmation email fires, the
payment link carries the application id, the spots counter reflects reality.

## PART D — Transactional email suite
**D1.** Minimal template layer `src/lib/email/templates/` — typed functions returning
`{ subject, text, html }`, branding-aware (pull `settings.brand`), one shared layout wrapper,
dependency-light (string templating, not a heavy engine). Build on `send.ts`.
**D2.** Wire: `email_verify` (A3), `magic_link` (A4), `password_reset` (A5), `team_invite`
(upgrade the inline string, A6), `welcome` (migrate existing to template), `beta_confirmation`
(C2), `trial_ending` T-3/T-1 (B3). Billing receipts/dunning stay Stripe-native (out of scope).
**D3.** Verified Resend domain + real `EMAIL_FROM`; document required env (`RESEND_API_KEY`,
`EMAIL_FROM`, `NEXT_PUBLIC_APP_URL`).

**Acceptance:** every A–C flow produces a correctly-branded email; dev console shows them when
`RESEND_API_KEY` is unset.

## Cross-cutting requirements (every new route)
1. **Public-POST security:** Zod validation, honeypot, IP (+ email) rate-limiting,
   **non-enumerating responses** (always 200 on magic-link/reset requests), tokens **hashed +
   single-use + short-TTL + atomic consume**. CORS only where cross-origin is required (beta).
2. **Audit + manifest:** register routes so `audit-route-auth` passes; add only genuinely
   public routes to `PUBLIC_PATHS`; everything else flows through `withAuth`.
3. **Tenancy:** org-scoped writes via `withTenantConnection`/`tenantQuery`/
   `withTenantTransaction`. Never import `USAV_ORG_ID`/`transitionalUsavOrgId()` in new code;
   resolve org from `ctx.organizationId` or `x-tenant-slug`/`?slug=` for public routes.
4. **Session reuse:** all new sign-in paths call the existing `createSession` + set `usav_sid`.
5. **Reuse SoTs:** button primitive, design-system tokens, `/sidebar-mode` for page features,
   `onboard` skill for first-run UX.
6. **No secrets client-side.** If you touch SSO, close the `decodeIdTokenClaimsUnsafe` TODO
   with `jose` JWKS verification — otherwise leave SSO out of scope.

## Anchor index (files to read/touch)
- **Signup:** `src/app/api/auth/signup/route.ts`, `src/app/signup/page.tsx`
- **Sign-in:** `src/app/api/auth/signin/route.ts` (PIN — leave intact), new `…/signin/email`
- **Session:** `src/lib/auth/session.ts` (reuse `createSession`/`revokeAllSessionsForStaff`)
- **Auth ctx:** `src/lib/auth/withAuth.ts`, `src/lib/auth/current-user.ts`
- **New auth:** `src/lib/auth/auth-tokens.ts`, `src/app/api/auth/{verify-email,magic-link,password}/…`
- **Enrollment/invite:** `src/app/api/admin/staff/invite/route.ts`, `/api/auth/enroll/[token]`, `/m/enroll/[token]`
- **Schema:** `src/lib/drizzle/schema.ts` (staff ~L38–67), migrations `src/lib/migrations/`
- **Org/tenancy:** `src/lib/tenancy/{db,organizations,settings,constants}.ts`,
  `migrations/2026-05-22_organizations_tenancy.sql`
- **Billing/entitlements (trial gate):** `src/lib/billing/{plans,entitlements}.ts`,
  `src/app/api/billing/webhook/route.ts` (extend for C4 v2)
- **Email:** `src/lib/email/send.ts`, new `src/lib/email/templates/`
- **Onboarding (new):** `src/lib/onboarding/seed-org.ts`, `/onboarding` route, dashboard checklist
- **Proxy:** `src/proxy.ts` (`PUBLIC_PATHS`)
- **Beta (new):** `migrations/…_beta_applications.sql`, `src/app/api/beta/{apply,spots}/route.ts`
- **Guards:** `scripts/audit-route-auth.ts`, `src/lib/auth/route-permission-manifest.test.ts`
- **Skills:** `/sidebar-mode`, `onboard`, `/db-migrate`, `/reseller-flow`
- **Superseded source docs (kept for history):** `docs/saas-commercialization-plan.md` (full
  8-pillar roadmap incl. Phases 0/1/4 not in this plan), `docs/beta-intake-funnel-plan.md`
  (landing-page + ops-deliverable detail).
