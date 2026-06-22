/**
 * Account-level WebAuthn / passkey helpers — the cross-org analogue of the
 * staff-keyed src/lib/auth/webauthn.ts. Credentials live in the global
 * `webauthn_credentials` table keyed by account_id, so a passkey signs you into
 * your ACCOUNT (then membership resolution picks the workspace), independent of
 * any single org's staff row.
 *
 * Storage: credential_id / public_key are stored as base64url TEXT (the
 * webauthn_credentials columns are text), so — unlike the staff table's bytea
 * columns — no base64⇄base64url juggling is needed; the browser speaks base64url
 * and so do we.
 *
 * Challenge handshake uses its own short-lived cookie so it never collides with
 * the staff passkey flow. RP config is shared via getRpFromRequest().
 *
 * See docs/identity-layer-plan.md.
 */

import { NextRequest } from 'next/server';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/types';
import pool from '@/lib/db';
import { getRpFromRequest } from '@/lib/auth/webauthn';

export const ACCOUNT_PASSKEY_CHALLENGE_COOKIE = 'usav_acct_wac';

interface AccountPasskeyRow {
  id: string;
  account_id: string;
  credential_id: string; // base64url
  public_key: string;    // base64url
  sign_count: number;
  transports: string[] | null;
  aaguid: string | null;
  label: string | null;
}

function mapRow(row: Record<string, unknown>): AccountPasskeyRow {
  return {
    id: String(row.id),
    account_id: String(row.account_id),
    credential_id: String(row.credential_id),
    public_key: String(row.public_key),
    sign_count: Number(row.sign_count ?? 0),
    transports: (row.transports as string[] | null) ?? null,
    aaguid: (row.aaguid as string | null) ?? null,
    label: (row.label as string | null) ?? null,
  };
}

export async function listAccountPasskeys(accountId: string): Promise<AccountPasskeyRow[]> {
  const r = await pool.query(
    `SELECT id, account_id, credential_id, public_key, sign_count, transports, aaguid::text, label
       FROM webauthn_credentials
      WHERE account_id = $1
      ORDER BY created_at DESC`,
    [accountId],
  );
  return r.rows.map(mapRow);
}

export async function findAccountPasskeyByCredentialId(credentialId: string): Promise<AccountPasskeyRow | null> {
  const r = await pool.query(
    `SELECT id, account_id, credential_id, public_key, sign_count, transports, aaguid::text, label
       FROM webauthn_credentials
      WHERE credential_id = $1
      LIMIT 1`,
    [credentialId],
  );
  return r.rows[0] ? mapRow(r.rows[0]) : null;
}

export interface AccountPasskeyMeta {
  id: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

/** List an account's passkeys for display (no secret material). */
export async function listAccountPasskeyMeta(accountId: string): Promise<AccountPasskeyMeta[]> {
  const r = await pool.query<{ id: string; label: string | null; created_at: string; last_used_at: string | null }>(
    `SELECT id, label, created_at, last_used_at
       FROM webauthn_credentials
      WHERE account_id = $1
      ORDER BY created_at DESC`,
    [accountId],
  );
  return r.rows.map((row) => ({
    id: row.id, label: row.label, createdAt: row.created_at, lastUsedAt: row.last_used_at,
  }));
}

/** Delete one of an account's passkeys (scoped to the account). */
export async function deleteAccountPasskey(accountId: string, id: string): Promise<boolean> {
  const r = await pool.query(
    `DELETE FROM webauthn_credentials WHERE id = $1 AND account_id = $2`,
    [id, accountId],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function bumpAccountPasskeyCounter(id: string, newCounter: number): Promise<void> {
  await pool.query(
    `UPDATE webauthn_credentials SET sign_count = $2, last_used_at = NOW() WHERE id = $1`,
    [id, newCounter],
  );
}

export async function insertAccountPasskey(opts: {
  accountId: string;
  credentialId: string; // base64url
  publicKey: string;    // base64url
  signCount: number;
  transports?: AuthenticatorTransportFuture[];
  aaguid?: string | null;
  label?: string | null;
}): Promise<void> {
  await pool.query(
    `INSERT INTO webauthn_credentials (account_id, credential_id, public_key, sign_count, transports, aaguid, label)
     VALUES ($1, $2, $3, $4, $5, $6::uuid, $7)
     ON CONFLICT (credential_id) DO NOTHING`,
    [
      opts.accountId,
      opts.credentialId,
      opts.publicKey,
      opts.signCount,
      opts.transports ?? null,
      opts.aaguid ?? null,
      opts.label ?? null,
    ],
  );
}

// ─── Registration ──────────────────────────────────────────────────────────

export async function buildAccountRegistrationOptions(opts: {
  req: NextRequest;
  accountId: string;
  userName: string;
  displayName: string;
}): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const { rpID, rpName } = getRpFromRequest(opts.req);
  const existing = await listAccountPasskeys(opts.accountId);
  return generateRegistrationOptions({
    rpName,
    rpID,
    userID: new TextEncoder().encode(opts.accountId),
    userName: opts.userName,
    userDisplayName: opts.displayName,
    timeout: 60_000,
    attestationType: 'none',
    authenticatorSelection: {
      // Resident (discoverable) so usernameless login works.
      residentKey: 'required',
      userVerification: 'preferred',
    },
    excludeCredentials: existing.map((p) => ({
      id: p.credential_id,
      transports: (p.transports ?? undefined) as AuthenticatorTransportFuture[] | undefined,
    })),
  });
}

export async function verifyAccountRegistration(opts: {
  req: NextRequest;
  expectedChallenge: string;
  response: RegistrationResponseJSON;
}) {
  const { rpID, origin } = getRpFromRequest(opts.req);
  return verifyRegistrationResponse({
    response: opts.response,
    expectedChallenge: opts.expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: false,
  });
}

// ─── Authentication (discoverable / usernameless) ───────────────────────────

export async function buildAccountAuthenticationOptions(opts: {
  req: NextRequest;
}): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const { rpID } = getRpFromRequest(opts.req);
  return generateAuthenticationOptions({
    rpID,
    timeout: 60_000,
    userVerification: 'preferred',
    // No allowCredentials → the authenticator offers its discoverable creds and
    // the chosen credential resolves to its account.
  });
}

export async function verifyAccountAuthentication(opts: {
  req: NextRequest;
  expectedChallenge: string;
  response: AuthenticationResponseJSON;
}) {
  const { rpID, origin } = getRpFromRequest(opts.req);
  const passkey = await findAccountPasskeyByCredentialId(opts.response.id);
  if (!passkey) return { verified: false as const, passkey: null };

  const verification = await verifyAuthenticationResponse({
    response: opts.response,
    expectedChallenge: opts.expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: false,
    credential: {
      id: passkey.credential_id,
      publicKey: Buffer.from(passkey.public_key, 'base64url'),
      counter: passkey.sign_count,
      transports: (passkey.transports ?? undefined) as AuthenticatorTransportFuture[] | undefined,
    },
  });
  return { verified: verification.verified, info: verification.authenticationInfo, passkey };
}
