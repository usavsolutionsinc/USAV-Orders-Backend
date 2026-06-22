'use client';

/**
 * /settings?section=security — per-user PIN + passkey management.
 *
 * Anyone signed in can use this to change their own PIN and add a passkey
 * for one-tap sign-in on their current device.
 */

import { useCallback, useEffect, useState } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import { useAuth } from '@/contexts/AuthContext';

export function SecuritySection() {
  const { user } = useAuth();
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [savingPin, setSavingPin] = useState(false);
  const [addingPasskey, setAddingPasskey] = useState(false);
  const [addingAcctPasskey, setAddingAcctPasskey] = useState(false);
  const [acctPasskeys, setAcctPasskeys] = useState<{ id: string; label: string | null; createdAt: string; lastUsedAt: string | null }[]>([]);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const loadAcctPasskeys = useCallback(async () => {
    try {
      const r = await fetch('/api/auth/account/passkey', { credentials: 'include', cache: 'no-store' });
      if (r.ok) {
        const data = await r.json() as { passkeys: typeof acctPasskeys };
        setAcctPasskeys(data.passkeys ?? []);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { void loadAcctPasskeys(); }, [loadAcctPasskeys]);

  const removeAcctPasskey = useCallback(async (id: string) => {
    if (removingId) return;
    setRemovingId(id);
    try {
      const r = await fetch(`/api/auth/account/passkey/${id}`, { method: 'DELETE', credentials: 'include' });
      if (r.ok) setAcctPasskeys((prev) => prev.filter((p) => p.id !== id));
    } finally {
      setRemovingId(null);
    }
  }, [removingId]);

  const savePin = useCallback(async () => {
    setErr(null); setOk(null);
    if (newPin.length < 4) { setErr('PIN must be at least 4 digits.'); return; }
    if (newPin !== confirmPin) { setErr("Confirmation doesn't match."); return; }
    setSavingPin(true);
    try {
      const r = await fetch('/api/auth/pin', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pin: newPin, currentPin: currentPin || undefined }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        setErr(String((data as { error?: string }).error || 'Could not save PIN.'));
      } else {
        setOk('PIN updated.');
        setCurrentPin(''); setNewPin(''); setConfirmPin('');
      }
    } finally {
      setSavingPin(false);
    }
  }, [currentPin, newPin, confirmPin]);

  const addPasskey = useCallback(async () => {
    setErr(null); setOk(null);
    setAddingPasskey(true);
    try {
      const beginRes = await fetch('/api/auth/passkey/register/begin', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!beginRes.ok) throw new Error('Could not start passkey registration.');
      const beginData = await beginRes.json() as { options: Parameters<typeof startRegistration>[0]['optionsJSON'] };
      const attResp = await startRegistration({ optionsJSON: beginData.options });
      const finishRes = await fetch('/api/auth/passkey/register/finish', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ response: attResp, deviceLabel: navigator.userAgent.slice(0, 64) }),
      });
      if (!finishRes.ok) throw new Error('Could not save passkey.');
      setOk('Passkey added. Next sign-in can use Touch ID / Windows Hello / Face ID.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Passkey setup failed.');
    } finally {
      setAddingPasskey(false);
    }
  }, []);

  const addAccountPasskey = useCallback(async () => {
    setErr(null); setOk(null);
    setAddingAcctPasskey(true);
    try {
      const beginRes = await fetch('/api/auth/account/passkey/register/begin', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!beginRes.ok) {
        const data = await beginRes.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error === 'MULTI_ORG_NOT_PROVISIONED'
          ? 'Account sign-in isn’t enabled for this profile yet.'
          : 'Could not start passkey registration.');
      }
      const beginData = await beginRes.json() as { options: Parameters<typeof startRegistration>[0]['optionsJSON'] };
      const attResp = await startRegistration({ optionsJSON: beginData.options });
      const finishRes = await fetch('/api/auth/account/passkey/register/finish', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ response: attResp, label: navigator.userAgent.slice(0, 64) }),
      });
      if (!finishRes.ok) throw new Error('Could not save passkey.');
      setOk('Account passkey added. You can now sign in by passkey at /account/signin across your workspaces.');
      void loadAcctPasskeys();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Passkey setup failed.');
    } finally {
      setAddingAcctPasskey(false);
    }
  }, [loadAcctPasskeys]);

  if (!user) {
    return <div className="text-sm text-gray-500">Sign in to manage your security.</div>;
  }

  return (
    <section className="space-y-8">
      <header>
        <h1 className="sr-only">Security</h1>
        <p className="text-sm text-gray-500">Manage your PIN and passkeys.</p>
      </header>

      {err && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
      {ok && <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{ok}</div>}

      <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Change your PIN</h2>
          <p className="text-xs text-gray-500">4–6 digit number. Used at shared stations.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="block">
            <span className="block text-xs text-gray-500 mb-1">Current PIN</span>
            <input type="password" inputMode="numeric" maxLength={6}
              value={currentPin} onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ''))}
              className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="block">
            <span className="block text-xs text-gray-500 mb-1">New PIN</span>
            <input type="password" inputMode="numeric" maxLength={6}
              value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
              className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="block">
            <span className="block text-xs text-gray-500 mb-1">Confirm new PIN</span>
            <input type="password" inputMode="numeric" maxLength={6}
              value={confirmPin} onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
              className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
          </label>
        </div>
        <div className="flex justify-end">
          <button type="button" disabled={savingPin || newPin.length < 4} onClick={savePin}
            className="rounded-lg bg-gray-900 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
            {savingPin ? 'Saving…' : 'Save PIN'}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Passkeys</h2>
          <p className="text-xs text-gray-500">One-tap sign-in via Touch ID, Face ID, Windows Hello, or your device PIN.</p>
        </div>
        <button type="button" disabled={addingPasskey} onClick={addPasskey}
          className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
          {addingPasskey ? 'Adding…' : 'Add a passkey on this device'}
        </button>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Account passkey (cross-workspace)</h2>
          <p className="text-xs text-gray-500">
            Sign in by passkey at <code>/account/signin</code> — resolves your account and lands you in your
            workspace (switch from Settings if you belong to more than one).
          </p>
        </div>
        <button type="button" disabled={addingAcctPasskey} onClick={addAccountPasskey}
          className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
          {addingAcctPasskey ? 'Adding…' : 'Add an account passkey'}
        </button>

        {acctPasskeys.length > 0 && (
          <div className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200">
            {acctPasskeys.map((p) => (
              <div key={p.id} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-gray-900">{p.label || 'Passkey'}</div>
                  <div className="truncate text-xs text-gray-500">
                    Added {new Date(p.createdAt).toLocaleDateString()}
                    {p.lastUsedAt ? ` · last used ${new Date(p.lastUsedAt).toLocaleDateString()}` : ' · never used'}
                  </div>
                </div>
                <button type="button" disabled={removingId === p.id} onClick={() => void removeAcctPasskey(p.id)}
                  className="shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">
                  {removingId === p.id ? 'Removing…' : 'Remove'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
