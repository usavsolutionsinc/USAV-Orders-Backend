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
import { flushSync } from 'react-dom';
import { useRouter, useSearchParams } from 'next/navigation';
import { startAuthentication } from '@simplewebauthn/browser';
import QRCode from 'react-qr-code';
import { StaffPickerList, type StaffPickerRow } from '@/components/auth/StaffPickerList';
import { StaffPinPad } from '@/components/auth/StaffPinPad';
import { StaffSigningIn } from '@/components/auth/StaffSigningIn';
import { SetPinPad } from '@/components/auth/SetPinPad';
import { BootSplash } from '@/components/boot/BootSplash';
import { armBootSplash } from '@/lib/boot-flag';
import { IconButton } from '@/design-system/primitives';
import { readRecentSignins, writeRecentSignin } from '@/lib/auth/recent-signins';

const ROLE_HOME: Record<string, string> = {
  admin: '/dashboard',
  receiver: '/receiving',
  receiving: '/receiving',
  packer: '/packer',
  technician: '/tech',
  shipper: '/dashboard',
  inventory_manager: '/inventory',
  sales: '/dashboard',
  viewer: '/dashboard',
  readonly: '/dashboard',
};

/**
 * Mobile-device equivalent of ROLE_HOME. Used when signin completes on a
 * phone/tablet — receivers and packers land in their single-purpose
 * camera flows, everyone else lands on the mobile homepage hub. The
 * desktop ROLE_HOME map is unchanged.
 */
const MOBILE_ROLE_HOME: Record<string, string> = {
  receiver: '/m/receiving',
  receiving: '/m/receiving',
  packer: '/m/pick',
  // All other roles fall through to /m/home (the catch-all below).
};

