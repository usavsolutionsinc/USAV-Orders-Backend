# Identity Layer — Global accounts, memberships, and org switching

> **CORE DONE (~90%) — Phases 1, 2, 2b, 2c COMPLETE; Federated SSO substantially built (OIDC PKCE); account merge DONE; session-collapse groundwork built (additive).**
> Status updated 2026-06-29. Both new migrations APPLIED (db ledger 0 pending) — account merge is now FULLY FUNCTIONAL. Remaining: session-collapse CUTOVER (columns live but unused; needs run-the-app auth-flow verification), SSO-storage reconcile (design-decision), deferred SCIM.

Status: **Phases 1, 2, 2b, 2c shipped (additive, non-breaking)**. Migrations APPLIED
(`2026-06-20e_identity_layer_phase1.sql`, `2026-06-21_identity_passkey_backfill.sql`)
— backfill verified: 14 staff → 14 accounts + 14 memberships, all linked. The
consolidated baseline `0000_baseline_through_2026-03.sql` was recorded as applied
WITHOUT executing (its content already exists on this DB under the original 72
per-file migration records).

## Why

`staff` rows are bound to exactly one `organization_id`, identified by numeric
`id`, with no global identity and no membership table. So one human cannot belong
to multiple orgs, and there is no way to switch workspaces. This blocks the
multi-tenant SaaS story (agencies, support access, owners running >1 shop).

## The model: three layers

| Layer | Table(s) | Question | Org-scoped? | RLS? |
| --- | --- | --- | --- | --- |
| **Identity** | `accounts`, `account_emails`, `account_identities`, `webauthn_credentials`, `account_mfa`, `auth_events` | *Who is this human?* | No — global | **No** (read before org context exists) |
| **Membership** | `memberships`, `org_invitations` | *Which orgs may they act in, and as what?* | Yes | Opt-in later (see below) |
| **Profile** | `staff` (existing) | *Their operational seat in one org* (pin/color/role/station) | Yes | Existing |

Key reframe: **`staff` is already the membership/profile row.** We did not add a
junction *under* staff — we added a global identity *above* it. `staff.id` stays
the org-scoped actor, so **every existing `staff.id` foreign key is untouched.**

## Schema (migration `2026-06-20e_identity_layer_phase1.sql`)

- New identity tables (global) + `memberships` + `org_invitations`.
- `staff` gains nullable `account_id` + `membership_id`.
- Backfill: one `account` + one `membership` per existing `staff` row (each staff
  becomes its own account; admins merge same-human-across-orgs later by verified
  email — that merge is what lights up multi-org switching).
- Drizzle definitions in `src/lib/drizzle/schema.ts`.

### RLS posture (important)

Identity tables are **global** and carry **no `tenant_isolation` policy** — they
are queried at login *before* `app.current_org` is set; policing them would
deadlock auth. `memberships` has `org_id` but the switcher reads it by
`account_id` **across** orgs, so it is intentionally **left un-FORCED** in Phase 1
and access is enforced in `src/lib/identity/*`. When the non-BYPASSRLS
`app_tenant` role goes live (Phase E1), conditional `GRANT`s at the bottom of the
migration give it table privileges. This matches the opt-in, per-table rollout in
`2026-06-14_rls_enforcement_infra.sql`.

## Authentication vs. active-org context

- **Auth session** = "this browser is account X" (survives org switches).
- **Active-org context** = "currently acting in org Y as staff Z" (swappable).

Today `staff_sessions` conflates both. Phase 1 does **not** change the session
table: switching org = mint a new session pointed at the account's staff profile
in the target org (its `organization_id` follows automatically). The placeholder
`staff_sessions.organization_id` column becomes a denormalized convenience, not
the switch mechanism. A later phase may collapse to one `sessions` table with
`account_id` + swappable `active_org_id`/`active_staff_id` (no re-auth on switch).

## What Phase 1 shipped

| Area | File |
| --- | --- |
| Migration (tables + backfill + grants) | `src/lib/migrations/2026-06-20e_identity_layer_phase1.sql` |
| Drizzle schema | `src/lib/drizzle/schema.ts` (accounts…orgInvitations + staff cols) |
| Shared type | `src/lib/identity/types.ts` (`OrgMembership`) |
| Membership resolvers (best-effort, never throw) | `src/lib/identity/memberships.ts` |
| Auth envelope exposes `memberships[]` | `src/app/api/auth/session/route.ts`, `src/lib/auth/server-session.ts` |
| Client type | `src/contexts/AuthContext.tsx` (`AuthSessionUser.memberships`) |
| Switch endpoint | `src/app/api/auth/switch-org/route.ts` |
| Switcher UI | `src/components/settings/sections/OrganizationSection.tsx` |

