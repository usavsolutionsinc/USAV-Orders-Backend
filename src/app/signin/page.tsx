'use client';

/**
 * /signin — public sign-in screen.
 *
 * Step 1: pick yourself from the row-layout staff picker (StaffPickerList).
 * Step 2: enter your PIN on the themed numpad (StaffPinPad).
 *
 * Both UI bricks live in `src/components/auth/` so the FAB SwitchStaffSheet
 * shares them — one implementation, one set of staff colors, one polish pass.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { startAuthentication } from '@simplewebauthn/browser';
import QRCode from 'react-qr-code';
import { StaffPickerList, type StaffPickerRow } from '@/components/auth/StaffPickerList';
import { StaffPinPad } from '@/components/auth/StaffPinPad';
import { SetPinPad } from '@/components/auth/SetPinPad';
import { useAuth } from '@/contexts/AuthContext';

const RECENT_KEY = 'usav.recentSignins';
const MAX_RECENT = 3;

function readRecent(): number[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((n): n is number => typeof n === 'number');
  } catch { return []; }
}

function writeRecent(staffId: number): void {
  try {
    const prev = readRecent().filter((n) => n !== staffId);
    const next = [staffId, ...prev].slice(0, MAX_RECENT);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* ignore */ }
}

const ROLE_HOME: Record<string, string> = {
  admin: '/dashboard',
  receiver: '/receiving',
  receiving: '/receiving',
  packer: '/packer',
  technician: '/tech',
  shipper: '/dashboard',
  inventory_manager: '/sku-stock',
  sales: '/dashboard',
  viewer: '/dashboard',
  readonly: '/dashboard',
};

function humanError(code: string | undefined): string {
  switch (code) {
    case 'WRONG':              return 'PIN incorrect. Try again.';
    case 'LOCKED':             return 'Too many tries. Locked for 5 minutes.';
    case 'NO_PIN':             return 'This account has no PIN. Ask an admin for an enrollment QR.';
    case 'NOT_FOUND':          return 'Account not found.';
    case 'TOO_SHORT':          return 'PIN is too short.';
    case 'TOO_LONG':           return 'PIN is too long.';
    case 'NOT_NUMERIC':        return 'PIN must be digits only.';
    case 'ACCOUNT_NOT_ACTIVE': return 'Account is not active. Ask an admin.';
    case 'VERIFY_FAILED':      return 'Passkey verification failed.';
    case 'WEAK_PIN':           return 'Pick something less obvious — no 0000, 1111, 1234, etc.';
    case 'PIN_ALREADY_SET':    return 'This account already has a PIN. Tap "Not you?" and pick again.';
    default:                   return 'Sign-in failed. Try again.';
  }
}

