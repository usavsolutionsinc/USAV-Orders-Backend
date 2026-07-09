'use client';

/**
 * Mobile enrollment landing — scanned from the admin-generated QR.
 *
 *   1. Verify token + show "Welcome <name>"
 *   2. Set a 6-digit PIN (numpad)
 *   3. Optional: "Add passkey on this phone" (WebAuthn registration)
 *   4. Send them to /signin afterwards so the next visit works.
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { startRegistration } from '@simplewebauthn/browser';
import { Button } from '@/design-system/primitives';

type Stage = 'loading' | 'invalid' | 'set-pin' | 'optional-passkey' | 'done';

interface StaffInfo { id: number; name: string; role: string }

export default function EnrollPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('loading');
  const [staff, setStaff] = useState<StaffInfo | null>(null);
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [step, setStep] = useState<'enter' | 'confirm'>('enter');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    void (async () => {
      try {
        const r = await fetch(`/api/auth/enroll/${token}`, { cache: 'no-store' });
        if (!r.ok) { setStage('invalid'); return; }
        const data = await r.json() as { staff: StaffInfo };
        setStaff(data.staff);
        setStage('set-pin');
      } catch {
        setStage('invalid');
      }
    })();
  }, [token]);

  const submit = useCallback(async () => {
    if (pin.length < 4) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/auth/enroll/${token}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ pin }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        setErr(humanError((data as { error?: string }).error));
        return;
      }
      setStage('optional-passkey');
    } finally {
      setBusy(false);
    }
  }, [pin, token]);

  const addPasskey = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const beginRes = await fetch('/api/auth/passkey/register/begin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });
      if (!beginRes.ok) throw new Error('Could not start passkey registration.');
      const beginData = await beginRes.json() as { options: Parameters<typeof startRegistration>[0]['optionsJSON'] };
      const attResp = await startRegistration({ optionsJSON: beginData.options });
      const finishRes = await fetch('/api/auth/passkey/register/finish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          response: attResp,
          deviceLabel: navigator.userAgent.slice(0, 64),
        }),
      });
      if (!finishRes.ok) throw new Error('Could not save passkey.');
      setStage('done');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Passkey setup failed.');
    } finally {
      setBusy(false);
    }
  }, []);

  if (stage === 'loading') {
    return <Shell><div style={{ color: '#666' }}>Loading…</div></Shell>;
  }
  if (stage === 'invalid' || !staff) {
    return (
      <Shell>
        <div style={{ fontSize: 56, lineHeight: 1, marginBottom: 8 }}>⛔</div>
        <h1 style={{ margin: 0 }}>Invitation expired or already used.</h1>
        <p style={{ color: '#666', marginTop: 8 }}>Ask an admin for a new enrollment QR.</p>
      </Shell>
    );
  }

  if (stage === 'set-pin') {
    const targetPin = step === 'enter' ? pin : confirmPin;
    const press = (d: string) => {
      setErr(null);
      if (step === 'enter') {
        setPin((p) => {
          const next = p.length < 6 ? p + d : p;
          if (next.length === 6) setTimeout(() => setStep('confirm'), 80);
          return next;
        });
      } else {
        setConfirmPin((p) => {
          const next = p.length < 6 ? p + d : p;
          if (next.length === 6) {
            setTimeout(() => {
              if (next !== pin) {
                setErr('PINs don\'t match. Try again.');
                setPin('');
                setConfirmPin('');
                setStep('enter');
              } else {
                void submit();
              }
            }, 80);
          }
          return next;
        });
      }
    };
    const back = () => {
      if (step === 'confirm') {
        setStep('enter');
        setConfirmPin('');
      } else {
        setPin((p) => p.slice(0, -1));
      }
    };
    return (
      <Shell>
        <div style={{ ...avatarStyle, width: 72, height: 72, fontSize: 26, marginBottom: 12 }}>
          {staff.name.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('')}
        </div>
        <h1 style={{ margin: 0, fontSize: 22 }}>Welcome, {staff.name}</h1>
        <p style={{ color: '#666', fontSize: 14, marginTop: 6 }}>
          {step === 'enter' ? 'Set a 6-digit PIN.' : 'Re-enter your PIN to confirm.'}
        </p>
        <div style={dotsRowStyle}>
          {[0,1,2,3,4,5].map((i) => (
            <div key={i} style={{ ...dotStyle, background: i < targetPin.length ? '#111' : '#e5e5e5' }} />
          ))}
        </div>
        {err && <div style={errorStyle}>{err}</div>}
        {/* ds-raw-button: bespoke inline-styled circular numpad keypad — not a design-system Button */}
        <div style={numpadStyle}>
          {['1','2','3','4','5','6','7','8','9'].map((d) => (
            <button key={d} type="button" disabled={busy} style={padStyle} onClick={() => press(d)}>{d}</button>
          ))}
          <button type="button" className="ds-raw-button" style={{ ...padStyle, visibility: 'hidden' }} aria-hidden />
          <button type="button" className="ds-raw-button" disabled={busy} style={padStyle} onClick={() => press('0')}>0</button>
          <button type="button" className="ds-raw-button" disabled={busy || targetPin.length === 0} style={padStyle} onClick={back}>⌫</button>
        </div>
      </Shell>
    );
  }

  if (stage === 'optional-passkey') {
    return (
      <Shell>
        <div style={{ fontSize: 48, lineHeight: 1, marginBottom: 8 }}>✅</div>
        <h1 style={{ margin: 0, fontSize: 22 }}>PIN saved.</h1>
        <p style={{ color: '#666', marginTop: 6, textAlign: 'center', maxWidth: 320 }}>
          Add a passkey for one-tap sign in on this phone? Uses Face ID, Touch ID, or your device PIN.
        </p>
        {err && <div style={errorStyle}>{err}</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: 280, marginTop: 16 }}>
          <Button variant="brand" size="lg" className="w-full" disabled={busy} onClick={addPasskey}>
            {busy ? 'Adding…' : 'Add passkey'}
          </Button>
          <Button variant="secondary" size="lg" className="w-full" onClick={() => setStage('done')}>
            Skip for now
          </Button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div style={{ fontSize: 56, lineHeight: 1, marginBottom: 8 }}>🎉</div>
      <h1 style={{ margin: 0, fontSize: 22 }}>You&apos;re all set.</h1>
      <p style={{ color: '#666', marginTop: 6, textAlign: 'center', maxWidth: 320 }}>
        You can close this page or open the app on a station — your name will appear in the sign-in picker.
      </p>
      <Button variant="brand" size="lg" className="mt-[18px] w-[220px]" onClick={() => router.replace('/signin')}>
        Open sign-in
      </Button>
    </Shell>
  );
}

