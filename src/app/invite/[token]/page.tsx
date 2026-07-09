'use client';

/**
 * Public invitation accept page (/invite/[token]).
 *
 * Previews the invitation, lets the invitee set their name + password, then
 * accepts → the server creates the account/membership/staff profile and signs
 * them in. On success we hard-navigate to /dashboard so the freshly-set session
 * cookie is picked up cleanly. Listed in PUBLIC_PATHS (src/proxy.ts) +
 * CLIENT_PUBLIC_PATHS (src/contexts/AuthContext.tsx).
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Button } from '@/design-system/primitives';

type Preview =
  | { state: 'loading' }
  | { state: 'invalid'; reason: string }
  | { state: 'valid'; organizationName: string; email: string; role: string | null };

const FIELD =
  'w-full rounded-xl border border-border-default bg-surface-card px-3 py-2 text-sm text-text-default ' +
  'placeholder:text-text-faint focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';

export default function InviteAcceptPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? '';

  const [preview, setPreview] = useState<Preview>({ state: 'loading' });
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/auth/invitation/accept?token=${encodeURIComponent(token)}`, { cache: 'no-store' });
        const data = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (r.ok && data.status === 'valid') {
          setPreview({ state: 'valid', organizationName: data.organizationName, email: data.email, role: data.role });
        } else {
          setPreview({ state: 'invalid', reason: data.status ?? 'not_found' });
        }
      } catch {
        if (!cancelled) setPreview({ state: 'invalid', reason: 'not_found' });
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const submit = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    setErr(null);
    try {
      const r = await fetch('/api/auth/invitation/accept', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, name, password }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        const code = (data as { error?: string }).error;
        setErr(
          code === 'WEAK_PASSWORD' ? 'Password must be at least 8 characters.' :
          code === 'PASSWORD_MISMATCH' ? 'This email already has an account — enter its existing password to join.' :
          code === 'EXPIRED' ? 'This invitation has expired.' :
          code === 'ALREADY_ACCEPTED' ? 'This invitation has already been used.' :
          code === 'NOT_FOUND' ? 'This invitation is no longer valid.' :
          "Couldn't accept the invitation.",
        );
        setSubmitting(false);
        return;
      }
      window.location.assign('/dashboard');
    } catch {
      setErr("Couldn't accept the invitation.");
      setSubmitting(false);
    }
  }, [submitting, token, name, password]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-canvas px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border-soft bg-surface-card p-6 shadow-sm">
        {preview.state === 'loading' && (
          <div className="flex flex-col items-center gap-3 py-8 text-text-soft">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-border-soft border-t-text-muted" />
            <p className="text-sm">Loading invitation…</p>
          </div>
        )}

        {preview.state === 'invalid' && (
          <div className="space-y-2 py-6 text-center">
            <h1 className="text-lg font-bold text-text-default">Invitation unavailable</h1>
            <p className="text-sm text-text-soft">
              {preview.reason === 'expired' ? 'This invitation has expired.' :
               preview.reason === 'accepted' ? 'This invitation has already been used.' :
               'This invitation link is not valid.'}
            </p>
            <a href="/signin" className="mt-2 inline-block text-sm font-semibold text-blue-600 hover:underline">
              Go to sign in
            </a>
          </div>
        )}

        {preview.state === 'valid' && (
          <form
            onSubmit={(e) => { e.preventDefault(); void submit(); }}
            className="space-y-4"
          >
            <header className="space-y-1">
              <p className="text-eyebrow font-bold uppercase tracking-[0.14em] text-text-faint">
                You&rsquo;re invited to
              </p>
              <h1 className="text-lg font-bold text-text-default">{preview.organizationName}</h1>
              <p className="text-sm text-text-soft">
                {preview.email}{preview.role ? ` · ${preview.role.replace(/_/g, ' ')}` : ''}
              </p>
            </header>

            {err && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-text-muted">Your name</span>
              <input className={FIELD} value={name} onChange={(e) => setName(e.target.value)}
                placeholder="Jane Smith" autoComplete="name" required />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-text-muted">Password</span>
              <input className={FIELD} type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters" autoComplete="current-password" minLength={8} required />
              <span className="mt-1 block text-xs text-text-faint">
                New here? This becomes your password. Already have an account with this email? Enter its password.
              </span>
            </label>

            <Button
              type="submit"
              variant="brand"
              disabled={submitting || !name || password.length < 8}
              className="w-full"
            >
              {submitting ? 'Joining…' : `Join ${preview.organizationName}`}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
