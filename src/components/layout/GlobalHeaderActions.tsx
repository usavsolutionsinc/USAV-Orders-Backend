'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { AnchoredLayer } from '@/design-system';
import { IconButton } from '@/design-system/primitives';
import { Inbox, Pencil, Clipboard } from '@/components/Icons';
import { GlobalHeaderSearch } from '@/components/layout/GlobalHeaderSearch';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { cn } from '@/utils/_cn';
import { useAuth } from '@/contexts/AuthContext';
import { useHeader } from '@/contexts/HeaderContext';
import { useActivityInboxOptional } from '@/contexts/ActivityInboxContext';
import { QuickAccessPopover } from '@/components/quick-access/QuickAccessPopover';
import { PhoneHistoryPopover } from '@/components/quick-access/PhoneHistoryPopover';
import { ActivityInboxPopover } from '@/components/quick-access/ActivityInboxPopover';
import { ClipboardHistoryPopover } from '@/components/quick-access/ClipboardHistoryPopover';
import { FeedbackPopover } from '@/components/quick-access/FeedbackWidget';
import { PhoneSignInQrButton } from '@/components/quick-access/PhoneSignInQrButton';
import { getStaffThemeById, stationThemeColors } from '@/utils/staff-colors';

type OpenPopover = 'none' | 'history' | 'inbox' | 'account' | 'clipboard' | 'feedback';

/** Matches `RightRailHost` — the header rail aligns with the detail panel below. */
const HEADER_RAIL_WIDTH = 'w-[420px]';

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
 * Desktop layout: a 420px right rail (aligned with detail panels) holds a
 * narrower search field on the left and quick-action icons on the right.
 */
export function GlobalHeaderActions({ variant = 'desktop' }: { variant?: 'desktop' | 'mobile' } = {}) {
  const isMobile = variant === 'mobile';
  const pathname = usePathname();
  const { user } = useAuth();
  const { selection } = useHeader();
  const inbox = useActivityInboxOptional();
  const inboxCount = inbox?.items.length ?? 0;

  const [popover, setPopover] = useState<OpenPopover>('none');
  const clipboardAnchorRef = useRef<HTMLDivElement>(null);
  const inboxAnchorRef = useRef<HTMLDivElement>(null);
  const accountAnchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPopover('none');
  }, [pathname]);

  if (!user) return null;

  const inboxOpen = popover === 'inbox';
  const clipboardOpen = popover === 'clipboard';
  const accountOpen = popover === 'account';

  const sc = stationThemeColors[getStaffThemeById(user.staffId)];
  const displayName = user.name;
  const accountInitial = initials(displayName) || '·';

  const ctrlSize = isMobile ? 'h-10 w-10' : 'h-8 w-8';
  const iconSize = isMobile ? 'h-5 w-5' : 'h-4 w-4';
  const avatarSize = isMobile ? 'h-10 w-10 text-sm' : 'h-8 w-8 text-caption';

  const iconCluster = (
    <>
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

      <PhoneSignInQrButton className={ctrlSize} iconClassName={iconSize} />

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

      <div ref={accountAnchorRef} className="relative">
        <HoverTooltip label={displayName || `Staff #${user.staffId}`} asChild>
          <button
            type="button"
            onClick={() => setPopover((p) => (p === 'account' ? 'none' : 'account'))}
            aria-label="Account & quick access"
            aria-expanded={accountOpen}
            className={cn(
              'flex items-center justify-center rounded-full font-bold transition-transform active:scale-95',
              avatarSize,
              sc.bg,
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
          open={popover === 'feedback'}
          onClose={() => setPopover('none')}
          anchorRef={accountAnchorRef}
          placement="bottom-end"
          gap={4}
        >
          <FeedbackPopover onClose={() => setPopover('none')} />
        </AnchoredLayer>
      </div>
    </>
  );

  return (
    <div className={cn('flex items-center', isMobile ? 'gap-1.5' : 'gap-2')}>
      {!isMobile && selection && (
        <HoverTooltip label={selection.active ? 'Done selecting' : 'Select'} asChild>
          <button
            type="button"
            onClick={selection.onToggle}
            aria-pressed={selection.active}
            aria-label={selection.active ? 'Done selecting' : 'Select'}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-sunken active:scale-95',
              selection.active && 'bg-surface-inverse text-white hover:bg-surface-inverse-hover',
            )}
          >
            <Pencil className="h-4 w-4" />
          </button>
        </HoverTooltip>
      )}

      {!isMobile ? (
        <div className={cn('flex shrink-0 items-center gap-1.5', HEADER_RAIL_WIDTH)}>
          <GlobalHeaderSearch />
          <div className="flex shrink-0 items-center gap-1">{iconCluster}</div>
        </div>
      ) : (
        iconCluster
      )}
    </div>
  );
}
