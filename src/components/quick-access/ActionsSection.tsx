'use client';

import { MessageSquare, Smartphone } from '@/components/Icons';
import { Row } from './Row';
import type { ActionToggles } from '@/lib/quick-access/types';

interface ActionsSectionProps {
  actions: ActionToggles;
  onOpenHistoryPopover: () => void;
  /** Opens the report-an-issue feedback popover. */
  onOpenFeedbackPopover?: () => void;
}

/**
 * Secondary quick actions — kept minimal. Navigation lives in Pinned/Recent;
 * system tools (sync, warranty) live in their own surfaces.
 */
export function ActionsSection({
  actions,
  onOpenHistoryPopover,
  onOpenFeedbackPopover,
}: ActionsSectionProps) {
  const showPhoneHistory = !!actions.phoneHistory;
  const showFeedback = !!onOpenFeedbackPopover;

  if (!showPhoneHistory && !showFeedback) return null;

  return (
    <div className="px-2 py-1">
      <div className="space-y-0.5">
        {showPhoneHistory ? (
          <Row
            icon={<Smartphone className="h-3.5 w-3.5" />}
            label="Phone history"
            onClick={onOpenHistoryPopover}
          />
        ) : null}
        {showFeedback ? (
          <Row
            icon={<MessageSquare className="h-3.5 w-3.5" />}
            label="Report an issue"
            onClick={onOpenFeedbackPopover}
          />
        ) : null}
      </div>
    </div>
  );
}
