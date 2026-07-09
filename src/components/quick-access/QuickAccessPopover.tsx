'use client';

import Link from 'next/link';
import { Settings } from '@/components/Icons';
import { useRouter } from 'next/navigation';
import { ActionsSection } from './ActionsSection';
import { PinnedSection } from './PinnedSection';
import { RecentSection } from './RecentSection';
import { useQuickAccess } from '@/lib/quick-access/use-quick-access';
import { useAuth } from '@/contexts/AuthContext';
import { getStaffColorHex } from '@/utils/staff-colors';
import { useStaffColorVersion } from '@/contexts/StaffColorsProvider';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { IconButton } from '@/design-system/primitives';

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
}

interface QuickAccessPopoverProps {
  onClose: () => void;
  onOpenHistoryPopover: () => void;
  /** Opens the report-an-issue feedback popover. */
  onOpenFeedbackPopover?: () => void;
  /**
   * Mobile: collapse the popover to just the staff identity row (avatar, name,
   * settings, sign-out). The pinned / recent / action sections are desktop-only.
   */
  compact?: boolean;
}

/**
 * Body order: pinned → recent → compact actions.
 * Signed-in staff card lives at the bottom.
 */
export function QuickAccessPopover({
  onClose,
  onOpenHistoryPopover,
  onOpenFeedbackPopover,
  compact = false,
}: QuickAccessPopoverProps) {
  const { settings } = useQuickAccess();
  const router = useRouter();
  const { user, signOut } = useAuth();

  useStaffColorVersion();

  const staffName = user?.name ?? '';
  const staffColorHex = user ? getStaffColorHex({ id: user.staffId }) : '#10b981';

  return (
    <div
      role="dialog"
      aria-label="Quick access"
      className="flex max-h-[calc(100vh-6rem)] w-[340px] flex-col overflow-hidden rounded-2xl border border-border-soft bg-surface-card shadow-xl"
    >
      {compact && onOpenFeedbackPopover ? (
        <ActionsSection
          actions={{ phoneHistory: false }}
          onOpenHistoryPopover={() => {}}
          onOpenFeedbackPopover={onOpenFeedbackPopover}
        />
      ) : null}

      {!compact && (
        <div className="min-h-0 flex-1 divide-y divide-border-hairline overflow-y-auto overscroll-contain">
          <PinnedSection onNavigate={onClose} />
          {settings.showRecent ? <RecentSection onNavigate={onClose} /> : null}
          <ActionsSection
            actions={settings.actions}
            onOpenHistoryPopover={onOpenHistoryPopover}
            onOpenFeedbackPopover={onOpenFeedbackPopover}
          />
        </div>
      )}

      {user ? (
        <div className="flex shrink-0 items-center gap-3 border-t border-border-hairline bg-surface-canvas/60 px-4 py-3">
          <StaffIdentityAvatar
            value={staffColorHex}
            initials={staffName ? initials(staffName) : '·'}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-eyebrow font-bold uppercase tracking-[0.14em] text-text-faint">
              {user.organizationName}
            </div>
            <div className="truncate text-sm font-semibold text-text-default">
              {staffName || `Staff #${user.staffId}`}
            </div>
            <div className="truncate text-micro font-medium uppercase tracking-[0.14em] text-text-soft">
              {user.role.replace(/_/g, ' ')}
            </div>
          </div>
          <Link
            href="/settings?section=quick-access"
            onClick={onClose}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-faint transition hover:bg-surface-card hover:text-text-default"
            aria-label="Manage in Settings"
            title="Manage in Settings"
          >
            <Settings className="h-3.5 w-3.5" />
          </Link>
          <HoverTooltip label="Sign out" asChild>
            <IconButton
              onClick={() => { void signOut(); }}
              ariaLabel="Sign out"
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-faint hover:bg-surface-card hover:text-text-default"
              icon={<svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>}
            />
          </HoverTooltip>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => { onClose(); router.push('/signin'); }}
          className="ds-raw-button flex shrink-0 items-center justify-between border-t border-border-hairline bg-surface-canvas/60 px-4 py-3 text-left transition hover:bg-surface-sunken"
        >
          <span className="text-sm font-semibold text-text-default">Sign in</span>
          <span className="text-caption text-text-soft">Pick a staff →</span>
        </button>
      )}
    </div>
  );
}

/** Quiet staff initials — color editing lives in Settings → Staff profile. */
function StaffIdentityAvatar({ value, initials }: { value: string; initials: string }) {
  return (
    <span
      aria-hidden
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-caption font-bold text-white ring-1 ring-border-soft"
      style={{ backgroundColor: value }}
    >
      {initials}
    </span>
  );
}