export default function SignInPage() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') || '';
  const { refresh: refreshAuth } = useAuth();
  const [picked, setPicked] = useState<StaffPickerRow | null>(null);
  const [pickerMessage, setPickerMessage] = useState<string | null>(null);
  const [recent, setRecent] = useState<number[]>([]);
  const [showPhoneQr, setShowPhoneQr] = useState(false);
  // "Keep me signed in" — promotes the session to `personal` deviceKind
  // (12hr idle / 30d absolute). Default off: a shared workstation should
  // sign out reasonably soon. Personal laptops should tick this.
  const [rememberMe, setRememberMe] = useState(false);

  useEffect(() => { setRecent(readRecent()); }, []);

  const finish = useCallback(async (staffId: number, role: string | null | undefined) => {
    writeRecent(staffId);
    // Hydrate AuthContext with the new session BEFORE navigating. Without this,
    // the still-null user state in AuthContext sees the next non-public route
    // and immediately bounces us back to /signin (the "second sign-in loop").
    await refreshAuth();
    const home = role ? ROLE_HOME[role.toLowerCase()] : '/dashboard';
    router.replace(next || home || '/dashboard');
  }, [router, next, refreshAuth]);

  const submitPin = useCallback(async (pin: string) => {
    if (!picked) return { ok: false as const, error: 'INTERNAL' };
    const r = await fetch('/api/auth/signin', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        staffId: picked.id,
        pin,
        deviceKind: rememberMe ? 'personal' : 'station',
      }),
    });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      return { ok: false as const, error: humanError((data as { error?: string }).error) };
    }
    await finish(picked.id, picked.role);
    return { ok: true as const };
  }, [picked, finish, rememberMe]);

  const submitCreatePin = useCallback(async (pin: string) => {
    if (!picked) return { ok: false as const, error: 'INTERNAL' };
    const r = await fetch('/api/auth/pin/create', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        staffId: picked.id,
        pin,
        deviceKind: rememberMe ? 'personal' : 'station',
      }),
    });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      return { ok: false as const, error: humanError((data as { error?: string }).error) };
    }
    await finish(picked.id, picked.role);
    return { ok: true as const };
  }, [picked, finish, rememberMe]);

  const submitPasskey = useCallback(async () => {
    if (!picked) return;
    const beginRes = await fetch('/api/auth/passkey/authenticate/begin', {
      method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ staffId: picked.id }),
    });
    if (!beginRes.ok) throw new Error('Passkey not available.');
    const begin = await beginRes.json() as { options: Parameters<typeof startAuthentication>[0]['optionsJSON'] };
    const assertion = await startAuthentication({ optionsJSON: begin.options });
    const finishRes = await fetch('/api/auth/passkey/authenticate/finish', {
      method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ response: assertion, deviceKind: 'personal' }),
    });
    if (!finishRes.ok) {
      const data = await finishRes.json().catch(() => ({}));
      throw new Error(humanError((data as { error?: string }).error));
    }
    await finish(picked.id, picked.role);
  }, [picked, finish]);

  return (
    <Shell>
      {picked ? (
        <div className="flex w-full max-w-md flex-col items-center gap-5">
          {picked.has_pin ? (
            <StaffPinPad
              staff={picked}
              onSubmit={submitPin}
              onPasskey={submitPasskey}
              onBack={() => setPicked(null)}
            />
          ) : (
            <SetPinPad
              staff={picked}
              onSubmit={submitCreatePin}
              onBack={() => setPicked(null)}
            />
          )}
          <RememberMeToggle checked={rememberMe} onChange={setRememberMe} />
          <button
            type="button"
            onClick={() => setShowPhoneQr(true)}
            className="group inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white/70 px-4 py-2 text-[12px] font-medium text-gray-600 shadow-sm shadow-gray-900/[0.03] backdrop-blur transition-all hover:border-gray-300 hover:bg-white hover:text-gray-900"
          >
            <PhoneQrIcon />
            Use your phone to sign in
          </button>
        </div>
      ) : (
        <div className="w-full max-w-md">
          <div className="text-center">
            <h1 className="text-[28px] font-semibold tracking-tight text-gray-900">Sign in</h1>
            <p className="mt-1.5 text-[13px] text-gray-500">Tap your name to continue.</p>
          </div>
          <div className="mt-8">
            <StaffPickerList
              recent={recent}
              onPick={setPicked}
              onMessage={setPickerMessage}
            />
            {pickerMessage && (
              <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                {pickerMessage}
              </div>
            )}
            <div className="mt-6 flex justify-center">
              <button
                type="button"
                onClick={() => setShowPhoneQr(true)}
                className="group inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white/70 px-4 py-2 text-[12px] font-medium text-gray-600 shadow-sm shadow-gray-900/[0.03] backdrop-blur transition-all hover:border-gray-300 hover:bg-white hover:text-gray-900"
              >
                <PhoneQrIcon />
                Use your phone to sign in
              </button>
            </div>
          </div>
        </div>
      )}
      {showPhoneQr && <PhoneSigninQrPopover onClose={() => setShowPhoneQr(false)} />}
    </Shell>
  );
}

