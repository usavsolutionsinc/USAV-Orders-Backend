'use client';

import { useState, type ReactNode } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Copy, History, Info, Link2, MoreVertical, RefreshCw, ZendeskMark } from '@/components/Icons';
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

/** Unbox: primary toolbar actions; the rest live in the overflow menu. */
const UNBOX_INLINE_ACTIONS: ReadonlyArray<Exclude<HeaderActionKey, 'details'>> = [
  'refresh',
  'share',
];
const UNBOX_OVERFLOW_ACTIONS: ReadonlyArray<Exclude<HeaderActionKey, 'details'>> = [
  'audit',
  'copy',
  'photoNote',
];

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
  const [overflowOpen, setOverflowOpen] = useState(false);

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
      title: "Send this PO's photos to a Zendesk ticket",
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

  const toAction = (key: Exclude<HeaderActionKey, 'details'>): PaneHeaderActionBarAction => {
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
    };
  };

  const isUnbox = mode === 'unbox';
  const enabledKeys = def.headerActions.filter(
    (key): key is Exclude<HeaderActionKey, 'details'> => key !== 'details',
  );

  const inlineKeys = isUnbox
    ? enabledKeys.filter((k) => UNBOX_INLINE_ACTIONS.includes(k))
    : enabledKeys;
  const overflowKeys = isUnbox
    ? enabledKeys.filter((k) => UNBOX_OVERFLOW_ACTIONS.includes(k))
    : [];

  const inlineActions = inlineKeys.map(toAction);

  const overflowMenu =
    overflowKeys.length > 0 ? (
      <Popover.Root open={overflowOpen} onOpenChange={setOverflowOpen}>
        <HoverTooltip label="More actions">
          <Popover.Trigger asChild>
            <button
              type="button"
              aria-label="More actions"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-soft transition-colors hover:bg-surface-hover hover:text-text-default"
            >
              <MoreVertical className="h-3.5 w-3.5" />
            </button>
          </Popover.Trigger>
        </HoverTooltip>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={4}
            className="z-50 min-w-[10rem] rounded-lg border border-border-soft bg-surface-card p-1 shadow-lg"
          >
            {overflowKeys.map((key) => {
              const m = META[key];
              const onClick = handlers[key];
              const itemDisabled = m.disabled || !onClick;
              return (
                <button
                  key={key}
                  type="button"
                  disabled={itemDisabled}
                  onClick={() => {
                    onClick?.();
                    setOverflowOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-micro font-bold uppercase tracking-widest text-text-soft transition-colors hover:bg-surface-hover hover:text-text-default disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {m.icon}
                  {m.label}
                </button>
              );
            })}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    ) : null;

  return (
    <PaneHeaderActionBar
      variant="header"
      iconOnly
      rightSlot={
        <>
          {overflowMenu}
          {def.showDetails && receivingId != null ? (
            <HoverTooltip label="Receiving details" asChild>
              <IconButton
                onClick={() => dispatchReceivingDetailsOverlay(receivingId)}
                ariaLabel="Open receiving details"
                icon={<Info className="h-4 w-4 text-text-soft hover:text-text-default" />}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-surface-hover"
              />
            </HoverTooltip>
          ) : null}
        </>
      }
      actions={inlineActions}
      status={zohoSyncing ? 'Syncing' : undefined}
      onPrev={() =>
        window.dispatchEvent(new CustomEvent(def.navChannel, { detail: 'prev' }))
      }
      onNext={() =>
        window.dispatchEvent(new CustomEvent(def.navChannel, { detail: 'next' }))
      }
      prevTitle="Previous PO (↑)"
      nextTitle="Next PO (↓)"
      navClassName="hidden sm:inline-flex"
    />
  );
}
