# NEEDS-COL classification — the 9 organization_id-less tables (Wave 2a / 6c)

Ratified 2026-07-09. Resolves the `tenant-owned-NEEDS-COL` bucket in
`docs/tenancy/org-id-coverage.generated.md` (9 tables). Verdict up front:
**zero tables get an `organization_id` column.** All 9 are the platform-level
identity/auth cluster (plus the pre-tenant waitlist) introduced by
`2026-06-20e_identity_layer_phase1.sql` and `2026-06-28_beta_waitlist.sql`.
A naive add-column would be wrong in kind, not just in effort: an **account
spans orgs** (that is the entire point of the identity layer), identity tables
are read at login **before** `app.current_org` exists (a `tenant_isolation`
policy would deadlock login — RLS-posture note in the identity migration
header, lines 21–33), and the two org-bearing members of the cluster already
carry an `org_id` FK → `organizations` that the coverage heuristic simply
doesn't see (it only looks for a column literally named `organization_id`).

## Per-table verdicts

| table | classification | evidence (DDL: `2026-06-20e_identity_layer_phase1.sql` unless noted) | action |
|---|---|---|---|
| `accounts` | platform-identity | Root of the cluster; no FKs out; `primary_email`, `password_hash`, `sso_provider/subject` — the global login identity one human uses across N orgs. Backfill maps many per-org `staff` rows to ONE account. | **Exempt with rationale.** Never add org_id — it would force one-account-per-org, un-doing the identity layer. |
| `account_emails` | platform-identity | `account_id uuid NOT NULL REFERENCES accounts ON DELETE CASCADE`; explicitly "the cross-org match key" (invite-by-email must match across orgs). | **Exempt.** Child of `accounts`; scoping rides on the account. |
| `account_identities` | platform-identity | `account_id … REFERENCES accounts ON DELETE CASCADE`; federated logins (google/microsoft/saml/oidc/password) resolved pre-org at login. | **Exempt.** |
| `account_mfa` | platform-identity | `account_id uuid PRIMARY KEY REFERENCES accounts ON DELETE CASCADE`; TOTP + recovery codes are per-human, not per-org. | **Exempt.** |
| `webauthn_credentials` | platform-identity | `account_id … REFERENCES accounts ON DELETE CASCADE`; passkeys deliberately **lifted from per-staff to per-account** (`2026-06-21_identity_passkey_backfill.sql`). | **Exempt.** Re-scoping to an org would regress the lift. |
| `auth_events` | platform-identity | `account_id uuid REFERENCES accounts ON DELETE SET NULL`; append-only auth audit whose events (`switch_org`, login/logout) are inherently cross-org. | **Exempt.** An org column would be NULL/ambiguous for exactly the interesting events. |
| `memberships` | join-table (account × org) | `account_id … REFERENCES accounts` + **`org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE`**. | **Already covered via FK.** No new column — `org_id` IS the org scope; the heuristic misses it only because the column isn't named `organization_id`. Left un-FORCEd on purpose: the workspace switcher reads it by `account_id` across orgs; the identity migration header reserves a future bespoke dual-key policy (org-scoped for admin member lists, account-scoped for the switcher). |
| `org_invitations` | join-table (email → org) | **`org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE`** + `invited_by … REFERENCES accounts`; the invitee's account may not exist yet, so it cannot be account-child-scoped. | **Already covered via FK** (`org_id`). Same dual-key-policy future as `memberships` if/when FORCEd. |
| `beta_waitlist` | platform-identity (pre-tenant) | `2026-06-28_beta_waitlist.sql` header: "INTENTIONALLY GLOBAL / ORG-LESS — DO NOT ADD organization_id OR RLS. These rows are created BEFORE any organization exists." Table `COMMENT` in the DB repeats it. | **Exempt** — already ratified at birth; this doc just registers it in the exemption list. |
| `beta_applications` | platform-identity (pre-tenant) | `2026-07-09e_beta_applications.sql` header mirrors `beta_waitlist`'s ratified posture verbatim — rows are created from the public marketing site ($50 apply funnel) before any org exists; conversion links forward via a future `converted_org_id`. Table `COMMENT` repeats it. | **Exempt at birth** — registered in `scripts/tenancy-coverage.mjs` `PLATFORM_IDENTITY` in the same change. |

## Coverage-script change (applied)

`scripts/tenancy-coverage.mjs` has a classification map (`SYSTEM_GLOBAL` map +
`REFERENCE_CANDIDATES` set feeding `classify()`); the NEEDS-COL bucket was its
fall-through for org-less tables with no tenant FK parent (the script strips
`organizations` from `fk_parents`, which is precisely why `memberships` /
`org_invitations` fell through despite their `org_id` FK). The applied change:

- Added a `PLATFORM_IDENTITY` map (table → rationale) with the 9 tables above.
- `classify()` checks it right after `SYSTEM_GLOBAL`, returning
  `'platform-identity'`.
- Summary gains `platform_identity` (JSON) and a
  `platform-identity (exempt by design)` row (markdown).

After `node scripts/tenancy-coverage.mjs` is re-run against the live DB, the
summary should read `tenant-owned, missing org_id col | 0` and
`platform-identity (exempt by design) | 9`.

## What this doc does NOT do

- **No migration is authored for 6c** — no table needs `organization_id`
  (evidence above), so there is nothing for tenant-from-birth /
  `enforce_tenant_isolation()` to do and no Drizzle model change.
- **Does not FORCE RLS on `memberships` / `org_invitations`.** That is the
  deferred dual-key-policy decision recorded in the identity migration header;
  it needs the switcher/admin read paths split first, and belongs to the
  identity workstream, not the coverage sweep.
- **Does not touch the `reference-decide` bucket** (bose_models etc.) — those
  keep their pending Phase B1 global-vs-tenant decision; their USAV-fallback
  DEFAULTs are handled separately by
  `src/lib/migrations/2026-07-09a_drop_usav_fallback_org_defaults.sql`.
