/**
 * WS6.3 — email verification tokens.
 *
 * Reuses the existing F1 magic-link primitive (`email_login_tokens`): one-time,
 * expiring, HASHED tokens (the raw token only ever lives in the emailed URL; we
 * store sha256). A "verify your email" link IS a magic link that additionally
 * flips `account_emails.verified_at`, so it shares the same storage + atomic
 * single-use claim as owner email login (src/app/api/auth/email-login/*). No new
 * table.
 *
 * TTL is kept identical to the F1 login token (15 minutes) on purpose: these
 * tokens land in the SAME pool that `/api/auth/email-login/verify` will honor, so
 * matching the login posture means the verification link can never become a
 * longer-lived sign-in token than login itself — it does not weaken the existing
 * flow. (If a longer-lived verification window is ever needed, give it a dedicated
 * table so the login-token posture stays untouched.)
 */

import { randomBytes, createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import dbPool from '@/lib/db';

type Executor = Pool | PoolClient;

/** Lifetime of an email-verification link, in minutes (matches F1 login tokens). */
export const EMAIL_VERIFY_TTL_MINUTES = 15;

interface MintedVerificationToken {
  /** Raw token — place ONLY in the emailed URL; never persisted in the clear. */
  token: string;
  expiresAt: Date;
}

/** sha256 of a raw token — the value stored in `email_login_tokens.token_hash`. */
export function hashVerificationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Mint a single-use email-verification token for a staff/org. Reuses
 * `email_login_tokens`. Pass the signup transaction client to mint inside the
 * signup tx, or omit `db` to use the pool.
 */
export async function mintEmailVerificationToken(
  args: { organizationId: string; staffId: number },
  db: Executor = dbPool,
): Promise<MintedVerificationToken> {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashVerificationToken(token);
  const r = await db.query<{ expires_at: Date }>(
    `INSERT INTO email_login_tokens (organization_id, staff_id, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(mins => $4))
     RETURNING expires_at`,
    [args.organizationId, args.staffId, tokenHash, EMAIL_VERIFY_TTL_MINUTES],
  );
  return { token, expiresAt: r.rows[0]!.expires_at };
}

/** Absolute URL for the verify-email endpoint, embedding the raw token. */
export function buildVerifyEmailLink(token: string): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'https://app.example.com';
  return `${base.replace(/\/$/, '')}/api/auth/verify-email?token=${token}`;
}
