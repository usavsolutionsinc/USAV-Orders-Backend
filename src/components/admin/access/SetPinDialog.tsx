'use client';

/**
 * Modal to admin-set a specific PIN for a staff member.
 *
 * Two inputs — PIN and confirm — both numeric 4-6 digits. Submits via the
 * caller's `onSubmit(pin)` which calls /api/admin/staff/[id]/set-pin.
 * Server may respond `STEPUP_REQUIRED` if the admin's session hasn't done
 * a fresh step-up — in that case the dialog stays open and surfaces the
 * error so the admin can satisfy step-up via the global helper.
 */

import { useCallback, useState } from 'react';
import { Button } from '@/design-system/primitives';

interface SetPinDialogProps {
  open: boolean;
  staffName: string;
  onClose: () => void;
  onSubmit: (pin: string) => Promise<{ ok: true } | { ok: false; error: string }>;
}

export function SetPinDialog({ open, staffName, onClose, onSubmit }: SetPinDialogProps) {
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reset = useCallback(() => {
    setPin('');
    setConfirm('');
    setErr(null);
  }, []);

  const submit = useCallback(async () => {
    setErr(null);
    if (!/^\d{4,6}$/.test(pin)) { setErr('PIN must be 4–6 digits.'); return; }
    if (pin !== confirm) { setErr('Confirmation does not match.'); return; }
    setBusy(true);
    try {
      const r = await onSubmit(pin);
      if (r.ok) {
        reset();
        onClose();
      } else {
        setErr(r.error);
      }
    } finally {
      setBusy(false);
    }
  }, [pin, confirm, onSubmit, reset, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/60 p-4" onClick={() => { if (!busy) { reset(); onClose(); } }}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-gray-900">Set PIN for {staffName}</h2>
        <p className="mt-1 text-xs text-gray-500">
          Push a specific PIN to this staff member. They&apos;ll be able to sign in immediately with the new code.
        </p>

        <div className="mt-5 space-y-3">
          <label className="block">
            <span className="block text-caption font-semibold uppercase tracking-wider text-gray-500">New PIN</span>
            <input
              autoFocus
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm tracking-widest outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15"
              placeholder="••••"
            />
          </label>
          <label className="block">
            <span className="block text-caption font-semibold uppercase tracking-wider text-gray-500">Confirm PIN</span>
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
              className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm tracking-widest outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15"
              placeholder="••••"
            />
          </label>
        </div>

        {err && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => { reset(); onClose(); }} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={busy || pin.length < 4}>
            {busy ? 'Saving…' : 'Set PIN'}
          </Button>
        </div>
      </div>
    </div>
  );
}
