'use client';

/**
 * <StepUpModal scope="bin.remove" open onResolved={…} onCancel={…} />
 *
 * Used by callers that just got `403 STEPUP_REQUIRED` from an API. After
 * the user re-enters their PIN (or uses a passkey), the grant lives for 5
 * minutes — the caller should retry their original request.
 *
 * Lighter than a full PIN screen; renders inline as a centered overlay.
 */

import { useCallback, useState } from 'react';
import { startAuthentication } from '@simplewebauthn/browser';

interface StepUpModalProps {
  scope: string;
  open: boolean;
  onResolved: () => void;
  onCancel: () => void;
  /** Optional label describing what the user is about to do. */
  reason?: string;
}

export function StepUpModal({ scope, open, onResolved, onCancel, reason }: StepUpModalProps) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submitPin = useCallback(async (digits: string) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch('/api/auth/step-up', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scope, method: 'pin', pin: digits }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        setErr(humanError((data as { error?: string }).error));
        setPin('');
        return;
      }
      onResolved();
    } finally {
      setBusy(false);
    }
  }, [scope, onResolved]);

  const submitPasskey = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const beginRes = await fetch('/api/auth/passkey/authenticate/begin', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!beginRes.ok) throw new Error('Passkey not available.');
      const begin = await beginRes.json() as { options: Parameters<typeof startAuthentication>[0]['optionsJSON'] };
      const assertion = await startAuthentication({ optionsJSON: begin.options });
      const finishRes = await fetch('/api/auth/step-up', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scope, method: 'passkey', response: assertion }),
      });
      if (!finishRes.ok) {
        const data = await finishRes.json().catch(() => ({}));
        throw new Error(humanError((data as { error?: string }).error));
      }
      onResolved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Passkey verification failed.');
    } finally {
      setBusy(false);
    }
  }, [scope, onResolved]);

  if (!open) return null;

  const press = (d: string) => {
    setErr(null);
    setPin((p) => {
      const next = p.length < 6 ? p + d : p;
      if (next.length === 6) setTimeout(() => void submitPin(next), 30);
      return next;
    });
  };

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-black/60 p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-2xl p-6 w-full max-w-sm text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-700 text-xl">
          🔐
        </div>
        <h2 className="text-base font-semibold text-gray-900">Confirm your identity</h2>
        <p className="text-xs text-gray-500 mt-1">
          {reason || `Enter your PIN to ${scope.replace(/_/g, ' ').replace(/\./g, ' ')}`}.
        </p>

        <div className="my-5 flex justify-center gap-2.5">
          {[0,1,2,3,4,5].map((i) => (
            <div key={i} className={`h-3 w-3 rounded-full transition ${i < pin.length ? 'bg-gray-900' : 'bg-gray-200'}`} />
          ))}
        </div>

        {err && <div className="mb-3 text-xs text-red-600">{err}</div>}

        {/* ds-raw-button: PIN entry numpad keypad (digit/passkey/backspace keys) — auth surface, not design-system Buttons */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          {['1','2','3','4','5','6','7','8','9'].map((d) => (
            <button key={d} type="button" disabled={busy}
              className="ds-raw-button h-12 rounded-lg bg-gray-50 border border-gray-200 text-lg font-medium hover:bg-gray-100"
              onClick={() => press(d)}>{d}</button>
          ))}
          <button type="button" disabled={busy}
            className="ds-raw-button h-12 rounded-lg text-xs text-gray-500 hover:text-gray-900"
            onClick={() => submitPasskey()}>Passkey</button>
          <button type="button" disabled={busy}
            className="ds-raw-button h-12 rounded-lg bg-gray-50 border border-gray-200 text-lg font-medium hover:bg-gray-100"
            onClick={() => press('0')}>0</button>
          <button type="button" disabled={busy || pin.length === 0}
            className="ds-raw-button h-12 rounded-lg bg-gray-50 border border-gray-200 text-base hover:bg-gray-100"
            onClick={() => setPin((p) => p.slice(0, -1))}>⌫</button>
        </div>

        {/* ds-raw-button: minimal inline text-link cancel (no chrome) — Button would add height/padding */}
        <button type="button" onClick={onCancel}
          className="text-xs text-gray-500 hover:text-gray-900 mt-1">
          Cancel
        </button>
      </div>
    </div>
  );
}

function humanError(code: string | undefined): string {
  switch (code) {
    case 'WRONG':        return 'PIN incorrect. Try again.';
    case 'NO_PIN':       return 'No PIN on this account.';
    case 'NOT_FOUND':    return 'Account not found.';
    case 'VERIFY_FAILED': return 'Passkey verification failed.';
    case 'PASSKEY_MISMATCH': return 'That passkey isn\'t yours.';
    default:             return 'Confirmation failed. Try again.';
  }
}

// ─── A tiny fetch helper that handles STEPUP_REQUIRED transparently ────────

/**
 * Like fetch(), but if the response is `403 STEPUP_REQUIRED`, asks the user
 * to step up via PIN/passkey and retries once. Callers integrate by passing
 * a `requestStepUp` callback that opens the modal and resolves when granted.
 */
export async function fetchWithStepUp(
  input: RequestInfo,
  init: RequestInit | undefined,
  requestStepUp: (scope: string) => Promise<boolean>,
): Promise<Response> {
  const r = await fetch(input, { credentials: 'include', ...init });
  if (r.status !== 403) return r;
  const cloned = r.clone();
  let data: { error?: string; scope?: string } | null = null;
  try { data = await cloned.json(); } catch { /* fall through */ }
  if (data?.error !== 'STEPUP_REQUIRED' || !data.scope) return r;
  const granted = await requestStepUp(data.scope);
  if (!granted) return r;
  return fetch(input, { credentials: 'include', ...init });
}
