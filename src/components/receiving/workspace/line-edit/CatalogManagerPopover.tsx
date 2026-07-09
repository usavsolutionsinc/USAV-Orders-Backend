'use client';

/**
 * Overlay wrapper around {@link CatalogManagerList} — the CRUD manager for the
 * org platform / type catalog, opened from the pencil next to the Platform or
 * Type dropdown in {@link LabelEditPopover}. Same RightPaneOverlay shell as the
 * label editor / ReceivingClaimModal. The /settings catalog section renders the
 * same list without this overlay chrome.
 */

import { RightPaneOverlay } from '@/components/ui/RightPaneOverlay';
import { IconButton } from '@/design-system/primitives';
import { X } from '@/components/Icons';
import { microBadge } from '@/design-system/tokens/typography/presets';
import { CatalogManagerList, type CatalogKind } from './CatalogManagerList';

export type { CatalogKind } from './CatalogManagerList';

const TITLE: Record<CatalogKind, string> = {
  platform: 'Manage platforms',
  type: 'Manage types',
};

export function CatalogManagerPopover({
  open,
  kind,
  onClose,
}: {
  open: boolean;
  kind: CatalogKind;
  onClose: () => void;
}) {
  return (
    <RightPaneOverlay
      open={open}
      onClose={onClose}
      align="center"
      aria-label={TITLE[kind]}
      className="w-[min(94%,32rem)] rounded-2xl border-0 shadow-2xl ring-1 ring-border-soft"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-border-hairline px-5 py-3">
        <span className={`${microBadge} text-text-muted`}>{TITLE[kind]}</span>
        <IconButton
          onClick={onClose}
          ariaLabel="Close"
          icon={<X className="h-4 w-4" />}
          className="rounded-lg p-1.5 transition-colors hover:bg-surface-sunken"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <CatalogManagerList kind={kind} enabled={open} />
      </div>
    </RightPaneOverlay>
  );
}
