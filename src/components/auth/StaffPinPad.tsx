'use client';

/**
 * Themed PIN numpad. Shared between /signin and the FAB SwitchStaffSheet.
 *
 * Auto-submits on the 6th digit. Renders a passkey button when the staff has
 * passkeys registered (caller toggles `enablePasskey`). Keep callers thin —
 * this component owns the dots row, the numpad, and the submit button.
 */

import { useCallback, useState } from 'react';
import { getStaffTheme, getStaffColorHex, type StationTheme } from '@/utils/staff-colors';

interface StaffPinPadProps {
  staff: { id: number; name: string; role: string; color_hex?: string };
  /** Submit handler. Resolve/reject controls error display + re-entry. */
  onSubmit: (pin: string) => Promise<{ ok: true } | { ok: false; error?: string }>;
  /** Optional passkey shortcut, e.g. /signin's passkey button. */
  onPasskey?: () => Promise<void>;
  /** Optional label override for the submit button. */
  submitLabel?: string;
  /** Tap to go back to the picker. */
  onBack?: () => void;
  /** Initial error to display (e.g. after a router refresh). */
  initialError?: string | null;
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
}

const THEME_NUMPAD: Record<StationTheme, {
  primaryBg: string;
  primaryHover: string;
  dotActive: string;
  accentText: string;
  haloFrom: string;
  passkeyHover: string;
  ring: string;
}> = {
  green:     { primaryBg: 'bg-emerald-600',  primaryHover: 'hover:bg-emerald-700', dotActive: 'bg-emerald-600',  accentText: 'text-emerald-700',  haloFrom: 'from-emerald-200/60',  passkeyHover: 'hover:bg-emerald-50',  ring: 'focus:ring-emerald-500/30' },
  blue:      { primaryBg: 'bg-blue-600',     primaryHover: 'hover:bg-blue-700',    dotActive: 'bg-blue-600',     accentText: 'text-blue-700',     haloFrom: 'from-blue-200/60',     passkeyHover: 'hover:bg-blue-50',     ring: 'focus:ring-blue-500/30' },
  purple:    { primaryBg: 'bg-purple-600',   primaryHover: 'hover:bg-purple-700',  dotActive: 'bg-purple-600',   accentText: 'text-purple-700',   haloFrom: 'from-purple-200/60',   passkeyHover: 'hover:bg-purple-50',   ring: 'focus:ring-purple-500/30' },
  yellow:    { primaryBg: 'bg-amber-500',    primaryHover: 'hover:bg-amber-600',   dotActive: 'bg-amber-500',    accentText: 'text-amber-700',    haloFrom: 'from-amber-200/60',    passkeyHover: 'hover:bg-amber-50',    ring: 'focus:ring-amber-500/30' },
  black:     { primaryBg: 'bg-slate-900',    primaryHover: 'hover:bg-slate-800',   dotActive: 'bg-slate-900',    accentText: 'text-slate-800',    haloFrom: 'from-slate-300/60',    passkeyHover: 'hover:bg-slate-100',   ring: 'focus:ring-slate-500/30' },
  red:       { primaryBg: 'bg-red-600',      primaryHover: 'hover:bg-red-700',     dotActive: 'bg-red-600',      accentText: 'text-red-700',      haloFrom: 'from-red-200/60',      passkeyHover: 'hover:bg-red-50',      ring: 'focus:ring-red-500/30' },
  lightblue: { primaryBg: 'bg-sky-500',      primaryHover: 'hover:bg-sky-600',     dotActive: 'bg-sky-500',      accentText: 'text-sky-700',      haloFrom: 'from-sky-200/60',      passkeyHover: 'hover:bg-sky-50',      ring: 'focus:ring-sky-500/30' },
  pink:      { primaryBg: 'bg-pink-500',     primaryHover: 'hover:bg-pink-600',    dotActive: 'bg-pink-500',     accentText: 'text-pink-700',     haloFrom: 'from-pink-200/60',     passkeyHover: 'hover:bg-pink-50',     ring: 'focus:ring-pink-500/30' },
};

