'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Search, Inbox, Pencil } from '@/components/Icons';
import { cn } from '@/utils/_cn';
import { useAuth } from '@/contexts/AuthContext';
import { useHeader } from '@/contexts/HeaderContext';
import { useActivityInboxOptional } from '@/contexts/ActivityInboxContext';
import { QuickAccessPopover } from '@/components/quick-access/QuickAccessPopover';
import { PhoneHistoryPopover } from '@/components/quick-access/PhoneHistoryPopover';
import { ActivityInboxPopover } from '@/components/quick-access/ActivityInboxPopover';
import { getStaffThemeById, stationThemeColors } from '@/utils/staff-colors';

type OpenPopover = 'none' | 'history' | 'inbox' | 'account';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * Persistent right zone of the {@link GlobalHeader}.
 *
 * Decomposes what used to be the single bottom-right Quick Access FAB into
 * discrete header controls — search/launcher, notifications, staff switcher,
 * and account menu — each owning its own popover. The popovers themselves
 * (QuickAccessPopover, ActivityInboxPopover, PhoneHistoryPopover) are reused
 * verbatim so there's no duplicated launcher logic.
 *
 * `variant="mobile"` renders the condensed set used by the mobile dashboard
 * top bar — just the notifications inbox and the account FAB. The ⌘K search
 * (a keyboard surface) and the per-page selection pencil are desktop-only and
 * are dropped on mobile.
 */
export function GlobalHeaderActions({ variant = 'desktop' }: { variant?: 'desktop' | 'mobile' } = {}) {
  const isMobile = variant === 'mobile';
  const pathname = usePathname();
  const { user } = useAuth();
  const { selection } = useHeader();
  const inbox = useActivityInboxOptional();
  const inboxCount = inbox?.items.length ?? 0;

  const [popover, setPopover] = useState<OpenPopover>('none');
  const [staffName, setStaffName] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Staff name for the account avatar's initials (same source as the popover).
  useEffect(() => {
    if (!user) {
      setStaffName('');
      return;
    }
    let cancelled = false;
    fetch(`/api/staff?id=${user.staffId}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { staff?: { name?: string } } | null) => {
        if (!cancelled && data?.staff?.name) setStaffName(data.staff.name);
      })
      .catch(() => {
        /* fall back to the dot glyph */
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Close everything on navigation.
  useEffect(() => {
    setPopover('none');
  }, [pathname]);

  // Click-outside closes any open popover.
  useEffect(() => {
    if (popover === 'none') return;
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setPopover('none');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [popover]);

  if (!user) return null;

  const inboxOpen = popover === 'inbox';
  const accountOpen = popover === 'account';
  const popoverPos = 'absolute right-0 top-full mt-1 z-50';

  const sc = stationThemeColors[getStaffThemeById(user.staffId)];

  return (
    <div ref={wrapperRef} className="flex items-center gap-2">
      {/* Selection toggle — registered per page via usePageSelection(). A
          pencil that flips the active surface into select mode. */}
      {!isMobile && selection && (
        <button
          type="button"
          onClick={selection.onToggle}
          aria-pressed={selection.active}
          aria-label={selection.active ? 'Done selecting' : 'Select'}
          title={selection.active ? 'Done selecting' : 'Select'}
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-full text-gray-600 transition-colors hover:bg-gray-100 active:scale-95',
            selection.active && 'bg-gray-900 text-white hover:bg-gray-800',
          )}
        >
          <Pencil className="h-4 w-4" />
        </button>
      )}

      {/* Search — opens the ⌘K command bar (same as the keyboard shortcut),
          not the quick-access surface. Desktop-only (no keyboard on mobile). */}
      {!isMobile && (
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('usav-command-bar-open'))}
          aria-label="Open command bar"
          title="Search (⌘K)"
          className="flex h-9 w-9 items-center justify-center rounded-full text-gray-600 transition-colors hover:bg-gray-100 active:scale-95"
        >
          <Search className="h-4 w-4" />
        </button>
      )}

      {/* Notifications */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setPopover((p) => (p === 'inbox' ? 'none' : 'inbox'))}
          aria-label="Notifications"
          aria-expanded={inboxOpen}
          title="Notifications"
          className={cn(
            'relative flex h-9 w-9 items-center justify-center rounded-full text-gray-600 transition-colors hover:bg-gray-100 active:scale-95',
            inboxOpen && 'bg-gray-100',
          )}
        >
          <Inbox className="h-4 w-4" />
          {inboxCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-eyebrow font-bold tabular-nums text-white">
              {inboxCount > 9 ? '9+' : inboxCount}
            </span>
          )}
        </button>
        {inboxOpen && (
          <div className={popoverPos}>
            <ActivityInboxPopover onClose={() => setPopover('none')} />
          </div>
        )}
      </div>

      {/* Account avatar — staff initial. Condenses the old staff switcher +
          account menu into one control that opens the quick-access surface
          (which already holds the staff card, switch-staff, settings + sign
          out). */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setPopover((p) => (p === 'account' ? 'none' : 'account'))}
          aria-label="Account & quick access"
          aria-expanded={accountOpen}
          title={staffName || `Staff #${user.staffId}`}
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-full text-eyebrow font-bold text-white transition-transform active:scale-95',
            sc.bg,
            accountOpen && 'ring-2 ring-gray-300 ring-offset-1',
          )}
        >
          {staffName ? initials(staffName) : '·'}
        </button>
        {accountOpen && (
          <div className={popoverPos}>
            <QuickAccessPopover
              onClose={() => setPopover('none')}
              onOpenHistoryPopover={() => setPopover('history')}
              onOpenInboxPopover={() => setPopover('inbox')}
              compact={isMobile}
            />
          </div>
        )}
        {popover === 'history' && (
          <div className={popoverPos}>
            <PhoneHistoryPopover onClose={() => setPopover('none')} />
          </div>
        )}
      </div>
    </div>
  );
}

export default GlobalHeaderActions;
