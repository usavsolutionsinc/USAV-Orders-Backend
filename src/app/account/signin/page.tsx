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
import { Button } from '@/design-system/primitives';

const FIELD =
  'w-full rounded-xl border border-border-default bg-surface-card px-3 py-2 text-sm text-text-default ' +
  'placeholder:text-text-faint focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';

interface Workspace { organizationId: string; organizationName: string }

export default function AccountSignInPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [choices, setChoices] = useState<Workspace[] | null>(null);
  const [linkSent, setLinkSent] = useState(false);

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

  // Passwordless magic-link: emails a one-time sign-in link. Always reports
  // success (the endpoint never reveals whether the email is registered).
  const magicLink = useCallback(async () => {
    if (busy || !email) return;
    setBusy(true);
    setErr(null);
    try {
      await fetch('/api/auth/email-login/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      setLinkSent(true);
    } catch {
      setErr('Could not send the sign-in link.');
    } finally {
      setBusy(false);
    }
  }, [busy, email]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-canvas px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border-soft bg-surface-card p-6 shadow-sm">
        <header className="mb-4 space-y-1">
          <h1 className="text-lg font-bold text-text-default">Sign in</h1>
          <p className="text-sm text-text-soft">Use your account email, or a passkey.</p>
        </header>

        {err && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

        {linkSent ? (
          <div className="space-y-2 rounded-xl border border-border-soft bg-surface-canvas px-4 py-6 text-center">
            <p className="text-sm font-semibold text-text-default">Check your email</p>
            <p className="text-xs text-text-soft">
              If {email || 'that address'} has an account, a one-time sign-in link is on its way (valid 15 minutes).
            </p>
            {/* ds-raw-button: minimal inline text link with hover:underline, not a DS Button control */}
            <button type="button" onClick={() => setLinkSent(false)} className="text-xs text-text-soft hover:underline">
              ← Back to sign in
            </button>
          </div>
        ) : choices ? (
          <div className="space-y-2">
            <p className="text-xs font-medium text-text-soft">Choose a workspace</p>
            <div className="divide-y divide-border-hairline overflow-hidden rounded-xl border border-border-soft">
              {choices.map((w) => (
                // ds-raw-button: text-left master-detail picker row (name + "Enter →" suffix), not a standard action button
                <button
                  key={w.organizationId}
                  type="button"
                  disabled={busy}
                  onClick={() => void signin(w.organizationId)}
                  className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm font-semibold text-text-default hover:bg-surface-hover disabled:opacity-50"
                >
                  {w.organizationName}
                  <span className="text-xs text-text-faint">Enter →</span>
                </button>
              ))}
            </div>
            {/* ds-raw-button: minimal inline text link with hover:underline, not a DS Button control */}
            <button type="button" onClick={() => setChoices(null)} className="text-xs text-text-soft hover:underline">
              ← Back
            </button>
          </div>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); void signin(); }} className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-text-muted">Email</span>
              <input className={FIELD} type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com" autoComplete="username" required />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-text-muted">Password</span>
              <input className={FIELD} type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="Your password" autoComplete="current-password" required />
            </label>
            <Button type="submit" variant="brand" disabled={busy || !email || !password} className="w-full">
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>

            <div className="flex items-center gap-3 py-1 text-xs text-text-faint">
              <span className="h-px flex-1 bg-surface-strong" /> or <span className="h-px flex-1 bg-surface-strong" />
            </div>

            <Button type="button" variant="secondary" disabled={busy} onClick={() => void passkeySignin()} className="w-full">
              Sign in with a passkey
            </Button>

            <Button type="button" variant="secondary" disabled={busy || !email} onClick={() => void magicLink()} className="w-full">
              Email me a sign-in link
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
