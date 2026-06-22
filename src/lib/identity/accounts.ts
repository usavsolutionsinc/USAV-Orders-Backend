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
 * Create a new global account with a verified primary email and optional
 * password. Caller should run this inside a transaction when chaining with
 * membership/staff creation. Returns the new account id.
 */
export async function createAccount(
  input: { displayName: string; email: string; password?: string | null },
  db: Executor = pool,
): Promise<string> {
  const passwordHash = input.password ? await hashPassword(input.password) : null;
  const acc = await db.query<{ id: string }>(
    `INSERT INTO accounts (display_name, primary_email, password_hash, status)
     VALUES ($1, $2, $3, 'active')
     RETURNING id`,
    [input.displayName, input.email.toLowerCase(), passwordHash],
  );
  const accountId = acc.rows[0]!.id;
  await db.query(
    `INSERT INTO account_emails (account_id, email, verified_at)
     VALUES ($1, $2, now())
     ON CONFLICT (lower(email)) DO NOTHING`,
    [accountId, input.email],
  );
  return accountId;
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
