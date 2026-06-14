'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { AnchoredLayer } from '@/design-system';
import { Search, Inbox, Pencil, Clipboard } from '@/components/Icons';
import { cn } from '@/utils/_cn';
import { useAuth } from '@/contexts/AuthContext';
import { useHeader } from '@/contexts/HeaderContext';
import { useActivityInboxOptional } from '@/contexts/ActivityInboxContext';
import { QuickAccessPopover } from '@/components/quick-access/QuickAccessPopover';
import { PhoneHistoryPopover } from '@/components/quick-access/PhoneHistoryPopover';
import { ActivityInboxPopover } from '@/components/quick-access/ActivityInboxPopover';
import { ClipboardHistoryPopover } from '@/components/quick-access/ClipboardHistoryPopover';
import { SyncStatusPopover } from '@/components/quick-access/SyncStatusPopover';
import { getStaffThemeById, stationThemeColors } from '@/utils/staff-colors';

type OpenPopover = 'none' | 'history' | 'inbox' | 'account' | 'sync' | 'clipboard';

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
  // Each control owns its own anchor so its popover portals out of the header
  // (escaping any transformed/blurred ancestor) yet still pins to the trigger.
  const clipboardAnchorRef = useRef<HTMLDivElement>(null);
  const inboxAnchorRef = useRef<HTMLDivElement>(null);
  const accountAnchorRef = useRef<HTMLDivElement>(null);

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

  if (!user) return null;

  const inboxOpen = popover === 'inbox';
  const clipboardOpen = popover === 'clipboard';
  const accountOpen = popover === 'account';
  const isAdmin = !!user.permissions?.includes('admin.view');

  const sc = stationThemeColors[getStaffThemeById(user.staffId)];

  return (
    <div className="flex items-center gap-2">
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

      {/* Clipboard history — recent copies + send-to-staff. Sits between the
          search launcher and the notifications bell. */}
      <div ref={clipboardAnchorRef} className="relative">
        <button
          type="button"
          onClick={() => setPopover((p) => (p === 'clipboard' ? 'none' : 'clipboard'))}
          aria-label="Clipboard history"
          aria-expanded={clipboardOpen}
          title="Clipboard history"
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-full text-gray-600 transition-colors hover:bg-gray-100 active:scale-95',
            clipboardOpen && 'bg-gray-100',
          )}
        >
          <Clipboard className="h-4 w-4" />
        </button>
        <AnchoredLayer
          open={clipboardOpen}
          onClose={() => setPopover('none')}
          anchorRef={clipboardAnchorRef}
          placement="bottom-end"
          gap={4}
        >
          <ClipboardHistoryPopover onClose={() => setPopover('none')} />
        </AnchoredLayer>
      </div>

      {/* Notifications */}
      <div ref={inboxAnchorRef} className="relative">
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
        <AnchoredLayer
          open={inboxOpen}
          onClose={() => setPopover('none')}
          anchorRef={inboxAnchorRef}
          placement="bottom-end"
          gap={4}
        >
          <ActivityInboxPopover onClose={() => setPopover('none')} />
        </AnchoredLayer>
      </div>

      {/* Account avatar — staff initial. Condenses the old staff switcher +
          account menu into one control that opens the quick-access surface
          (which already holds the staff card, switch-staff, settings + sign
          out). */}
      <div ref={accountAnchorRef} className="relative">
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
        <AnchoredLayer
          open={accountOpen}
          onClose={() => setPopover('none')}
          anchorRef={accountAnchorRef}
          placement="bottom-end"
          gap={4}
        >
          <QuickAccessPopover
            onClose={() => setPopover('none')}
            onOpenHistoryPopover={() => setPopover('history')}
            onOpenInboxPopover={() => setPopover('inbox')}
            onOpenSyncPopover={isAdmin && !isMobile ? () => setPopover('sync') : undefined}
            compact={isMobile}
          />
        </AnchoredLayer>
        <AnchoredLayer
          open={popover === 'history'}
          onClose={() => setPopover('none')}
          anchorRef={accountAnchorRef}
          placement="bottom-end"
          gap={4}
        >
          <PhoneHistoryPopover onClose={() => setPopover('none')} />
        </AnchoredLayer>
        <AnchoredLayer
          open={popover === 'sync'}
          onClose={() => setPopover('none')}
          anchorRef={accountAnchorRef}
          placement="bottom-end"
          gap={4}
        >
          <SyncStatusPopover onClose={() => setPopover('none')} />
        </AnchoredLayer>
      </div>
    </div>
  );
}
