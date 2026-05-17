'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, X } from '@/components/Icons';
import { ActionsSection } from './ActionsSection';
import { CommonPagesBar } from './CommonPagesBar';
import { DesktopAppInstallBanner } from './DesktopAppInstallBanner';
import { PinnedSection } from './PinnedSection';
import { RecentSection } from './RecentSection';
import { useQuickAccess } from '@/lib/quick-access/use-quick-access';
import { useAuth } from '@/contexts/AuthContext';
import { useStaffSwitcher } from '@/contexts/StaffSwitcherContext';
import { useUIMode } from '@/design-system/providers/UIModeProvider';
import { getStaffThemeById, stationThemeColors } from '@/utils/staff-colors';

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
}

interface QuickAccessPopoverProps {
  onClose: () => void;
  onOpenHistoryPopover: () => void;
}

/**
 * Top section: header with a ⌘K search button that opens the global
 * CommandBar via a `usav-command-bar-open` custom event.
 * Body order: common-pages chips → actions → pinned → recent.
 * The signed-in staff card now lives at the very bottom, just above the
 * "Manage in Settings" footer.
 */
export function QuickAccessPopover({ onClose, onOpenHistoryPopover }: QuickAccessPopoverProps) {
  const { settings } = useQuickAccess();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { openSwitcher } = useStaffSwitcher();
  const { isMobile } = useUIMode();
  const showSwitchStaff = settings.actions.switchStaff !== false; // default true

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

  const theme = user ? getStaffThemeById(user.staffId) : null;
  const sc = theme ? stationThemeColors[theme] : null;

  const handleOpenCommandBar = () => {
    onClose();
    // CommandBar is mounted desktop-only; the event no-ops on mobile.
    window.dispatchEvent(new CustomEvent('usav-command-bar-open'));
  };

  return (
    <div
      role="dialog"
      aria-label="Quick access"
      className="flex max-h-[calc(100vh-6rem)] w-[340px] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl"
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-100 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <p className="text-[12px] font-bold text-gray-900">Quick access</p>
        </div>
        <div className="flex items-center gap-1.5">
          {!isMobile && (
            <button
              type="button"
              onClick={handleOpenCommandBar}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] font-semibold text-gray-700 transition-colors hover:border-gray-300 hover:bg-white hover:text-gray-900"
              aria-label="Open command bar"
              title="Search the app (⌘K)"
            >
              <Search className="h-3 w-3" />
              <span>Search</span>
              <kbd className="rounded-sm bg-white px-1 font-mono text-[9px] text-gray-500 border border-gray-200">⌘K</kbd>
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-6 w-6 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      <CommonPagesBar onNavigate={onClose} />

      <div className="min-h-0 flex-1 divide-y divide-gray-100 overflow-y-auto overscroll-contain">
        <ActionsSection
          actions={settings.actions}
          onAction={onClose}
          onOpenHistoryPopover={onOpenHistoryPopover}
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
      {user && sc ? (
        <div className="flex shrink-0 items-center gap-3 border-t border-gray-100 bg-gray-50/60 px-4 py-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-full ${sc.bg} text-[12px] font-bold text-white ring-4 ring-white`}>
            {staffName ? initials(staffName) : '·'}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold text-gray-900">{staffName || `Staff #${user.staffId}`}</div>
            <div className="truncate text-[10px] font-medium uppercase tracking-[0.14em] text-gray-500">{user.role.replace(/_/g, ' ')}</div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {showSwitchStaff && (
              <button
                type="button"
                onClick={() => { onClose(); openSwitcher(); }}
                className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-700 transition hover:bg-gray-50 hover:text-gray-900"
                title="Switch to another staff"
              >
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 3h5v5"/><path d="M21 3l-7 7"/><path d="M8 21H3v-5"/><path d="M3 21l7-7"/></svg>
                Switch
              </button>
            )}
            <button
              type="button"
              onClick={() => { void signOut(); }}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition hover:bg-white hover:text-gray-900"
              aria-label="Sign out"
              title="Sign out"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => { onClose(); router.push('/signin'); }}
          className="flex shrink-0 items-center justify-between border-t border-gray-100 bg-gray-50/60 px-4 py-3 text-left transition hover:bg-gray-100"
        >
          <span className="text-[13px] font-semibold text-gray-900">Sign in</span>
          <span className="text-[11px] text-gray-500">Pick a staff →</span>
        </button>
      )}

      <footer className="shrink-0 border-t border-gray-100 bg-gray-50 px-4 py-2">
        <Link
          href="/settings?section=quick-access"
          onClick={onClose}
          className="text-[11px] font-semibold text-gray-600 hover:text-gray-900"
        >
          Manage in Settings →
        </Link>
      </footer>
    </div>
  );
}

export default QuickAccessPopover;