**Safety:** every new query is wrapped so it cannot break the live auth path
before the migration runs. `resolveEnvelopeMemberships()` always returns ≥1 entry
(falls back to a synthesized current-org membership), so the switcher shows just
the current workspace pre-migration and lights up extra rows post-merge.

## To apply Phase 1

```bash
npm run db:migrate:dry   # confirm 2026-06-20e_… is the only pending file
npm run db:migrate
```

Then regenerate Drizzle types if you use them: `npm run db:generate`.

## What Phase 2 shipped (account login + invitations)

| Area | File |
| --- | --- |
| Account password hashing (scrypt, same scheme as PINs) | `src/lib/identity/password.ts` |
| Account + verified-email data access | `src/lib/identity/accounts.ts` |
| Invitation lifecycle (create/list/revoke/preview/**accept** — atomic account→membership→staff) | `src/lib/identity/invitations.ts` |
| Admin: create + list invitations (`admin.manage_staff`) | `src/app/api/org/invitations/route.ts` |
| Admin: revoke invitation | `src/app/api/org/invitations/[id]/route.ts` |
| Public: preview + accept (auto sign-in) | `src/app/api/auth/invitation/accept/route.ts` |
| Public: account email+password sign-in (cross-org, org-pick when >1) | `src/app/api/auth/account/signin/route.ts` |
| Public accept page | `src/app/invite/[token]/page.tsx` |
| Public path allowlist (`/invite/…`) | `src/proxy.ts` + `src/contexts/AuthContext.tsx` |
| Admin UI: invite form + pending list + revoke (Settings → Organization, `admin.manage_staff`) | `src/components/settings/sections/OrganizationSection.tsx` |

Notes / deliberate scope:
- **Additive only** — the existing org-scoped PIN/station sign-in
  (`/api/auth/signin`), staff enrollment, and `staff_passkeys` are untouched.
- Invitation tokens are 24-byte base64url; only their **sha256 hash** is stored.
- Accept is **transactional** (`withTenantTransaction`) and **idempotent on
  re-accept** (reuses an existing membership/profile); a double-accept race is
  rejected by an atomic `accepted_at` claim.
- Account sign-in returns `{ needsOrgChoice, memberships }` when an account
  belongs to >1 org, then signs into the chosen one on the second POST.
- Existing accounts keep their own credentials; accepting an invite for an
  already-known email just adds the membership (does not reset the password).

## What Phase 2b shipped (account passkeys + account sign-in page)

| Area | File |
| --- | --- |
| Account-keyed WebAuthn lib (base64url text in `webauthn_credentials`) | `src/lib/identity/webauthn-account.ts` |
| Register passkey (begin/finish, authenticated) | `src/app/api/auth/account/passkey/register/{begin,finish}/route.ts` |
| Passwordless login (begin/finish, public, discoverable) | `src/app/api/auth/account/passkey/authenticate/{begin,finish}/route.ts` |
| "Add an account passkey" card | `src/components/settings/sections/SecuritySection.tsx` |
| **Account sign-in page** (email/password + workspace picker + passkey) | `src/app/account/signin/page.tsx` |
| Public path (`/account/signin`) | `src/proxy.ts` + `src/contexts/AuthContext.tsx` |

Notes:
- Reuses `getRpFromRequest()` from the staff WebAuthn lib; a **separate** challenge
  cookie (`usav_acct_wac`) so it never collides with the staff passkey flow.
- Credentials are **discoverable/resident** (usernameless): the chosen passkey
  resolves to its account, then membership resolution picks the workspace.
- The passkey challenge is single-use, so login can't pause for an org picker —
  it signs into `organizationId` if supplied else the first membership; the user
  switches from Settings → Organization. (Password login still offers the
  in-line `needsOrgChoice` picker.)
- `/account/signin` also gives the Phase 2 email/password API its first UI.

## What Phase 2c shipped (passkey backfill + management)

| Area | File |
| --- | --- |
| Backfill `staff_passkeys` → `webauthn_credentials` (bytea→base64url, idempotent) | `src/lib/migrations/2026-06-21_identity_passkey_backfill.sql` |
| List + delete account passkeys (lib) | `src/lib/identity/webauthn-account.ts` |
| GET list / DELETE remove (authenticated, account-scoped) | `src/app/api/auth/account/passkey/route.ts` + `[id]/route.ts` |
| Manage list + remove in Settings → Security | `src/components/settings/sections/SecuritySection.tsx` |

## Next phases

1. **Account merge** — [x] **DONE 2026-06-29.** Admin tool to merge
   same-human-across-orgs by verified email — folds a duplicate `account` into a
   survivor, re-pointing all four account-owned relations (memberships, staff
   profiles, `account_identities`, passkeys) in ONE `withTenantTransaction`,
   idempotent on re-run, guarded by the verified-email same-human gate, and
   soft-marking the merged account (`status='merged'` + `merged_into`/`merged_at`
   — never hard-deleted, so the audit trail survives). The other half of the
   multi-org enabler alongside invitations. See "Account merge — as built" below.
3. **Federated SSO** — [x] **SUBSTANTIALLY BUILT — DONE 2026-06-28.** OIDC PKCE
   start + callback shipped at `src/app/api/auth/sso/*`, with `account_identities`
   find/link helpers. As-built, the provider subject is stored on
   `staff.sso_provider`/`sso_subject` (NOT yet `account_identities` as originally
   intended) — see the SSO-storage reconcile design decision in the handoff below.
   SAML and the `account_identities` backfill remain open.
4. **Session collapse** — [~] **GROUNDWORK BUILT (additive) 2026-06-29; cutover
   NEEDS INTEGRATION VERIFICATION.** Single session model with swappable
   `active_org_id`/`active_staff_id` (switch without re-auth). See "Session
   collapse — groundwork" below.
5. **Enterprise** — **DEFERRED-BY-DESIGN.** SCIM writes `memberships`. Deferred
   until enterprise SSO is a deal-gate (or hand identity to WorkOS/Clerk).
   Forward-compatible either way.

## Account merge — as built (2026-06-29)

| Area | File |
| --- | --- |
| Fold logic (`mergeAccounts`, `AccountMergeError`, Deps-injected) | `src/lib/identity/accounts.ts` |
| Soft-merge columns migration (`accounts.merged_into` + `merged_at`) | `src/lib/migrations/2026-06-29_accounts_merge_columns.sql` **(APPLIED — verified 2026-06-29, 0 pending)** |
| Admin route (`POST /api/org/accounts/merge`, `admin.manage_staff`) | `src/app/api/org/accounts/merge/route.ts` |
| DB-free unit tests (re-points 4 relations, email-gate, idempotent, guards) | `src/lib/identity/accounts.test.ts` |

Notes / deliberate scope:
- **Atomic + idempotent.** The whole fold runs in one `withTenantTransaction`
  (the org just scopes the tx envelope — identity tables are global). Re-running
  after a fold returns `{ idempotent: true }` with zero re-points; re-folding
  into a *different* survivor errors (`MERGED_INTO_OTHER`).
- **Same-human gate (the plan's "merge by verified email" precondition).** Both
  accounts must each carry ≥1 **verified** email and must **share** a verified
  email (case-insensitive); otherwise the merge refuses. Conservative by design —
  absent a confirmed match it would rather refuse than fold two real humans.
  (`account_emails` has a global unique index on `lower(email)`, so the shared
  verified email is established by the admin reconciliation step that precedes the
  call.)
- **Membership overlap is handled.** Where the survivor already belongs to an org
  the merged account is also in, the duplicate membership is retired
  (`status='removed'`) instead of re-pointed, so `UNIQUE(account_id, org_id)`
  can't trip.
- **Soft, audited.** The merged account is marked `status='merged'` with
  `merged_into`/`merged_at` (never hard-deleted); the route writes the
  `account.merge` audit floor row (reusing the freeform-string convention already
  used by `org.invitation.create`, anchored on the survivor, with merged id +
  re-point counts in metadata). Permission reuses `admin.manage_staff`.
- **Migration APPLIED (verified 2026-06-29, 0 pending)** —
  `2026-06-29_accounts_merge_columns.sql` is live; the helper reads/writes
  `accounts.merged_into`/`merged_at`. Account merge is now FULLY FUNCTIONAL
  (columns live, `mergeAccounts()` + `POST /api/org/accounts/merge` shipped and
  tested). ✅

## Session collapse — groundwork (2026-06-29, additive)

| Area | File |
| --- | --- |
| Nullable `active_org_id` + `active_staff_id` on `staff_sessions` | `src/lib/migrations/2026-06-29_sessions_active_context_columns.sql` **(APPLIED — verified 2026-06-29, 0 pending; columns live but additive/unused)** |
| `switchActiveContext()` — re-point session pointers in one tx (Deps-injected, **currently UNUSED**) | `src/lib/identity/sessions.ts` |
| DB-free unit tests | `src/lib/identity/sessions.test.ts` |

What shipped is **additive only**: new nullable columns (now APPLIED — verified
2026-06-29, 0 pending, but unused) + a new, unwired helper that updates them. The
live org-switch path is **unchanged** — it still mints a
NEW session pointed at the target org's staff profile
(`src/app/api/auth/switch-org/route.ts`), and `server-session.ts` does not yet
read the new pointers.

> **⚠️ FULL CUTOVER NEEDS INTEGRATION VERIFICATION BEFORE DEPLOY.** The cutover —
> re-pointing `src/lib/auth/server-session.ts` and *every* server-session
> consumer to read `active_org_id`/`active_staff_id`, then dropping the re-mint
> in `switch-org` in favor of `switchActiveContext()` — is **built-ready** but
> MUST be verified by running the app through the full auth matrix
> (sign-in / PIN / passkey / switch-org) first. server-session authenticates
> every request; a blind cutover risks an auth outage that cannot be caught
> without running the app. Do **not** wire `switchActiveContext()` into the live
> flow until that verification is done.

## Session 2026-06-28 — completion pass

- No code changes — doc-only status reconciliation.
- Corrected the stale "Federated SSO (not built)" entry: SSO is substantially
  built (OIDC PKCE start + callback at `src/app/api/auth/sso/*`, `account_identities`
  find/link helpers), with subject stored on `staff.sso_provider`/`sso_subject` as-built.
- Marked Phases 1, 2, 2b, 2c COMPLETE and recorded final status CORE DONE (80%).

## Session 2026-06-29 — account merge + session-collapse groundwork

- **Account merge — DONE (built fully).** `mergeAccounts()` fold logic +
  `POST /api/org/accounts/merge` admin route + soft-merge migration + DB-free
  unit tests. See "Account merge — as built" above.
- **Session collapse — groundwork built (additive).** Nullable
  `active_org_id`/`active_staff_id` columns (authored, not applied) +
  `switchActiveContext()` (Deps-injected, currently unused) + unit tests. Full
  cutover off the re-mint flow is built-ready but flagged **needs integration
  verification before deploy**. See "Session collapse — groundwork" above.
- **No live auth path changed.** Everything is additive; existing sign-in / PIN /
  passkey / switch-org behavior is preserved.
- Migrations APPLIED (verified 2026-06-29, db ledger 0 pending):
  `2026-06-29_accounts_merge_columns.sql`,
  `2026-06-29_sessions_active_context_columns.sql`.
- Migration status verified 2026-06-29 (db ledger 0 pending): both new
  migrations applied — account-merge columns live (account merge FULLY
  FUNCTIONAL ✅); session active-context columns live but additive/unused
  (cutover still flagged needs-integration-verification).

## Remaining work — handoff (updated 2026-06-29)

- **[DONE 2026-06-29] Account merge** — FULLY FUNCTIONAL (see above). Migration
  `2026-06-29_accounts_merge_columns.sql` APPLIED (verified 2026-06-29, 0
  pending); `mergeAccounts()` + `POST /api/org/accounts/merge` shipped and
  tested. ✅ Remaining: surface the merge in admin UI (Settings → Organization)
  if a UI entry point is wanted.
- **[NEEDS-INTEGRATION-VERIFICATION] Session collapse cutover** — groundwork is
  in and `2026-06-29_sessions_active_context_columns.sql` is APPLIED (verified
  2026-06-29, 0 pending; columns live but additive/unused); the cutover (re-point `server-session.ts` + consumers to the new pointers,
  drop the re-mint) requires the full run-the-app auth-flow verification before
  it replaces the live path (see the warning in "Session collapse — groundwork").
- **[DESIGN-DECISION] Reconcile SSO storage** — choose between as-built
  `staff.sso_provider`/`sso_subject` and the planned `account_identities`, then
  backfill accordingly. Next step: pick the SoT and write the backfill plan.
- **[DEFERRED-BY-DESIGN] Enterprise SCIM** — SCIM writes `memberships`; deferred
  until enterprise SSO is a deal-gate (or hand identity to WorkOS/Clerk).