function PhoneSigninQrPopover({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState<string>('');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setUrl(`${window.location.origin}/m/signin`);
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Sign in with your phone"
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm transition-opacity"
      />
      <div className="relative w-full max-w-sm rounded-3xl border border-gray-200 bg-white p-7 shadow-2xl shadow-gray-900/20">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M6 6l12 12" /><path d="M18 6L6 18" />
          </svg>
        </button>

        <div className="text-center">
          <div className="mx-auto inline-flex items-center justify-center rounded-full bg-slate-900/95 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white">
            Phone sign-in
          </div>
          <h2 className="mt-3 text-[19px] font-semibold tracking-tight text-gray-900">
            Scan to sign in on your phone
          </h2>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-gray-500">
            Point your phone camera at the code. After your PIN, you can enable Face ID for one-tap sign-in next time.
          </p>
        </div>

        <div className="mt-5 flex justify-center">
          <div className="rounded-2xl border border-gray-200 bg-white p-3 shadow-inner shadow-gray-900/[0.03]">
            {url ? (
              <QRCode value={url} size={196} level="M" />
            ) : (
              <div className="h-[196px] w-[196px] animate-pulse rounded-lg bg-gray-100" />
            )}
          </div>
        </div>

        <ol className="mt-5 space-y-2 text-[12.5px] text-gray-600">
          <Step n={1}>Open your phone&apos;s camera and aim at the code.</Step>
          <Step n={2}>Tap the link, pick your name, enter your PIN.</Step>
          <Step n={3}>Enable Face ID to skip the PIN next time.</Step>
        </ol>

        <div className="mt-5 break-all rounded-lg bg-gray-50 px-3 py-2 text-center text-[10.5px] font-mono text-gray-500">
          {url || ' '}
        </div>
      </div>
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="mt-[1px] inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-slate-900 text-[9px] font-bold text-white">
        {n}
      </span>
      <span>{children}</span>
    </li>
  );
}

interface RememberMeToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
}

/**
 * Toggle that promotes the session to the long-lived `personal` deviceKind
 * (12hr idle / 30d absolute) instead of the default `station` window. Designed
 * to be unmissable on personal laptops but visually unobtrusive on shared
 * workstations where it should stay unchecked.
 */
function RememberMeToggle({ checked, onChange }: RememberMeToggleProps) {
  return (
    <label className="group inline-flex cursor-pointer items-center gap-3 rounded-full border border-gray-200 bg-white/80 px-4 py-2 text-[12px] font-medium text-gray-600 shadow-sm shadow-gray-900/[0.03] backdrop-blur transition-all hover:border-gray-300 hover:text-gray-900">
      <span
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
          checked ? 'bg-slate-900' : 'bg-gray-300'
        }`}
        aria-hidden
      >
        <span
          className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
            checked ? 'translate-x-[18px]' : 'translate-x-[2px]'
          }`}
        />
      </span>
      <span className="flex flex-col leading-tight">
        <span>Keep me signed in</span>
        <span className="text-[10.5px] text-gray-400 group-hover:text-gray-500">
          30 days on this device — uncheck on shared computers
        </span>
      </span>
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

function PhoneQrIcon() {
  return (
    <svg className="h-3.5 w-3.5 text-gray-400 transition-colors group-hover:text-gray-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3h-3z" /><path d="M20 14v3" /><path d="M14 20h3" /><path d="M20 20v1" />
    </svg>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 overflow-y-auto bg-gradient-to-b from-gray-50 via-white to-gray-50 antialiased">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.025]"
        style={{
          backgroundImage: 'radial-gradient(circle at 1px 1px, #000 1px, transparent 0)',
          backgroundSize: '24px 24px',
        }}
        aria-hidden
      />
      <div className="relative flex min-h-full flex-col items-center justify-start px-6 pt-16 pb-24 sm:pt-24">
        {children}
      </div>
    </div>
  );
}
