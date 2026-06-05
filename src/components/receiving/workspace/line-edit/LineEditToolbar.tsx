'use client';

import { Copy, History, Info, Link2, RefreshCw, Smartphone } from '@/components/Icons';
import {
  PaneHeaderActionBar,
  type PaneHeaderActionBarAction,
} from '@/components/ui/pane-header';
import { dispatchReceivingDetailsOverlay } from '@/utils/events';

/**
 * Frozen utility toolbar — the third header row beneath the global header +
 * progress stepper. Icon-only (refresh / share / audit / copy / phone +
 * prev/next); the right-slot Info opens receiving details. Lives outside the
 * scroll surface so it stays locked to the top while the body scrolls under it.
 *
 * Prev/Next and the details action dispatch the same window events the panel
 * used inline, so this component needs no navigation props. The phone action
 * pushes a "Shared from computer" sheet to the operator's paired phone.
 */
export function LineEditToolbar({
  receivingId,
  zohoSyncing,
  busy,
  copyingAll,
  phoneSharing = false,
  onRefresh,
  onShare,
  onSharePhone,
  onAudit,
  onCopy,
}: {
  receivingId: number | null;
  zohoSyncing: boolean;
  /** saving || platformSaving — surfaces the "Saving" status pill. */
  busy: boolean;
  copyingAll: boolean;
  /** Publish-in-flight for the share-to-phone action — disables the button. */
  phoneSharing?: boolean;
  onRefresh: () => void;
  onShare: () => void;
  onSharePhone: () => void;
  onAudit: () => void;
  onCopy: () => void;
}) {
  const disabled = receivingId == null;
  return (
    <PaneHeaderActionBar
      variant="header"
      iconOnly
      rightSlot={
        receivingId != null ? (
          <button
            type="button"
            onClick={() => dispatchReceivingDetailsOverlay(receivingId)}
            aria-label="Open receiving details"
            title="Receiving details"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800"
          >
            <Info className="h-4 w-4" />
          </button>
        ) : null
      }
      actions={[
        {
          key: 'refresh',
          label: 'Refresh',
          icon: <RefreshCw className={`h-3.5 w-3.5 ${zohoSyncing ? 'animate-spin' : ''}`} />,
          onClick: onRefresh,
          disabled: zohoSyncing,
          title: 'Sync with Zoho by tracking number',
          ariaLabel: 'Refresh line from Zoho',
        },
        {
          key: 'share',
          label: 'Share',
          icon: <Link2 className="h-3.5 w-3.5" />,
          onClick: onShare,
          disabled,
          title: 'Copy link to open this package on Receiving',
          ariaLabel: 'Share receiving link',
        },
        {
          key: 'audit',
          label: 'Audit',
          icon: <History className="h-3.5 w-3.5" />,
          onClick: onAudit,
          disabled,
          title: 'Audit log (inventory events)',
          ariaLabel: 'View audit log',
        },
        {
          key: 'copy',
          label: 'Copy',
          icon: <Copy className={`h-3.5 w-3.5 ${copyingAll ? 'animate-pulse' : ''}`} />,
          onClick: onCopy,
          disabled: disabled || copyingAll,
          title: 'Copy package + PO details to clipboard',
          ariaLabel: 'Copy all receiving details',
        },
        {
          key: 'share-phone',
          label: 'Phone',
          icon: <Smartphone className="h-3.5 w-3.5" />,
          onClick: onSharePhone,
          disabled: disabled || phoneSharing,
          title: 'Share to your phone to take photos',
          ariaLabel: 'Share to phone',
        },
      ] satisfies PaneHeaderActionBarAction[]}
      status={zohoSyncing ? 'Syncing' : busy ? 'Saving' : undefined}
      onPrev={() =>
        window.dispatchEvent(new CustomEvent('receiving-navigate-table', { detail: 'prev' }))
      }
      onNext={() =>
        window.dispatchEvent(new CustomEvent('receiving-navigate-table', { detail: 'next' }))
      }
      prevTitle="Previous recent line"
      nextTitle="Next recent line"
    />
  );
}
