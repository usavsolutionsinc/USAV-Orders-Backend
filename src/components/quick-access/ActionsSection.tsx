'use client';

import { Smartphone } from '@/components/Icons';
import { Row } from './Row';
import type { ActionToggles } from '@/lib/quick-access/types';

interface ActionsSectionProps {
  actions: ActionToggles;
  onAction: () => void;
  onOpenHistoryPopover: () => void;
}

/**
 * Built-in quick actions. The install-desktop-app CTA lives outside this
 * section as a prominent banner above the sign-in card — see
 * QuickAccessPopover.
 */
export function ActionsSection({ actions, onOpenHistoryPopover }: ActionsSectionProps) {
  if (!actions.phoneHistory) return null;

  return (
    <div className="px-2 py-2">
      <p className="px-2 pb-1 text-micro font-bold uppercase tracking-widest text-gray-400">Actions</p>
      <div className="space-y-0.5">
        <Row
          icon={<Smartphone className="h-4 w-4" />}
          iconBg="bg-gray-900"
          label="Phone history"
          subLabel="Resume your recent packs"
          onClick={onOpenHistoryPopover}
        />
      </div>
    </div>
  );
}

export default ActionsSection;