function humanError(code: string | undefined): string {
  switch (code) {
    case 'TOO_SHORT':   return 'PIN is too short.';
    case 'TOO_LONG':    return 'PIN is too long.';
    case 'NOT_NUMERIC': return 'Digits only, please.';
    case 'INVALID_ENROLLMENT': return 'This invitation has expired.';
    default: return 'Something went wrong. Try again.';
  }
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: '#fafafa',
      padding: '32px 24px 64px',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start',
      fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      overflowY: 'auto',
    }}>
      {children}
    </div>
  );
}

const avatarStyle: React.CSSProperties = {
  width: 52, height: 52, borderRadius: 999, background: '#111', color: '#fff',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontWeight: 700, fontSize: 18, letterSpacing: 0.5,
};
const dotsRowStyle: React.CSSProperties = { display: 'flex', gap: 12, marginTop: 20, marginBottom: 16 };
const dotStyle: React.CSSProperties = { width: 14, height: 14, borderRadius: 999, transition: 'background 80ms' };
const numpadStyle: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(3, 80px)', gap: 12, marginTop: 8,
};
const padStyle: React.CSSProperties = {
  height: 80, width: 80, borderRadius: 999, background: '#fff',
  border: '1px solid #e6e6e6', fontSize: 26, fontWeight: 600, color: '#111', cursor: 'pointer',
};
const errorStyle: React.CSSProperties = { color: '#b00020', fontSize: 13, marginTop: 4 };
