/**
 * Identity-layer data access: global accounts + verified emails.
 *
 * These power account-level (email + password) login and the invitation accept
 * flow. Unlike memberships.ts (hot session path, best-effort) these run in
 * explicit auth flows, so they surface real errors to their callers.
 *
 * Functions accept an optional executor (the live pool by default, or a
 * transaction client) so the invitation accept flow can run account + email +
 * membership + staff creation atomically.
 *
 * See docs/identity-layer-plan.md.
 */

import type { Pool, PoolClient } from 'pg';
import pool from '@/lib/db';
import { withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { hashPassword } from './password';

type Executor = Pool | PoolClient;

export interface AccountRecord {
  id: string;
  displayName: string | null;
  passwordHash: string | null;
  status: string;
}

/** Resolve an active account by any of its verified emails (case-insensitive). */
export async function getAccountByEmail(
  email: string,
  db: Executor = pool,
): Promise<AccountRecord | null> {
  const r = await db.query<{
    id: string;
    display_name: string | null;
    password_hash: string | null;
    status: string;
  }>(
    `SELECT a.id, a.display_name, a.password_hash, a.status
       FROM accounts a
       JOIN account_emails e ON e.account_id = a.id
      WHERE lower(e.email) = lower($1)
        AND a.deleted_at IS NULL
      LIMIT 1`,
    [email],
  );
  const row = r.rows[0];
  if (!row) return null;
  return { id: row.id, displayName: row.display_name, passwordHash: row.password_hash, status: row.status };
}

/**
 * Create a new global account with an (optional) verified primary email and
 * optional password. Caller should run this inside a transaction when chaining
 * with membership/staff creation. Returns the new account id.
 *
 * `email` is optional so federated logins (OIDC SSO) that don't return an email
 * claim can still get a first-class account; when present it is recorded as a
 * verified email (the IdP / invite link is the verification) and becomes the
 * cross-org match key. `password` is optional so PIN/SSO-only owners get a
 * null-password account they log into via PIN or their IdP.
 */
export async function createAccount(
  input: { displayName: string; email?: string | null; password?: string | null },
  db: Executor = pool,
): Promise<string> {
  const passwordHash = input.password ? await hashPassword(input.password) : null;
  const email = input.email ? input.email.toLowerCase() : null;
  const acc = await db.query<{ id: string }>(
    `INSERT INTO accounts (display_name, primary_email, password_hash, status)
     VALUES ($1, $2, $3, 'active')
     RETURNING id`,
    [input.displayName, email, passwordHash],
  );
  const accountId = acc.rows[0]!.id;
  if (email) {
    await db.query(
      `INSERT INTO account_emails (account_id, email, verified_at)
       VALUES ($1, $2, now())
       ON CONFLICT (lower(email)) DO NOTHING`,
      [accountId, email],
    );
  }
  return accountId;
}

/**
 * Resolve an account by a federated login identity (provider + stable subject).
 * This is the authoritative match key for SSO — an IdP `sub` is stable even when
 * the user's email changes. Returns null when no identity is linked yet.
 */
export async function getAccountIdByIdentity(
  provider: string,
  subject: string,
  db: Executor = pool,
): Promise<string | null> {
  const r = await db.query<{ account_id: string }>(
    `SELECT account_id FROM account_identities WHERE provider = $1 AND subject = $2 LIMIT 1`,
    [provider, subject],
  );
  return r.rows[0]?.account_id ?? null;
}

/**
 * Link a federated login (provider + subject) to an account. Idempotent via the
 * UNIQUE(provider, subject) constraint — a repeat sign-in is a no-op.
 */
export async function linkAccountIdentity(
  input: { accountId: string; provider: string; subject: string; emailAtLink?: string | null },
  db: Executor = pool,
): Promise<void> {
  await db.query(
    `INSERT INTO account_identities (account_id, provider, subject, email_at_link)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (provider, subject) DO NOTHING`,
    [input.accountId, input.provider, input.subject, input.emailAtLink ?? null],
  );
}

/** Set/replace an account's password. */
export async function setAccountPassword(
  accountId: string,
  password: string,
  db: Executor = pool,
): Promise<void> {
  const hash = await hashPassword(password);
  await db.query(
    `UPDATE accounts SET password_hash = $2, updated_at = now() WHERE id = $1`,
    [accountId, hash],
  );
}

/** Add a verified email to an existing account (idempotent). */
export async function addVerifiedEmail(
  accountId: string,
  email: string,
  db: Executor = pool,
): Promise<void> {
  await db.query(
    `INSERT INTO account_emails (account_id, email, verified_at)
     VALUES ($1, $2, now())
     ON CONFLICT (lower(email)) DO NOTHING`,
    [accountId, email],
  );
}

// ── Account merge (fold a duplicate account into a survivor) ─────────────────
//
// The other half of the multi-org enabler alongside invitations: when the same
// human was provisioned as two distinct accounts (e.g. the Phase-1 backfill made
// each per-org staff its own account), an admin folds the duplicate (`merged`)
// into a `survivor`. We re-point the four account-owned relations — memberships,
// staff profiles, federated identities, and passkeys — onto the survivor, then
// mark the merged account `merged` (soft, with `merged_into`/`merged_at`) so the
// audit trail survives. Never hard-deletes.
//
// PRECONDITION (the plan's "merge by verified email"): both accounts must each
// carry at least one VERIFIED email and the two accounts must share a verified
// email (case-insensitive). This is the conservative same-human gate; absent a
// confirmed match the merge refuses rather than risk folding two real humans.
//
// IDEMPOTENT: a second run is a no-op — once `merged.merged_into === survivor`
// the function returns `{ idempotent: true }` with zero re-points. (If the
// merged account was already folded into a DIFFERENT survivor it errors, since
// silently re-folding would corrupt the first merge.)
//
// Deps-injected so the fold logic unit-tests with zero DB. See accounts.merge
// tests in src/lib/identity/accounts.test.ts.

export type AccountMergeErrorCode =
  | 'SAME_ACCOUNT'
  | 'SURVIVOR_NOT_FOUND'
  | 'MERGED_NOT_FOUND'
  | 'SURVIVOR_INACTIVE'
  | 'MERGED_INTO_OTHER'
  | 'SURVIVOR_NO_VERIFIED_EMAIL'
  | 'MERGED_NO_VERIFIED_EMAIL'
  | 'EMAIL_MISMATCH';

export class AccountMergeError extends Error {
  constructor(public readonly code: AccountMergeErrorCode) {
    super(code);
    this.name = 'AccountMergeError';
  }
}

/** Minimal snapshot of an account for the merge guard + idempotency check. */
export interface MergeAccountSnapshot {
  id: string;
  status: string;
  deletedAt: string | null;
  mergedInto: string | null;
}

interface MergeAccountsResult {
  survivorAccountId: string;
  mergedAccountId: string;
  /** True when the merge had already happened (re-run was a no-op). */
  idempotent: boolean;
  repointed: {
    memberships: number;
    staff: number;
    identities: number;
    passkeys: number;
  };
}

/**
 * Collaborators for {@link mergeAccounts}. Defaults hit the live pool inside a
 * single `withTenantTransaction`; unit tests pass fakes that capture calls.
 */
export interface MergeAccountsDeps {
  loadAccount(id: string, db: Executor): Promise<MergeAccountSnapshot | null>;
  /** Verified emails (lowercased) for an account — drives the same-human gate. */
  listVerifiedEmails(id: string, db: Executor): Promise<string[]>;
  /** Re-point non-conflicting memberships; retire (status='removed') the org
   *  overlaps the survivor already belongs to. Returns rows moved to survivor. */
  repointMemberships(fromId: string, toId: string, db: Executor): Promise<number>;
  repointStaff(fromId: string, toId: string, db: Executor): Promise<number>;
  repointIdentities(fromId: string, toId: string, db: Executor): Promise<number>;
  repointPasskeys(fromId: string, toId: string, db: Executor): Promise<number>;
  /** Soft-mark the merged account folded into the survivor. */
  markMerged(mergedId: string, survivorId: string, db: Executor): Promise<void>;
  /** Run the whole fold atomically (sets app.current_org for the envelope). */
  transaction<T>(orgId: OrgId, fn: (db: Executor) => Promise<T>): Promise<T>;
}

const defaultMergeAccountsDeps: MergeAccountsDeps = {
  async loadAccount(id, db) {
    const r = await db.query<{
      id: string; status: string; deleted_at: string | null; merged_into: string | null;
    }>(
      `SELECT id, status, deleted_at, merged_into FROM accounts WHERE id = $1 LIMIT 1`,
      [id],
    );
    const row = r.rows[0];
    return row
      ? { id: row.id, status: row.status, deletedAt: row.deleted_at, mergedInto: row.merged_into }
      : null;
  },
  async listVerifiedEmails(id, db) {
    const r = await db.query<{ email: string }>(
      `SELECT lower(email) AS email FROM account_emails
        WHERE account_id = $1 AND verified_at IS NOT NULL`,
      [id],
    );
    return r.rows.map((row) => row.email);
  },
  async repointMemberships(fromId, toId, db) {
    // Retire org overlaps first (survivor already a member) so the move below
    // can't trip UNIQUE(account_id, org_id).
    await db.query(
      `UPDATE memberships m SET status = 'removed'
        WHERE m.account_id = $1
          AND EXISTS (SELECT 1 FROM memberships s
                       WHERE s.account_id = $2 AND s.org_id = m.org_id)`,
      [fromId, toId],
    );
    const moved = await db.query(
      `UPDATE memberships m SET account_id = $2
        WHERE m.account_id = $1
          AND NOT EXISTS (SELECT 1 FROM memberships s
                           WHERE s.account_id = $2 AND s.org_id = m.org_id)`,
      [fromId, toId],
    );
    return moved.rowCount ?? 0;
  },
  async repointStaff(fromId, toId, db) {
    const r = await db.query(
      `UPDATE staff SET account_id = $2 WHERE account_id = $1`,
      [fromId, toId],
    );
    return r.rowCount ?? 0;
  },
  async repointIdentities(fromId, toId, db) {
    const r = await db.query(
      `UPDATE account_identities SET account_id = $2 WHERE account_id = $1`,
      [fromId, toId],
    );
    return r.rowCount ?? 0;
  },
  async repointPasskeys(fromId, toId, db) {
    const r = await db.query(
      `UPDATE webauthn_credentials SET account_id = $2 WHERE account_id = $1`,
      [fromId, toId],
    );
    return r.rowCount ?? 0;
  },
  async markMerged(mergedId, survivorId, db) {
    await db.query(
      `UPDATE accounts
          SET status = 'merged', merged_into = $2, merged_at = now(),
              deleted_at = now(), updated_at = now()
        WHERE id = $1`,
      [mergedId, survivorId],
    );
  },
  transaction(orgId, fn) {
    return withTenantTransaction(orgId, (client) => fn(client));
  },
};

function intersects(a: string[], b: string[]): boolean {
  const set = new Set(a.map((e) => e.toLowerCase()));
  return b.some((e) => set.has(e.toLowerCase()));
}

/**
 * Fold `mergedAccountId` into `survivorAccountId`. Atomic, idempotent, audited
 * by the caller. `orgId` scopes the transaction envelope (identity tables are
 * global; the GUC is harmless for them but keeps the tx tenant-consistent).
 */
export async function mergeAccounts(
  input: { survivorAccountId: string; mergedAccountId: string; orgId: OrgId },
  deps: MergeAccountsDeps = defaultMergeAccountsDeps,
): Promise<MergeAccountsResult> {
  const { survivorAccountId, mergedAccountId, orgId } = input;
  if (survivorAccountId === mergedAccountId) throw new AccountMergeError('SAME_ACCOUNT');

  return deps.transaction(orgId, async (db) => {
    const survivor = await deps.loadAccount(survivorAccountId, db);
    if (!survivor) throw new AccountMergeError('SURVIVOR_NOT_FOUND');
    const merged = await deps.loadAccount(mergedAccountId, db);
    if (!merged) throw new AccountMergeError('MERGED_NOT_FOUND');

    // Idempotency: already folded?
    if (merged.status === 'merged' || merged.mergedInto) {
      if (merged.mergedInto === survivorAccountId) {
        return {
          survivorAccountId,
          mergedAccountId,
          idempotent: true,
          repointed: { memberships: 0, staff: 0, identities: 0, passkeys: 0 },
        };
      }
      throw new AccountMergeError('MERGED_INTO_OTHER');
    }

    // Survivor must be a live account.
    if (survivor.status !== 'active' || survivor.deletedAt) {
      throw new AccountMergeError('SURVIVOR_INACTIVE');
    }

    // Same-human gate: both verified, sharing a verified email.
    const survivorEmails = await deps.listVerifiedEmails(survivorAccountId, db);
    if (survivorEmails.length === 0) throw new AccountMergeError('SURVIVOR_NO_VERIFIED_EMAIL');
    const mergedEmails = await deps.listVerifiedEmails(mergedAccountId, db);
    if (mergedEmails.length === 0) throw new AccountMergeError('MERGED_NO_VERIFIED_EMAIL');
    if (!intersects(survivorEmails, mergedEmails)) throw new AccountMergeError('EMAIL_MISMATCH');

    const memberships = await deps.repointMemberships(mergedAccountId, survivorAccountId, db);
    const staff = await deps.repointStaff(mergedAccountId, survivorAccountId, db);
    const identities = await deps.repointIdentities(mergedAccountId, survivorAccountId, db);
    const passkeys = await deps.repointPasskeys(mergedAccountId, survivorAccountId, db);
    await deps.markMerged(mergedAccountId, survivorAccountId, db);

    return {
      survivorAccountId,
      mergedAccountId,
      idempotent: false,
      repointed: { memberships, staff, identities, passkeys },
    };
  });
}
