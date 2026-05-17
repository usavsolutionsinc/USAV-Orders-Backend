'use client';

/**
 * Modal sheet for switching the active staff at a shared station.
 *
 *   1. Picker — same row layout as /signin (StaffPickerList)
 *   2. PIN — themed numpad for the picked staff (StaffPinPad), calls /api/auth/switch
 *
 * On success, refreshes AuthContext and re-renders server components so the
 * sidebar and any page that reads useAuth() picks up the new identity
 * without a full reload.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useStaffSwitcher } from '@/contexts/StaffSwitcherContext';
import { StaffPickerList, type StaffPickerRow } from '@/components/auth/StaffPickerList';
import { StaffPinPad } from '@/components/auth/StaffPinPad';

const RECENT_KEY = 'usav.recentSignins';

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
    const next = [staffId, ...prev].slice(0, 3);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* ignore */ }
}

function humanError(code: string | undefined): string {
  switch (code) {
    case 'WRONG':              return 'PIN incorrect. Try again.';
    case 'LOCKED':             return 'Too many tries. Locked for 5 minutes.';
    case 'NO_PIN':             return 'This account has no PIN. Ask an admin for an enrollment QR.';
    case 'NOT_FOUND':          return 'Account not found.';
    case 'TOO_SHORT':          return 'PIN is too short.';
    case 'TOO_LONG':           return 'PIN is too long.';
    case 'NOT_NUMERIC':        return 'PIN must be digits only.';
    case 'ACCOUNT_NOT_ACTIVE': return 'Account is not active.';
    default:                   return 'Switch failed. Try again.';
  }
}

export function SwitchStaffSheet() {
  const { isOpen, closeSwitcher } = useStaffSwitcher();
  const { refresh, user } = useAuth();
  const router = useRouter();
  const [picked, setPicked] = useState<StaffPickerRow | null>(null);
  const [pickerMessage, setPickerMessage] = useState<string | null>(null);

  // Reset whenever the sheet opens.
  useEffect(() => {
    if (isOpen) {
      setPicked(null);
      setPickerMessage(null);
    }
  }, [isOpen]);

  const submit = useCallback(async (pin: string) => {
    if (!picked) return { ok: false as const, error: 'INTERNAL' };
    const r = await fetch('/api/auth/switch', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        staffId: picked.id,
        pin,
        deviceKind: 'station',
      }),
    });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      return { ok: false as const, error: humanError((data as { error?: string }).error) };
    }
    writeRecent(picked.id);
    await refresh();
    router.refresh();
    closeSwitcher();
    return { ok: true as const };
  }, [picked, refresh, router, closeSwitcher]);

  if (!isOpen) return null;

  const currentStaffName = user ? `Currently signed in as staff #${user.staffId}` : 'Choose a staff member';

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center"
      onClick={closeSwitcher}
      role="dialog"
      aria-modal="true"
      aria-label="Switch staff"
    >
      <div
        className="relative max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-gradient-to-b from-gray-50 via-white to-gray-50 px-6 pb-10 pt-6 shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={closeSwitcher}
          aria-label="Close switch staff"
          className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 transition hover:bg-gray-50 hover:text-gray-900"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/></svg>
        </button>

        {picked ? (
          <StaffPinPad
            staff={picked}
            onSubmit={submit}
            onBack={() => setPicked(null)}
            submitLabel="Switch"
          />
        ) : (
          <>
            <div className="text-center">
              <h2 className="text-[22px] font-semibold tracking-tight text-gray-900">Switch staff</h2>
              <p className="mt-1 text-[12px] text-gray-500">{currentStaffName}</p>
            </div>
            <div className="mt-6">
              <StaffPickerList
                recent={readRecent()}
                onPick={(s) => { setPickerMessage(null); setPicked(s); }}
                onMessage={setPickerMessage}
              />
              {pickerMessage && (
                <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                  {pickerMessage}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
