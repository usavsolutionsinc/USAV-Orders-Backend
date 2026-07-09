/**
 * id_token claim validation — the dependency-free half of OIDC SSO.
 *
 * `validateIdTokenClaims` validates the standard claims (iss / aud / exp / iat)
 * that the auth-code callback relies on. Pure + DB-free; the signature is
 * covered by the direct-TLS token exchange (OIDC §3.1.3.7), not asserted here.
 */

import { test } from 'node:test';
import { ok, strictEqual, throws, doesNotThrow } from 'node:assert';

import { validateIdTokenClaims, IdTokenError } from './sso-oidc';

const ISSUER = 'https://login.acme.com';
const CLIENT_ID = 'client-abc';

/** Build an unsigned JWT with the given payload (signature is a placeholder —
 *  validateIdTokenClaims deliberately does not check it). */
function fakeIdToken(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(payload)}.signature`;
}

const now = () => Math.floor(Date.now() / 1000);

test('valid token returns its claims', () => {
  const token = fakeIdToken({
    iss: ISSUER, aud: CLIENT_ID, sub: 'user-1', email: 'a@acme.com',
    exp: now() + 600, iat: now(),
  });
  const claims = validateIdTokenClaims(token, { issuer: ISSUER, clientId: CLIENT_ID });
  strictEqual(claims.sub, 'user-1');
  strictEqual(claims.email, 'a@acme.com');
});

test('trailing-slash issuer differences are tolerated', () => {
  const token = fakeIdToken({ iss: `${ISSUER}/`, aud: CLIENT_ID, sub: 's', exp: now() + 60 });
  doesNotThrow(() => validateIdTokenClaims(token, { issuer: ISSUER, clientId: CLIENT_ID }));
});

test('issuer mismatch throws IdTokenError', () => {
  const token = fakeIdToken({ iss: 'https://evil.example', aud: CLIENT_ID, sub: 's', exp: now() + 60 });
  throws(
    () => validateIdTokenClaims(token, { issuer: ISSUER, clientId: CLIENT_ID }),
    (e: unknown) => e instanceof IdTokenError && /issuer/.test((e as Error).message),
  );
});

test('audience mismatch throws', () => {
  const token = fakeIdToken({ iss: ISSUER, aud: 'some-other-client', sub: 's', exp: now() + 60 });
  throws(() => validateIdTokenClaims(token, { issuer: ISSUER, clientId: CLIENT_ID }), IdTokenError);
});

test('aud as an array containing the client id passes', () => {
  const token = fakeIdToken({ iss: ISSUER, aud: ['other', CLIENT_ID], sub: 's', exp: now() + 60 });
  doesNotThrow(() => validateIdTokenClaims(token, { issuer: ISSUER, clientId: CLIENT_ID }));
});

test('expired token (beyond skew) throws', () => {
  const token = fakeIdToken({ iss: ISSUER, aud: CLIENT_ID, sub: 's', exp: now() - 600 });
  throws(() => validateIdTokenClaims(token, { issuer: ISSUER, clientId: CLIENT_ID }), IdTokenError);
});

test('token within the clock-skew window is accepted', () => {
  // exp 30s in the past, default skew 120s → still valid.
  const token = fakeIdToken({ iss: ISSUER, aud: CLIENT_ID, sub: 's', exp: now() - 30 });
  doesNotThrow(() => validateIdTokenClaims(token, { issuer: ISSUER, clientId: CLIENT_ID }));
});

test('iat too far in the future throws', () => {
  const token = fakeIdToken({ iss: ISSUER, aud: CLIENT_ID, sub: 's', iat: now() + 3600, exp: now() + 7200 });
  throws(() => validateIdTokenClaims(token, { issuer: ISSUER, clientId: CLIENT_ID }), IdTokenError);
});

test('missing standard claims are lenient (validate only what is present)', () => {
  // Some IdPs omit aud/exp on the id_token; we only assert claims that exist.
  const token = fakeIdToken({ sub: 's', email: 'b@acme.com' });
  const claims = validateIdTokenClaims(token, { issuer: ISSUER, clientId: CLIENT_ID });
  strictEqual(claims.sub, 's');
});

test('an unparseable token throws IdTokenError', () => {
  throws(() => validateIdTokenClaims('not-a-jwt', { issuer: ISSUER, clientId: CLIENT_ID }), IdTokenError);
});

test('exported error type is named', () => {
  ok(new IdTokenError('x') instanceof Error);
  strictEqual(new IdTokenError('x').name, 'IdTokenError');
});
