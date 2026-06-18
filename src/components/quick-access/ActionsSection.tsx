'use client';

import { Activity, Bell, Smartphone } from '@/components/Icons';
import { Row } from './Row';
import { PhoneSignInQrButton } from './PhoneSignInQrButton';
import { useActivityInbox } from '@/contexts/ActivityInboxContext';
import type { ActionToggles } from '@/lib/quick-access/types';

interface ActionsSectionProps {
  actions: ActionToggles;
  onAction: () => void;
  onOpenHistoryPopover: () => void;
  onOpenInboxPopover: () => void;
  /** Admin-only: opens the system/cron sync-status popover. Omitted for
   *  non-admins, in which case the Sync status row is hidden. */
  onOpenSyncPopover?: () => void;
}

/**
 * Built-in quick actions. The install-desktop-app CTA lives outside this
 * section as a prominent banner above the sign-in card — see
 * QuickAccessPopover.
 */
export function ActionsSection({
  actions,
  onOpenHistoryPopover,
  onOpenInboxPopover,
  onOpenSyncPopover,
}: ActionsSectionProps) {
  const { items } = useActivityInbox();
  const unreadCount = items.filter((it) => !it.undone || it.undoFailed).length;
  const showInbox = items.length > 0;
  const showPhoneHistory = !!actions.phoneHistory;
  const showSync = !!onOpenSyncPopover;

  if (!showInbox && !showPhoneHistory && !showSync) return null;

  return (
    <div className="px-2 pb-2 pt-1">
      <p className="px-2 pb-0.5 text-micro font-bold uppercase tracking-widest text-gray-400">Actions</p>
      <div className="space-y-0.5">
        {showInbox ? (
          <Row
            icon={<Bell className="h-4 w-4" />}
            iconBg="bg-gray-900"
            label="Recent activity"
            subLabel="Notifications and updates"
            trailing={
              unreadCount > 0 ? (
                <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-rose-500 px-1.5 text-mini font-bold text-white">
                  {unreadCount}
                </span>
              ) : null
            }
            onClick={onOpenInboxPopover}
          />
        ) : null}
        {showPhoneHistory ? (
          <Row
            icon={<Smartphone className="h-4 w-4" />}
            iconBg="bg-gray-900"
            label="Phone history"
            subLabel="Resume your recent packs"
            trailing={<PhoneSignInQrButton />}
            onClick={onOpenHistoryPopover}
          />
        ) : null}
        {showSync ? (
          <Row
            icon={<Activity className="h-4 w-4" />}
            iconBg="bg-gray-900"
            label="Sync status"
            subLabel="System & cron health"
            onClick={onOpenSyncPopover}
          />
        ) : null}
      </div>
    </div>
  );
}
