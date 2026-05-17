'use client';

/**
 * Replaces the inline <StaffSelector> dropdown that used to live in each
 * station sidebar panel. Now: a static chip showing the signed-in operator,
 * with a "Switch ↗" link that triggers the FAB's SwitchStaffSheet.
 *
 *   <ActiveStaffChip variant="default" />
 *
 * Color comes from the staff's theme (same one the FAB + station headers use).
 * Variants:
 *   - default — used inside sidebar panels (full-width, rounded card)
 *   - inline  — compact horizontal pill for cards/headers
 */

import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useStaffSwitcher } from '@/contexts/StaffSwitcherContext';
import { getStaffThemeById, stationThemeColors } from '@/utils/staff-colors';

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
}

interface ActiveStaffChipProps {
  variant?: 'default' | 'inline';
  /** Hide the "Switch" affordance (e.g. on a permanent station kiosk). */
  hideSwitch?: boolean;
}

export function ActiveStaffChip({ variant = 'default', hideSwitch = false }: ActiveStaffChipProps) {
  const { user } = useAuth();
  const { openSwitcher } = useStaffSwitcher();
  const [staffName, setStaffName] = useState<string>('');

  useEffect(() => {
    if (!user) { setStaffName(''); return; }
    let cancelled = false;
    fetch(`/api/staff?id=${user.staffId}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { staff?: { name?: string } } | null) => {
        if (!cancelled && data?.staff?.name) setStaffName(data.staff.name);
      })
      .catch(() => { /* fall back to role */ });
    return () => { cancelled = true; };
  }, [user]);

  if (!user) {
    if (variant === 'inline') {
      return (
        <a href="/signin" className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50">
          Sign in →
        </a>
      );
    }
    return (
      <a
        href="/signin"
        className="flex w-full items-center justify-between rounded-xl border border-dashed border-gray-300 bg-white px-3 py-2.5 text-left text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        <span>Not signed in</span>
        <span className="text-[11px] text-gray-500">Sign in →</span>
      </a>
    );
  }

  const theme = getStaffThemeById(user.staffId);
  const sc = stationThemeColors[theme];
  const role = user.role.replace(/_/g, ' ');

  if (variant === 'inline') {
    return (
      <button
        type="button"
        onClick={hideSwitch ? undefined : openSwitcher}
        disabled={hideSwitch}
        className={`group inline-flex items-center gap-2 rounded-full border ${sc.border} ${sc.light} px-2 py-1 text-[11px] font-semibold ${sc.text} transition ${hideSwitch ? 'cursor-default' : 'hover:bg-white hover:shadow-sm'}`}
        title={hideSwitch ? `Signed in as ${staffName || `Staff #${user.staffId}`}` : 'Switch staff'}
      >
        <span className={`flex h-5 w-5 items-center justify-center rounded-full ${sc.bg} text-[9px] font-bold text-white`}>
          {staffName ? initials(staffName) : '·'}
        </span>
        <span className="truncate">{staffName || `Staff #${user.staffId}`}</span>
        {!hideSwitch && (
          <svg className="h-3 w-3 opacity-60 transition group-hover:opacity-100" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 3h5v5"/><path d="M21 3l-7 7"/><path d="M8 21H3v-5"/><path d="M3 21l7-7"/>
          </svg>
        )}
      </button>
    );
  }

  return (
    <div className={`flex w-full items-center gap-3 rounded-xl border ${sc.border} ${sc.light} px-3 py-2.5`}>
      <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${sc.bg} text-[12px] font-bold text-white ring-4 ring-white`}>
        {staffName ? initials(staffName) : '·'}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold text-gray-900">{staffName || `Staff #${user.staffId}`}</div>
        <div className={`truncate text-[10px] font-medium uppercase tracking-[0.14em] ${sc.text}`}>{role}</div>
      </div>
      {!hideSwitch && (
        <button
          type="button"
          onClick={openSwitcher}
          className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-700 transition hover:bg-gray-50 hover:text-gray-900"
          title="Switch to another staff"
        >
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 3h5v5"/><path d="M21 3l-7 7"/><path d="M8 21H3v-5"/><path d="M3 21l7-7"/>
          </svg>
          Switch
        </button>
      )}
    </div>
  );
}
