'use client';

import type { ReactNode } from 'react';
import { Copy, History, Info, Link2, RefreshCw, ZendeskMark } from '@/components/Icons';
import { IconButton } from '@/design-system/primitives';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import {
  PaneHeaderActionBar,
  type PaneHeaderActionBarAction,
} from '@/components/ui/pane-header';
import { dispatchReceivingDetailsOverlay } from '@/utils/events';
import {
  workspaceMode,
  type HeaderActionKey,
  type WorkspaceMode,
} from './mode-registry';

/**
 * Frozen utility toolbar — the third header row beneath the global header +
 * progress stepper. Icon-only; the action set is driven by the mode registry
 * (`WORKSPACE_MODES[mode].headerActions`) so every mode renders the SAME header
 * primitive configured by data, not a bespoke toolbar each. Unbox/triage show
 * refresh·share·audit·copy; testing shows audit·pair·copy. Lives outside
 * the scroll surface so it stays locked while the body scrolls under it.
 *
 * Prev/Next dispatch the mode's `navChannel` event (receiving-navigate-table vs
 * testing-navigate-rail), so this component needs no navigation props.
 */
export function LineEditToolbar({
  mode = 'unbox',
  receivingId,
  zohoSyncing = false,
  busy,
  copyingAll,
  pairing = false,
  handlers,
}: {
  /** Drives which header actions + nav channel render. Defaults to unbox. */
  mode?: WorkspaceMode;
  receivingId: number | null;
  zohoSyncing?: boolean;
  /** saving || platformSaving — surfaces the "Saving" status pill. */
  busy: boolean;
  copyingAll: boolean;
  /** SKU-pairing modal opening — disables the pair button (testing). */
  pairing?: boolean;
  /** Handler per action key; only the keys this mode lists are read. */
  handlers: Partial<Record<HeaderActionKey, () => void>>;
}) {
  const def = workspaceMode(mode);
  const disabled = receivingId == null;

  // Per-action presentation. Disabled/spinner state is derived from the busy
  // flags so the icons animate consistently across modes.
  const META: Record<
    Exclude<HeaderActionKey, 'details'>,
    { label: string; icon: ReactNode; disabled?: boolean; title: string; ariaLabel: string }
  > = {
    refresh: {
      label: 'Refresh',
      icon: <RefreshCw className={`h-3.5 w-3.5 ${zohoSyncing ? 'animate-spin' : ''}`} />,
      disabled: zohoSyncing,
      title: 'Sync with Zoho by tracking number',
      ariaLabel: 'Refresh line from Zoho',
    },
    share: {
      label: 'Share',
      icon: <Link2 className="h-3.5 w-3.5" />,
      disabled,
      title: 'Copy link to open this package on Receiving',
      ariaLabel: 'Share receiving link',
    },
    audit: {
      label: 'Audit',
      icon: <History className="h-3.5 w-3.5" />,
      disabled,
      title: 'Audit log (inventory events)',
      ariaLabel: 'View audit log',
    },
    copy: {
      label: 'Copy',
      icon: <Copy className={`h-3.5 w-3.5 ${copyingAll ? 'animate-pulse' : ''}`} />,
      disabled: disabled || copyingAll,
      title: 'Copy package + PO details to clipboard',
      ariaLabel: 'Copy all receiving details',
    },
    photoNote: {
      label: 'Zendesk',
      icon: <ZendeskMark className="h-4 w-4" />,
      disabled,
      title: "Send this PO's photos to a Zendesk ticket — link a new ticket or update an existing one",
      ariaLabel: 'Send photos to a Zendesk ticket',
    },
    pair: {
      label: 'Pair',
      icon: <Link2 className="h-3.5 w-3.5" />,
      disabled: disabled || pairing,
      title: 'Pair this SKU across platforms',
      ariaLabel: 'Open SKU pairing',
    },
  };

  const actions = def.headerActions
    .filter((key): key is Exclude<HeaderActionKey, 'details'> => key !== 'details')
    .map((key) => {
      const m = META[key];
      const onClick = handlers[key];
      return {
        key,
        label: m.label,
        icon: m.icon,
        onClick: onClick ?? (() => {}),
        disabled: m.disabled || !onClick,
        title: m.title,
        ariaLabel: m.ariaLabel,
      } satisfies PaneHeaderActionBarAction;
    });

  return (
    <PaneHeaderActionBar
      variant="header"
      iconOnly
      rightSlot={
        def.showDetails && receivingId != null ? (
          <HoverTooltip label="Receiving details" asChild>
            <IconButton
              onClick={() => dispatchReceivingDetailsOverlay(receivingId)}
              ariaLabel="Open receiving details"
              icon={<Info className="h-4 w-4 text-text-soft hover:text-text-default" />}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-surface-hover"
            />
          </HoverTooltip>
        ) : null
      }
      actions={actions}
      status={zohoSyncing ? 'Syncing' : busy ? 'Saving' : undefined}
      onPrev={() =>
        window.dispatchEvent(new CustomEvent(def.navChannel, { detail: 'prev' }))
      }
      onNext={() =>
        window.dispatchEvent(new CustomEvent(def.navChannel, { detail: 'next' }))
      }
      prevTitle="Previous recent line"
      nextTitle="Next recent line"
    />
  );
}