/** UA / Client Hints check matching {@link detectMobileDevice} in _ui.ts. */
function isMobileDevice(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const uaData = (navigator as unknown as { userAgentData?: { mobile?: boolean } }).userAgentData;
  if (uaData && typeof uaData.mobile === 'boolean') return uaData.mobile;
  return /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

function humanError(code: string | undefined): string {
  switch (code) {
    case 'WRONG':              return 'PIN incorrect. Try again.';
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
  const [picked, setPicked] = useState<StaffPickerRow | null>(null);
  const [pickerMessage, setPickerMessage] = useState<string | null>(null);
  const [recent, setRecent] = useState<number[]>([]);
  // `recent` hydrates from localStorage in an effect (a render-time read would
  // mismatch SSR). recentReady gates the picker so the "Recent" group is part
  // of the first interactive frame instead of popping in and re-grouping rows.
  const [recentReady, setRecentReady] = useState(false);
  const [showPhoneQr, setShowPhoneQr] = useState(false);
  // "Keep me signed in" — promotes the session to `personal` deviceKind
  // (12hr idle / 30d absolute). Default off: a shared workstation should
  // sign out reasonably soon. Personal laptops should tick this.
  const [rememberMe, setRememberMe] = useState(false);
  // Pinless rollout flag, surfaced by the staff-picker endpoint. When true,
  // tapping a name signs the staff in immediately — no PIN pad shown.
  const [pinless, setPinless] = useState(false);
  // Set once a sign-in is committed (auth succeeded, navigation imminent). Shows
  // the full-screen "Loading your workspace" BootSplash — the same animation the
  // dashboard's BootGate uses — over EVERYTHING until the hard navigation swaps
  // the document, then hands off to the destination's identical BootSplash so the
  // transition is seamless. Never reset: the page is about to be replaced by the
  // hard navigation.
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => { setRecent(readRecentSignins()); setRecentReady(true); }, []);

  /**
   * Resolves the landing route. Four-step chain (first match wins):
   *   1. ?next= query param (came from a deep link — keep them there)
   *   2. Per-staff override:
   *        - on mobile devices → defaultHomePathMobile
   *        - on desktop        → defaultHomePath
   *      Each is independent: a staffer can have a desktop override and no
   *      mobile override (or vice-versa).
   *   3. ROLE_HOME[role] (desktop) / MOBILE_ROLE_HOME[role] (mobile)
   *   4. /dashboard or /m/home (final fallback)
   *
   * We use window.location.assign instead of router.replace as the final
   * step. router.replace is an SPA navigation that re-uses the existing
   * React tree, which means the AuthContext provider (and every cached
   * RSC) carries forward — sidebar permissions / dashboard data / cached
   * chunks would be stale. A hard navigation gives every consumer a fresh
   * tree, and the destination re-reads the session cookie server-side
   * (getInitialAuthUser in app/layout.tsx), so the new tree hydrates with
   * the signed-in user without a client-side auth refresh here. This
   * eliminates the "first click doesn't work, refresh-then-click does" bugs.
   */
  const finish = useCallback(async (
    staffId: number,
    role: string | null | undefined,
    defaultHomePath: string | null | undefined,
    defaultHomePathMobile: string | null | undefined,
  ) => {
    // Show the workspace-loading splash and commit it synchronously (flushSync)
    // so the browser paints it before the hard navigation, and so it covers the
    // picker right through document swap.
    //
    // We deliberately do NOT call refreshAuth() here. finish() always ends in a
    // hard `window.location.assign(...)`, and the destination re-reads the
    // session cookie server-side (getInitialAuthUser in app/layout.tsx), so the
    // fresh tree already hydrates with the signed-in user. Calling refreshAuth()
    // instead mutated the global auth user on THIS (about-to-be-discarded) page,
    // which remounted the sign-in subtree — resetting local state and flashing
    // the staff picker back in for a beat before navigation. Dropping it removes
    // both that flicker and a wasted /api/auth/session round-trip.
    flushSync(() => setSigningIn(true));
    writeRecentSignin(staffId);
    const onMobile = isMobileDevice();
    const normalizedRole = role ? role.toLowerCase() : '';
    const roleHome = normalizedRole
      ? onMobile
        ? MOBILE_ROLE_HOME[normalizedRole] ?? '/m/home'
        : ROLE_HOME[normalizedRole]
      : null;
    const fallback = onMobile ? '/m/home' : '/dashboard';
    const override = onMobile ? defaultHomePathMobile : defaultHomePath;
    const target = next || override || roleHome || fallback;
    // Arm the one-shot loading splash when we're landing on a route that has a
    // BootGate (currently the dashboard). The gate reads-and-clears the flag to
    // hold a single animation while it warms the page's data, so the user sees
    // a finished page instead of each table streaming in. Hard navigation only
    // — sessionStorage survives the document load but not a later refresh.
    if (target.startsWith('/dashboard')) armBootSplash();
    if (typeof window !== 'undefined') {
      window.location.assign(target);
    } else {
      // SSR fallback (should never hit since this is a client callback).
      router.replace(target);
    }
  }, [router, next]);

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
    const data = await r.json().catch(() => ({}));
    const d = data as { defaultHomePath?: string | null; defaultHomePathMobile?: string | null };
    await finish(picked.id, picked.role, d.defaultHomePath, d.defaultHomePathMobile);
    return { ok: true as const };
  }, [picked, finish, rememberMe]);

  // Pinless rollout: tapping a name skips the PIN pad and signs in directly.
  // Failures surface in the picker message area instead of an inline PinPad
  // (no pad is mounted to display them).
  const submitPinless = useCallback(async (row: StaffPickerRow) => {
    const r = await fetch('/api/auth/signin', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        staffId: row.id,
        deviceKind: rememberMe ? 'personal' : 'station',
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      setPickerMessage(humanError((data as { error?: string }).error));
      setPicked(null);
      return;
    }
    const d = data as { defaultHomePath?: string | null; defaultHomePathMobile?: string | null };
    await finish(row.id, row.role, d.defaultHomePath, d.defaultHomePathMobile);
  }, [finish, rememberMe]);

  const handlePick = useCallback((row: StaffPickerRow) => {
    // Always leave the picker on first tap. Pinless sign-in used to call the
    // API with the picker still mounted; finish() wrote recents to localStorage
    // before navigation, so a re-render could flash the name under "Recent"
    // instead of going straight in.
    setPicked(row);
    if (pinless) void submitPinless(row);
  }, [pinless, submitPinless]);

  // Stable identity so StaffPickerList's load effect isn't re-triggered (which
  // would re-fetch and re-render the list on every parent render).
  const handlePolicy = useCallback((p: { pinless: boolean }) => setPinless(p.pinless), []);

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
    const data = await r.json().catch(() => ({}));
    const d = data as { defaultHomePath?: string | null; defaultHomePathMobile?: string | null };
    await finish(picked.id, picked.role, d.defaultHomePath, d.defaultHomePathMobile);
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
    const data = await finishRes.json().catch(() => ({}));
    const d = data as { defaultHomePath?: string | null; defaultHomePathMobile?: string | null };
    await finish(picked.id, picked.role, d.defaultHomePath, d.defaultHomePathMobile);
  }, [picked, finish]);

  // Once a sign-in is committed, show only the workspace-loading splash. It is
  // `fixed inset-0 z-splash`, so it covers the picker / PIN pad / "Signing in
  // as" card underneath and stays up until the hard navigation replaces the
  // document — then the destination's own BootSplash takes over seamlessly.
  if (signingIn) return <BootSplash />;

  return (
    <Shell>
      {picked ? (
        pinless ? (
          <StaffSigningIn staff={picked} />
        ) : (
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
            {/* ds-raw-button: bespoke backdrop-blur pill with group-hover icon recolor — not a DS Button variant */}
            <button
              type="button"
              onClick={() => setShowPhoneQr(true)}
              className="group inline-flex items-center gap-2 rounded-full border border-border-soft bg-surface-card/70 px-4 py-2 text-label font-medium text-text-muted shadow-sm shadow-gray-900/[0.03] backdrop-blur transition-all hover:border-border-default hover:bg-surface-card hover:text-text-default"
            >
              <PhoneQrIcon />
              Use your phone to sign in
            </button>
          </div>
        )
      ) : (
        <div className="w-full max-w-md">
          <div className="text-center">
            <h1 className="text-3xl font-semibold tracking-tight text-text-default">Sign in</h1>
            <p className="mt-1.5 text-sm text-text-soft">Tap your name to continue.</p>
          </div>
          <div className="mt-8">
            <StaffPickerList
              recent={recent}
              recentReady={recentReady}
              onPick={handlePick}
              onMessage={setPickerMessage}
              onPolicy={handlePolicy}
            />
            {pickerMessage && (
              <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                {pickerMessage}
              </div>
            )}
            <div className="mt-6 flex justify-center">
              {/* ds-raw-button: bespoke backdrop-blur pill with group-hover icon recolor — not a DS Button variant */}
              <button
                type="button"
                onClick={() => setShowPhoneQr(true)}
                className="group inline-flex items-center gap-2 rounded-full border border-border-soft bg-surface-card/70 px-4 py-2 text-label font-medium text-text-muted shadow-sm shadow-gray-900/[0.03] backdrop-blur transition-all hover:border-border-default hover:bg-surface-card hover:text-text-default"
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
      className="fixed inset-0 z-modal flex items-center justify-center px-4"
    >
      {/* ds-raw-button: full-bleed modal scrim/overlay dismiss target, not a DS Button */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm transition-opacity"
      />
      <div className="relative w-full max-w-sm rounded-3xl border border-border-soft bg-surface-card p-7 shadow-2xl shadow-gray-900/20">
        <IconButton
          type="button"
          onClick={onClose}
          ariaLabel="Close"
          className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full hover:bg-surface-sunken"
          icon={
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M6 6l12 12" /><path d="M18 6L6 18" />
            </svg>
          }
        />

        <div className="text-center">
          <div className="mx-auto inline-flex items-center justify-center rounded-full bg-slate-900/95 px-3 py-1 text-micro font-semibold uppercase tracking-[0.18em] text-white">
            Phone sign-in
          </div>
          <h2 className="mt-3 text-lg font-semibold tracking-tight text-text-default">
            Scan to sign in on your phone
          </h2>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-text-soft">
            Point your phone camera at the code. After your PIN, you can enable Face ID for one-tap sign-in next time.
          </p>
        </div>

        <div className="mt-5 flex justify-center">
          <div className="rounded-2xl border border-border-soft bg-surface-card p-3 shadow-inner shadow-gray-900/[0.03]">
            {url ? (
              <QRCode value={url} size={196} level="M" />
            ) : (
              <div className="h-[196px] w-[196px] animate-pulse rounded-lg bg-surface-sunken" />
            )}
          </div>
        </div>

        <ol className="mt-5 space-y-2 text-[12.5px] text-text-muted">
          <Step n={1}>Open your phone&apos;s camera and aim at the code.</Step>
          <Step n={2}>Tap the link, pick your name, enter your PIN.</Step>
          <Step n={3}>Enable Face ID to skip the PIN next time.</Step>
        </ol>

        <div className="mt-5 break-all rounded-lg bg-surface-canvas px-3 py-2 text-center text-[10.5px] font-mono text-text-soft">
          {url || ' '}
        </div>
      </div>
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="mt-[1px] inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-surface-inverse text-eyebrow font-bold text-white">
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
    <label className="group inline-flex cursor-pointer items-center gap-3 rounded-full border border-border-soft bg-surface-card/80 px-4 py-2 text-label font-medium text-text-muted shadow-sm shadow-gray-900/[0.03] backdrop-blur transition-all hover:border-border-default hover:text-text-default">
      <span
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
          checked ? 'bg-surface-inverse' : 'bg-surface-strong'
        }`}
        aria-hidden
      >
        <span
          className={`inline-block h-4 w-4 rounded-full bg-surface-card shadow-sm transition-transform ${
            checked ? 'translate-x-[18px]' : 'translate-x-[2px]'
          }`}
        />
      </span>
      <span className="flex flex-col leading-tight">
        <span>Keep me signed in</span>
        <span className="text-[10.5px] text-text-faint group-hover:text-text-soft">
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
    <svg className="h-3.5 w-3.5 text-text-faint transition-colors group-hover:text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
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
