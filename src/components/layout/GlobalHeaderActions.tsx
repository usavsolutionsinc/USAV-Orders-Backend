'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { AnchoredLayer } from '@/design-system';
import { IconButton } from '@/design-system/primitives';
import { Search, Inbox, Pencil, Clipboard } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { cn } from '@/utils/_cn';
import { useAuth } from '@/contexts/AuthContext';
import { useHeader } from '@/contexts/HeaderContext';
import { useActivityInboxOptional } from '@/contexts/ActivityInboxContext';
import { QuickAccessPopover } from '@/components/quick-access/QuickAccessPopover';
import { PhoneHistoryPopover } from '@/components/quick-access/PhoneHistoryPopover';
import { ActivityInboxPopover } from '@/components/quick-access/ActivityInboxPopover';
import { ClipboardHistoryPopover } from '@/components/quick-access/ClipboardHistoryPopover';
import { SyncStatusPopover } from '@/components/quick-access/SyncStatusPopover';
import { FeedbackPopover } from '@/components/quick-access/FeedbackWidget';
import { PhoneSignInQrButton } from '@/components/quick-access/PhoneSignInQrButton';
import { getStaffThemeById, stationThemeColors } from '@/utils/staff-colors';

type OpenPopover = 'none' | 'history' | 'inbox' | 'account' | 'sync' | 'clipboard' | 'feedback';

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
  // Each control owns its own anchor so its popover portals out of the header
  // (escaping any transformed/blurred ancestor) yet still pins to the trigger.
  const clipboardAnchorRef = useRef<HTMLDivElement>(null);
  const inboxAnchorRef = useRef<HTMLDivElement>(null);
  const accountAnchorRef = useRef<HTMLDivElement>(null);

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

  // `user.name` is the single source of truth (the auth session envelope) and
  // is present synchronously on first paint — no per-surface `/api/staff` fetch.
  // The server coalesces a blank name to `Staff #id`, so the initial is always
  // meaningful; the `'·'` is only an unreachable last resort.
  const displayName = user.name;
  const accountInitial = initials(displayName) || '·';

  // On mobile, controls match the sidebar menu button (h-10 w-10) for thumb-sized
  // hit targets; desktop stays compact.
  const ctrlSize = isMobile ? 'h-10 w-10' : 'h-9 w-9';
  const iconSize = isMobile ? 'h-5 w-5' : 'h-4 w-4';
  // Initial is sized PROPORTIONALLY to the circle so it reads the same as the
  // FAB avatar in QuickAccessPopover (~0.33 text-to-circle ratio: 14px in its
  // ~42px inner circle). Matching the absolute px instead makes the M look
  // oversized in these smaller header dots.
  const avatarSize = isMobile ? 'h-10 w-10 text-sm' : 'h-8 w-8 text-caption';

  return (
    <div className={cn('flex items-center', isMobile ? 'gap-1.5' : 'gap-2')}>
      {/* Selection toggle — registered per page via usePageSelection(). A
          pencil that flips the active surface into select mode. */}
      {!isMobile && selection && (
        <HoverTooltip label={selection.active ? 'Done selecting' : 'Select'} asChild>
          {/* ds-raw-button: select-mode toggle with strong active fill (bg-gray-900 text-white) that conflicts with IconButton's tone color, not a single DS variant */}
          <button
            type="button"
            onClick={selection.onToggle}
            aria-pressed={selection.active}
            aria-label={selection.active ? 'Done selecting' : 'Select'}
            className={cn(
              'flex h-9 w-9 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-sunken active:scale-95',
              selection.active && 'bg-surface-inverse text-white hover:bg-surface-inverse-hover',
            )}
          >
            <Pencil className="h-4 w-4" />
          </button>
        </HoverTooltip>
      )}

      {/* Search — opens the ⌘K command bar (same as the keyboard shortcut),
          not the quick-access surface. Desktop-only (no keyboard on mobile). */}
      {!isMobile && (
        <HoverTooltip label="Search (⌘K)" asChild>
          <IconButton
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('usav-command-bar-open'))}
            ariaLabel="Open command bar"
            className="flex h-9 w-9 items-center justify-center rounded-full text-text-muted hover:bg-surface-sunken active:scale-95"
            icon={<Search className="h-4 w-4" />}
          />
        </HoverTooltip>
      )}

      {/* Clipboard history — recent copies + send-to-staff. Sits between the
          search launcher and the notifications bell. */}
      <div ref={clipboardAnchorRef} className="relative">
        <HoverTooltip label="Clipboard history" asChild>
          <IconButton
            type="button"
            onClick={() => setPopover((p) => (p === 'clipboard' ? 'none' : 'clipboard'))}
            ariaLabel="Clipboard history"
            aria-expanded={clipboardOpen}
            className={cn(
              'flex items-center justify-center rounded-full text-text-muted hover:bg-surface-sunken active:scale-95',
              ctrlSize,
              clipboardOpen && 'bg-surface-sunken',
            )}
            icon={<Clipboard className={iconSize} />}
          />
        </HoverTooltip>
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

      {/* Phone sign-in QR — scan to open /m/signin on your phone. */}
      <PhoneSignInQrButton className={ctrlSize} iconClassName={iconSize} />

      {/* Notifications */}
      <div ref={inboxAnchorRef} className="relative">
        <HoverTooltip label="Notifications" asChild>
          <IconButton
            type="button"
            onClick={() => setPopover((p) => (p === 'inbox' ? 'none' : 'inbox'))}
            ariaLabel="Notifications"
            aria-expanded={inboxOpen}
            className={cn(
              'relative flex items-center justify-center rounded-full text-text-muted hover:bg-surface-sunken active:scale-95',
              ctrlSize,
              inboxOpen && 'bg-surface-sunken',
            )}
            icon={
              <span className="relative inline-flex shrink-0">
                <Inbox className={iconSize} />
                {inboxCount > 0 && (
                  <span className="pointer-events-none absolute -right-1 -top-1 flex h-3 min-w-[12px] items-center justify-center rounded-full bg-rose-600 px-0.5 text-mini font-bold leading-none tabular-nums text-white ring-1 ring-white">
                    {inboxCount > 9 ? '9+' : inboxCount}
                  </span>
                )}
              </span>
            }
          />
        </HoverTooltip>
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
        <HoverTooltip label={displayName || `Staff #${user.staffId}`} asChild>
          {/* ds-raw-button: avatar control rendering a text initial with dynamic staff-theme bg + conditional ring, not an icon button */}
          <button
            type="button"
            onClick={() => setPopover((p) => (p === 'account' ? 'none' : 'account'))}
            aria-label="Account & quick access"
            aria-expanded={accountOpen}
            className={cn(
              'flex items-center justify-center rounded-full font-bold transition-transform active:scale-95',
              avatarSize,
              sc.bg,
              // `text-white` must come AFTER avatarSize: tailwind-merge treats the
              // custom `text-eyebrow`/`text-caption` size tokens as text-color
              // classes, so an earlier `text-white` gets stripped and the initial
              // falls back to the dark inherited body color.
              'text-white',
              accountOpen && 'ring-2 ring-border-default ring-offset-1',
            )}
          >
            {accountInitial}
          </button>
        </HoverTooltip>
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
            onOpenFeedbackPopover={() => setPopover('feedback')}
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
        <AnchoredLayer
          open={popover === 'feedback'}
          onClose={() => setPopover('none')}
          anchorRef={accountAnchorRef}
          placement="bottom-end"
          gap={4}
        >
          <FeedbackPopover onClose={() => setPopover('none')} />
        </AnchoredLayer>
      </div>
    </div>
  );
}
