# Identity Layer — Global accounts, memberships, and org switching

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

## Next phases (not built)

1. **Account merge** — admin tool to merge same-human-across-orgs by verified
   email (folds two `accounts` into one, re-points memberships). The other half
   of the multi-org enabler alongside invitations.
3. **Federated SSO** — Google/Microsoft/SAML via `account_identities.provider`;
   backfill from `staff.sso_provider`/`sso_subject`.
4. **Session collapse** — single `sessions` table (`account_id` + swappable
   `active_org_id`/`active_staff_id`); switch without re-auth.
5. **Enterprise** — SCIM writes `memberships`. Forward-compatible with handing
   identity to WorkOS/Clerk if enterprise SSO becomes a deal-gate.
