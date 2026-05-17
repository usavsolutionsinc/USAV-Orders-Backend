/**
 * WebAuthn / passkey server helpers — thin wrapper over @simplewebauthn/server.
 *
 * Challenges are stashed in a short-lived httpOnly cookie (5 min TTL), so we
 * don't need an extra DB table or Redis for the begin → finish handshake.
 *
 * RP configuration comes from env. In dev (localhost), the library auto-
 * accepts the loopback origin. In prod it must match exactly.
 */

import { NextRequest } from 'next/server';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import pool from '@/lib/db';

export const PASSKEY_CHALLENGE_COOKIE = 'usav_wac';

/**
 * Returns { rpID, rpName, origin } resolved against the request.
 * Override via env in prod; fall back to request headers in dev.
 */
export function getRpFromRequest(req: NextRequest): {
  rpID: string;
  rpName: string;
  origin: string;
} {
  const envOrigin = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '').replace(/\/+$/, '');
  const reqOrigin = req.nextUrl.origin;
  const origin = envOrigin || reqOrigin;
  const rpID = new URL(origin).hostname;
  return {
    rpID,
    rpName: process.env.WEBAUTHN_RP_NAME || 'USAV Solutions',
    origin,
  };
}

interface PasskeyRow {
  id: number;
  staff_id: number;
  credential_id: string;     // base64url
  public_key: string;        // base64url
  counter: number;
  transports: string[] | null;
  aaguid: string | null;
  device_label: string | null;
}

export async function listPasskeysForStaff(staffId: number): Promise<PasskeyRow[]> {
  const r = await pool.query(
    `SELECT id, staff_id,
            encode(credential_id, 'base64')  AS credential_id,
            encode(public_key,    'base64')  AS public_key,
            counter, transports, aaguid::text, device_label
       FROM staff_passkeys
      WHERE staff_id = $1
      ORDER BY created_at DESC`,
    [staffId],
  );
  return r.rows as PasskeyRow[];
}

export async function findPasskeyByCredentialId(credentialId: string): Promise<PasskeyRow | null> {
  // credentialId from browser is base64url. We stored as bytea via base64.
  const stdBase64 = credentialId.replace(/-/g, '+').replace(/_/g, '/');
  const r = await pool.query(
    `SELECT id, staff_id,
            encode(credential_id, 'base64')  AS credential_id,
            encode(public_key,    'base64')  AS public_key,
            counter, transports, aaguid::text, device_label
       FROM staff_passkeys
      WHERE credential_id = decode($1, 'base64')
      LIMIT 1`,
    [stdBase64],
  );
  return (r.rows[0] as PasskeyRow | undefined) ?? null;
}

export async function bumpPasskeyCounter(id: number, newCounter: number): Promise<void> {
  await pool.query(
    `UPDATE staff_passkeys
        SET counter = $2, last_used_at = NOW()
      WHERE id = $1`,
    [id, newCounter],
  );
}

export async function insertPasskey(opts: {
  staffId: number;
  credentialId: string;   // base64url
  publicKey: string;      // base64url
  counter: number;
  transports?: AuthenticatorTransportFuture[];
  aaguid?: string | null;
  deviceLabel?: string | null;
}): Promise<void> {
  const credStd = opts.credentialId.replace(/-/g, '+').replace(/_/g, '/');
  const pkStd = opts.publicKey.replace(/-/g, '+').replace(/_/g, '/');
  await pool.query(
    `INSERT INTO staff_passkeys (staff_id, credential_id, public_key, counter, transports, aaguid, device_label)
     VALUES ($1, decode($2, 'base64'), decode($3, 'base64'), $4, $5, $6::uuid, $7)
     ON CONFLICT (credential_id) DO NOTHING`,
    [
      opts.staffId,
      credStd,
      pkStd,
      opts.counter,
      opts.transports ?? null,
      opts.aaguid ?? null,
      opts.deviceLabel ?? null,
    ],
  );
}

// ─── Registration ──────────────────────────────────────────────────────────

export async function buildRegistrationOptions(opts: {
  req: NextRequest;
  staffId: number;
  staffName: string;
}): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const { rpID, rpName } = getRpFromRequest(opts.req);
  const existing = await listPasskeysForStaff(opts.staffId);
  return generateRegistrationOptions({
    rpName,
    rpID,
    userID: new TextEncoder().encode(String(opts.staffId)),
    userName: opts.staffName,
    userDisplayName: opts.staffName,
    timeout: 60_000,
    attestationType: 'none',
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
    excludeCredentials: existing.map((p) => ({
      id: p.credential_id.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
      transports: (p.transports ?? undefined) as AuthenticatorTransportFuture[] | undefined,
    })),
  });
}

export async function verifyRegistration(opts: {
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

// ─── Authentication ────────────────────────────────────────────────────────

export async function buildAuthenticationOptions(opts: {
  req: NextRequest;
  staffId?: number | null;
}): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const { rpID } = getRpFromRequest(opts.req);
  let allowCredentials: { id: string; transports?: AuthenticatorTransportFuture[] }[] | undefined;
  if (opts.staffId) {
    const existing = await listPasskeysForStaff(opts.staffId);
    allowCredentials = existing.map((p) => ({
      id: p.credential_id.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
      transports: (p.transports ?? undefined) as AuthenticatorTransportFuture[] | undefined,
    }));
  }
  return generateAuthenticationOptions({
    rpID,
    timeout: 60_000,
    userVerification: 'preferred',
    allowCredentials,
  });
}

export async function verifyAuthentication(opts: {
  req: NextRequest;
  expectedChallenge: string;
  response: AuthenticationResponseJSON;
}) {
  const { rpID, origin } = getRpFromRequest(opts.req);
  // base64url credentialId from the browser
  const passkey = await findPasskeyByCredentialId(opts.response.id);
  if (!passkey) {
    return { verified: false as const, passkey: null };
  }
  const verification = await verifyAuthenticationResponse({
    response: opts.response,
    expectedChallenge: opts.expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: false,
    credential: {
      id: passkey.credential_id.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
      publicKey: Buffer.from(passkey.public_key, 'base64'),
      counter: passkey.counter,
      transports: (passkey.transports ?? undefined) as AuthenticatorTransportFuture[] | undefined,
    },
  });
  return { verified: verification.verified, info: verification.authenticationInfo, passkey };
}
