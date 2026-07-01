'use client';

import { Activity, Bell, MessageSquare, ShieldCheck, Smartphone } from '@/components/Icons';
import { Row } from './Row';
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
  /** warranty.manage holders: navigate to the warranty check-in logger. */
  onWarrantyCheckin?: () => void;
  /** Opens the report-an-issue feedback popover. */
  onOpenFeedbackPopover?: () => void;
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
  onWarrantyCheckin,
  onOpenFeedbackPopover,
}: ActionsSectionProps) {
  const { items } = useActivityInbox();
  const unreadCount = items.filter((it) => !it.undone || it.undoFailed).length;
  const showInbox = items.length > 0;
  const showPhoneHistory = !!actions.phoneHistory;
  const showSync = !!onOpenSyncPopover;
  const showWarranty = !!actions.warrantyCheckin && !!onWarrantyCheckin;
  const showFeedback = !!onOpenFeedbackPopover;

  if (!showInbox && !showPhoneHistory && !showSync && !showWarranty && !showFeedback) return null;

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
        {showWarranty ? (
          <Row
            icon={<ShieldCheck className="h-4 w-4" />}
            iconBg="bg-violet-600"
            label="Log warranty claim"
            subLabel="Check in a warranty repair or return"
            onClick={onWarrantyCheckin}
          />
        ) : null}
        {showFeedback ? (
          <Row
            icon={<MessageSquare className="h-4 w-4" />}
            iconBg="bg-indigo-600"
            label="Report an issue"
            subLabel="Bug, suggestion, or question"
            onClick={onOpenFeedbackPopover}
          />
        ) : null}
      </div>
    </div>
  );
}