export function StaffPinPad({ staff, onSubmit, onPasskey, submitLabel, onBack, initialError = null }: StaffPinPadProps) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(initialError);
  const theme = getStaffTheme(staff);
  const t = THEME_NUMPAD[theme];

  const submit = useCallback(async (rawPin?: string) => {
    const enteredPin = rawPin ?? pin;
    if (enteredPin.length < 4) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await onSubmit(enteredPin);
      if (!r.ok) {
        setErr(r.error || 'Sign-in failed. Try again.');
        setPin('');
      }
    } finally {
      setBusy(false);
    }
  }, [pin, onSubmit]);

  const press = useCallback((digit: string) => {
    setErr(null);
    setPin((prev) => {
      if (prev.length >= 6) return prev;
      const next = prev + digit;
      if (next.length === 6) setTimeout(() => void submit(next), 30);
      return next;
    });
  }, [submit]);

  return (
    <div className="flex flex-col items-center">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white/80 px-3 py-1.5 text-xs font-medium text-gray-600 backdrop-blur transition-all hover:border-gray-300 hover:bg-white hover:text-gray-900"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
          Not you?
        </button>
      )}

      <div className="relative">
        <div className={`absolute -inset-3 rounded-full bg-gradient-radial ${t.haloFrom} to-transparent blur-2xl opacity-70`} aria-hidden />
        <div
          className="relative flex h-20 w-20 items-center justify-center rounded-full text-2xl font-bold text-white shadow-lg shadow-gray-900/10 ring-4 ring-white"
          style={{ backgroundColor: getStaffColorHex(staff) }}
        >
          {initials(staff.name)}
        </div>
      </div>
      <div className="mt-5 text-[24px] font-semibold tracking-tight text-gray-900">{staff.name}</div>
      <div className={`mt-0.5 text-[11px] font-medium uppercase tracking-[0.18em] ${t.accentText}`}>
        {staff.role.replace(/_/g, ' ')}
      </div>
      <div className="mt-4 text-[13px] text-gray-500">Enter your PIN</div>

      <div className="mt-5 flex gap-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className={`h-3 w-3 rounded-full transition-all duration-200 ${
              i < pin.length ? `${t.dotActive} scale-110` : 'bg-gray-200 scale-100'
            }`}
          />
        ))}
      </div>

      {err && (
        <div className="mt-4 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700">
          {err}
        </div>
      )}

      <div className="mt-6 grid grid-cols-3 gap-3">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <Key key={d} value={d} disabled={busy} onClick={() => press(d)} theme={theme} />
        ))}
        {onPasskey ? (
          <Key
            value=""
            disabled={busy}
            onClick={() => { setErr(null); void onPasskey().catch((e) => setErr(e instanceof Error ? e.message : 'Passkey failed.')); }}
            theme={theme}
            ariaLabel="Sign in with passkey"
            icon={(
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="6.5" r="3.5"/>
                <path d="M12 10v11"/>
                <path d="M12 16h3"/>
                <path d="M12 19h2"/>
              </svg>
            )}
          />
        ) : (
          <span aria-hidden />
        )}
        <Key value="0" disabled={busy} onClick={() => press('0')} theme={theme} />
        <Key
          value=""
          disabled={busy || pin.length === 0}
          onClick={() => setPin((p) => p.slice(0, -1))}
          theme={theme}
          ariaLabel="Backspace"
          icon={(
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 5H8l-7 7 7 7h13a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z"/>
              <line x1="18" y1="9" x2="12" y2="15"/>
              <line x1="12" y1="9" x2="18" y2="15"/>
            </svg>
          )}
        />
      </div>

      <button
        type="button"
        disabled={busy || pin.length < 4}
        onClick={() => void submit()}
        className={`mt-6 inline-flex h-12 w-72 items-center justify-center rounded-2xl ${t.primaryBg} ${t.primaryHover} text-[15px] font-semibold text-white shadow-lg shadow-gray-900/15 transition-all hover:shadow-xl hover:shadow-gray-900/20 disabled:cursor-not-allowed disabled:opacity-50`}
      >
        {busy ? 'Signing in…' : (submitLabel ?? 'Sign in')}
      </button>
    </div>
  );
}

interface KeyProps {
  value: string;
  onClick: () => void;
  disabled?: boolean;
  theme: StationTheme;
  ariaLabel?: string;
  icon?: React.ReactNode;
}

function Key({ value, onClick, disabled, theme, ariaLabel, icon }: KeyProps) {
  const t = THEME_NUMPAD[theme];
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={ariaLabel || value}
      className={`group flex h-16 w-20 items-center justify-center rounded-2xl border border-gray-200 bg-white text-[22px] font-semibold text-gray-900 shadow-sm shadow-gray-900/[0.04] transition-all duration-100 ${t.passkeyHover} hover:-translate-y-0.5 hover:shadow-md hover:shadow-gray-900/[0.08] active:scale-95 active:shadow-none focus:outline-none focus:ring-4 ${t.ring} disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-sm`}
    >
      {icon ? <span className={t.accentText}>{icon}</span> : value}
    </button>
  );
}
