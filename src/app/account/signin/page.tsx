'use client';

/**
 * Account-level sign-in (/account/signin) — the cross-org entry point.
 *
 * Email + password (POST /api/auth/account/signin) with a workspace picker when
 * the account belongs to more than one org, plus passwordless passkey sign-in
 * (account WebAuthn). Distinct from the org-scoped station PIN page at /signin.
 *
 * Public: listed in PUBLIC_PATHS (src/proxy.ts) + CLIENT_PUBLIC_PATHS.
 */

import { useCallback, useState } from 'react';
import { startAuthentication } from '@simplewebauthn/browser';

const FIELD =
  'w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 ' +
  'placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';

interface Workspace { organizationId: string; organizationName: string }

export default function AccountSignInPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [choices, setChoices] = useState<Workspace[] | null>(null);

  const finish = useCallback(() => window.location.assign('/dashboard'), []);

  const signin = useCallback(async (organizationId?: string) => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch('/api/auth/account/signin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, organizationId }),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok && (data as { ok?: boolean }).ok) { finish(); return; }
      if (r.ok && (data as { needsOrgChoice?: boolean }).needsOrgChoice) {
        setChoices((data as { memberships: Workspace[] }).memberships);
        setBusy(false);
        return;
      }
      const code = (data as { error?: string }).error;
      setErr(
        code === 'INVALID_CREDENTIALS' ? 'Incorrect email or password.' :
        code === 'NO_WORKSPACE' ? 'This account isn’t a member of any workspace yet.' :
        code === 'ACCOUNT_NOT_ACTIVE' ? 'This account is not active.' :
        'Could not sign in.',
      );
      setBusy(false);
    } catch {
      setErr('Could not sign in.');
      setBusy(false);
    }
  }, [busy, email, password, finish]);

  const passkeySignin = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const beginRes = await fetch('/api/auth/account/passkey/authenticate/begin', { method: 'POST' });
      if (!beginRes.ok) throw new Error('start');
      const beginData = await beginRes.json() as { options: Parameters<typeof startAuthentication>[0]['optionsJSON'] };
      const asseResp = await startAuthentication({ optionsJSON: beginData.options });
      const finishRes = await fetch('/api/auth/account/passkey/authenticate/finish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ response: asseResp }),
      });
      if (!finishRes.ok) throw new Error('verify');
      finish();
    } catch {
      setErr('Passkey sign-in failed or was cancelled.');
      setBusy(false);
    }
  }, [busy, finish]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <header className="mb-4 space-y-1">
          <h1 className="text-lg font-bold text-gray-900">Sign in</h1>
          <p className="text-sm text-gray-500">Use your account email, or a passkey.</p>
        </header>

        {err && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

        {choices ? (
          <div className="space-y-2">
            <p className="text-xs font-medium text-gray-500">Choose a workspace</p>
            <div className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200">
              {choices.map((w) => (
                <button
                  key={w.organizationId}
                  type="button"
                  disabled={busy}
                  onClick={() => void signin(w.organizationId)}
                  className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-50"
                >
                  {w.organizationName}
                  <span className="text-xs text-gray-400">Enter →</span>
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setChoices(null)} className="text-xs text-gray-500 hover:underline">
              ← Back
            </button>
          </div>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); void signin(); }} className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-700">Email</span>
              <input className={FIELD} type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com" autoComplete="username" required />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-700">Password</span>
              <input className={FIELD} type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="Your password" autoComplete="current-password" required />
            </label>
            <button type="submit" disabled={busy || !email || !password}
              className="w-full rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black disabled:opacity-50">
              {busy ? 'Signing in…' : 'Sign in'}
            </button>

            <div className="flex items-center gap-3 py-1 text-xs text-gray-400">
              <span className="h-px flex-1 bg-gray-200" /> or <span className="h-px flex-1 bg-gray-200" />
            </div>

            <button type="button" disabled={busy} onClick={() => void passkeySignin()}
              className="w-full rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-50">
              Sign in with a passkey
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
