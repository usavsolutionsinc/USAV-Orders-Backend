'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Search, Bell, X } from '@/components/Icons';
import { cn } from '@/utils/_cn';
import { useAuth } from '@/contexts/AuthContext';
import { useActivityInboxOptional } from '@/contexts/ActivityInboxContext';
import { useQuickAccess } from '@/lib/quick-access/use-quick-access';
import { useQuickAccessHotkey } from '@/lib/quick-access/use-hotkey';
import { QuickAccessPopover } from '@/components/quick-access/QuickAccessPopover';
import { PhoneHistoryPopover } from '@/components/quick-access/PhoneHistoryPopover';
import { ActivityInboxPopover } from '@/components/quick-access/ActivityInboxPopover';
import { ActiveStaffChip } from '@/components/auth/ActiveStaffChip';
import { UserMenu } from './UserMenu';

type OpenPopover = 'none' | 'search' | 'history' | 'inbox';

/**
 * Persistent right zone of the {@link GlobalHeader}.
 *
 * Decomposes what used to be the single bottom-right Quick Access FAB into
 * discrete header controls — search/launcher, notifications, staff switcher,
 * and account menu — each owning its own popover. The popovers themselves
 * (QuickAccessPopover, ActivityInboxPopover, PhoneHistoryPopover) are reused
 * verbatim so there's no duplicated launcher logic.
 */
export function GlobalHeaderActions() {
  const pathname = usePathname();
  const { user } = useAuth();
  const { settings } = useQuickAccess();
  const inbox = useActivityInboxOptional();
  const inboxCount = inbox?.items.length ?? 0;

  const [popover, setPopover] = useState<OpenPopover>('none');
  const wrapperRef = useRef<HTMLDivElement>(null);

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

  const toggleSearch = useCallback(
    () => setPopover((p) => (p === 'search' ? 'none' : 'search')),
    [],
  );
  useQuickAccessHotkey(settings.hotkey === 'cmdk' && settings.enabled, toggleSearch);

  if (!user) return null;

  const searchOpen = popover === 'search';
  const inboxOpen = popover === 'inbox';
  const popoverPos = 'absolute right-0 top-full mt-1 z-50';

  return (
    <div ref={wrapperRef} className="flex items-center gap-2">
      {/* Search / quick-access launcher */}
      {settings.enabled && (
        <div className="relative">
          <button
            type="button"
            onClick={toggleSearch}
            aria-label={searchOpen ? 'Close quick access' : 'Open quick access'}
            aria-expanded={searchOpen}
            title="Quick access (⌘K)"
            className={cn(
              'flex h-9 w-9 items-center justify-center rounded-full text-gray-600 transition-colors hover:bg-gray-100 active:scale-95',
              searchOpen && 'bg-gray-900 text-white hover:bg-gray-800',
            )}
          >
            {searchOpen ? <X className="h-4 w-4" /> : <Search className="h-4 w-4" />}
          </button>
          {searchOpen && (
            <div className={popoverPos}>
              <QuickAccessPopover
                onClose={() => setPopover('none')}
                onOpenHistoryPopover={() => setPopover('history')}
                onOpenInboxPopover={() => setPopover('inbox')}
              />
            </div>
          )}
          {popover === 'history' && (
            <div className={popoverPos}>
              <PhoneHistoryPopover onClose={() => setPopover('none')} />
            </div>
          )}
        </div>
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
          <Bell className="h-4 w-4" />
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

      {/* Staff switcher */}
      <ActiveStaffChip variant="inline" />

      {/* Account menu */}
      <UserMenu />
    </div>
  );
}

export default GlobalHeaderActions;
