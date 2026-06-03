'use client';

import Link from 'next/link';
import { Settings } from '@/components/Icons';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/queries/keys';
import { ActionsSection } from './ActionsSection';
import { DesktopAppInstallBanner } from './DesktopAppInstallBanner';
import { PinnedSection } from './PinnedSection';
import { RecentSection } from './RecentSection';
import { useQuickAccess } from '@/lib/quick-access/use-quick-access';
import { useAuth } from '@/contexts/AuthContext';
import { getStaffColorHex } from '@/utils/staff-colors';
import { useStaffColorVersion } from '@/contexts/StaffColorsProvider';

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
}

interface QuickAccessPopoverProps {
  onClose: () => void;
  onOpenHistoryPopover: () => void;
  onOpenInboxPopover: () => void;
}

/**
 * Body order: common-pages chips → actions → pinned → recent.
 * The signed-in staff card lives at the very bottom, just above the
 * "Manage in Settings" footer, with sign-out only (no staff switch).
 */
export function QuickAccessPopover({ onClose, onOpenHistoryPopover, onOpenInboxPopover }: QuickAccessPopoverProps) {
  const { settings } = useQuickAccess();
  const router = useRouter();
  const { user, signOut } = useAuth();

  const queryClient = useQueryClient();
  // Subscribes to the module-level color cache. When self or admin updates
  // a color, this hook bumps and the avatar + wheel re-render with the new hex.
  useStaffColorVersion();

  const [staffName, setStaffName] = useState<string>('');
  useEffect(() => {
    if (!user) { setStaffName(''); return; }
    let cancelled = false;
    fetch(`/api/staff?id=${user.staffId}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { staff?: { name?: string } } | null) => {
        if (!cancelled && data?.staff?.name) setStaffName(data.staff.name);
      })
      .catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, [user]);

  const staffColorHex = user ? getStaffColorHex({ id: user.staffId }) : '#10b981';

  // Self-serve color update — staff can change their own identity color from
  // the FAB without admin access. PUT /api/staff with own id + new hex;
  // invalidate ['staff'] so StaffColorsProvider refreshes the cache → every
  // staff-colored surface in the app re-renders.
  const updateColorMutation = useMutation({
    mutationFn: async (hex: string) => {
      if (!user) return null;
      const r = await fetch('/api/staff', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: user.staffId, color_hex: hex }),
      });
      if (!r.ok) throw new Error('Failed to update color');
      return r.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.staff.all });
    },
  });

  return (
    <div
      role="dialog"
      aria-label="Quick access"
      className="flex max-h-[calc(100vh-6rem)] w-[340px] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl"
    >
      <div className="min-h-0 flex-1 divide-y divide-gray-100 overflow-y-auto overscroll-contain">
        <ActionsSection
          actions={settings.actions}
          onAction={onClose}
          onOpenHistoryPopover={onOpenHistoryPopover}
          onOpenInboxPopover={onOpenInboxPopover}
        />
        <PinnedSection onNavigate={onClose} />
        {settings.showRecent && <RecentSection onNavigate={onClose} />}
      </div>

      {/* Bright "Install desktop app" CTA — only renders when viewing in a
          browser (not Electron) and the user hasn't disabled it in settings. */}
      {settings.actions.installDesktopApp !== false && (
        <DesktopAppInstallBanner onAction={onClose} />
      )}

      {/* Staff sign-in section — moved to the bottom, just above the footer. */}
      {user ? (
        <div className="flex shrink-0 items-center gap-3 border-t border-gray-100 bg-gray-50/60 px-4 py-3">
          <SelfColorWheel
            value={staffColorHex}
            initials={staffName ? initials(staffName) : '·'}
            disabled={updateColorMutation.isPending}
            onChange={(hex) => updateColorMutation.mutate(hex)}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-gray-900">{staffName || `Staff #${user.staffId}`}</div>
            <div className="truncate text-micro font-medium uppercase tracking-[0.14em] text-gray-500">{user.role.replace(/_/g, ' ')}</div>
          </div>
          <Link
            href="/settings?section=quick-access"
            onClick={onClose}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 transition hover:bg-white hover:text-gray-900"
            aria-label="Manage in Settings"
            title="Manage in Settings"
          >
            <Settings className="h-3.5 w-3.5" />
          </Link>
          <button
            type="button"
            onClick={() => { void signOut(); }}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 transition hover:bg-white hover:text-gray-900"
            aria-label="Sign out"
            title="Sign out"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => { onClose(); router.push('/signin'); }}
          className="flex shrink-0 items-center justify-between border-t border-gray-100 bg-gray-50/60 px-4 py-3 text-left transition hover:bg-gray-100"
        >
          <span className="text-sm font-semibold text-gray-900">Sign in</span>
          <span className="text-caption text-gray-500">Pick a staff →</span>
        </button>
      )}
    </div>
  );
}

export default QuickAccessPopover;

/**
 * Avatar circle that doubles as a color-wheel trigger for the signed-in
 * staff. Tapping anywhere on the avatar opens the native OS color picker
 * (which presents a wheel/spectrum) — on change the parent mutation persists
 * to /api/staff so all surfaces (sidebar, picker, FAB) snap to the new hue.
 *
 * A conic-gradient hue ring around the avatar hints that it's interactive,
 * without dominating the chrome.
 */
function SelfColorWheel({
  value, initials, disabled, onChange,
}: {
  value: string;
  initials: string;
  disabled?: boolean;
  onChange: (hex: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => inputRef.current?.click()}
      aria-label={`Change my color (current ${value})`}
      title="Tap to change your color"
      className="group relative flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full p-[5px] shadow-lg shadow-gray-900/15 transition hover:scale-105 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-gray-900/40 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      style={{
        background:
          'conic-gradient(from 90deg, #ef4444, #f59e0b, #eab308, #22c55e, #10b981, #06b6d4, #3b82f6, #6366f1, #a855f7, #ec4899, #ef4444)',
      }}
    >
      {/* Inner avatar — white ring separates it from the conic hue ring */}
      <span
        className="relative flex h-full w-full items-center justify-center rounded-full text-sm font-bold text-white ring-2 ring-white"
        style={{ backgroundColor: value }}
      >
        {initials}
        {/* Tiny pencil hint in the corner — appears on hover, hints "editable" */}
        <span
          className="absolute -right-0.5 -bottom-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-white text-gray-700 shadow ring-1 ring-gray-200 transition group-hover:scale-110"
          aria-hidden
        >
          <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
          </svg>
        </span>
      </span>
      <input
        ref={inputRef}
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="absolute inset-0 cursor-pointer opacity-0"
        aria-hidden
      />
    </button>
  );
}
