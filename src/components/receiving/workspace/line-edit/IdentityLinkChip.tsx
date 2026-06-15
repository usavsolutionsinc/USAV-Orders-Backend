'use client';

/**
 * Identity chip used across the condensed carton row. It supports the original
 * `[external-link] · [copy value] · [edit]` layout plus a compact action-menu
 * mode where the chip remains the primary action and Open/Edit move below it.
 */

import { Copy, ExternalLink, Pencil } from '@/components/Icons';
import { CopyChip, type ChipTone } from '@/components/ui/CopyChip';
import { RECEIVING_CHIP_EDIT_BTN_CLASS } from '@/components/sidebar/receiving/receiving-sidebar-shared';
import { normalizeCopyText } from '@/lib/copy-chip-format';
import { recordCopy } from '@/lib/clipboard-history';

export function IdentityLinkChip({
  openHref,
  openTitle,
  value,
  display,
  tone,
  underlineClass,
  iconClass,
  disableCopy,
  onEdit,
  editOpen,
  editLabel,
  grow = false,
  actionsInMenu = false,
  chipAction = 'copy',
  showExternalIcon = false,
  menuFirstAction = 'open',
}: {
  openHref: string | null | undefined;
  openTitle: string;
  /** Raw value copied to the clipboard. */
  value: string;
  /** Label shown in the chip (platform name / last-4 id). */
  display: string;
  /**
   * Copy-chip tone — supplies the leading identity icon (id `#`, tracking pin,
   * etc.) so PO#/tracking read consistently with the ticket chip. The explicit
   * `underlineClass`/`iconClass` below still win for color.
   */
  tone?: ChipTone;
  underlineClass: string;
  iconClass?: string;
  disableCopy?: boolean;
  /** Toggles the below-row editor for this field. Omit to hide the pencil. */
  onEdit?: () => void;
  editOpen?: boolean;
  editLabel?: string;
  /** Wide chip that fills the remaining row width (listing). Others hug last-4. */
  grow?: boolean;
  /** Move external-link/edit controls into a serial-chip-style hover menu. */
  actionsInMenu?: boolean;
  /** Primary action for the complete chip surface. */
  chipAction?: 'copy' | 'open';
  /** Render the external-link glyph inside the clickable chip. */
  showExternalIcon?: boolean;
  /** First menu row. Listing uses Copy; PO/tracking use Open. */
  menuFirstAction?: 'open' | 'copy';
}) {
  const normalizedValue = normalizeCopyText(value);
  const canCopy = !disableCopy && !!normalizedValue && normalizedValue !== '---';
  const openExternal = () => {
    if (openHref) window.open(openHref, '_blank', 'noopener,noreferrer');
  };
  const copyValue = () => {
    if (!canCopy) return;
    void navigator.clipboard.writeText(normalizedValue);
    recordCopy(normalizedValue, { kind: tone, display });
  };
  const hasMenuActions = actionsInMenu && (!!onEdit || menuFirstAction === 'copy' || !!openHref);

  return (
    <div
      className={`group relative flex items-center gap-0.5 ${grow ? 'min-w-0 flex-1' : 'shrink-0'}`}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {!actionsInMenu ? (
        <button
          type="button"
          disabled={!openHref}
          onClick={openExternal}
          aria-label={openTitle}
          title={openHref ? openTitle : 'No link available'}
          className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded text-blue-600 transition-colors hover:bg-blue-50 hover:text-blue-700 active:scale-95 disabled:cursor-not-allowed disabled:text-slate-300 disabled:opacity-60"
        >
          <ExternalLink className="h-3.5 w-3.5 shrink-0" />
        </button>
      ) : null}
      <CopyChip
        value={value}
        display={display}
        tone={tone}
        icon={showExternalIcon ? <ExternalLink className="h-4 w-4 shrink-0" /> : undefined}
        underlineClass={underlineClass}
        iconClass={iconClass}
        width={grow ? 'min-w-0 flex-1 max-w-full' : 'w-auto'}
        outerPad="flush"
        disableCopy={disableCopy}
        fitDisplayWidth={!grow}
        truncateDisplay={grow}
        disableTooltip={actionsInMenu}
        onActivate={chipAction === 'open' ? openExternal : undefined}
        activationLabel={chipAction === 'open' ? openTitle : undefined}
        activationTitle={
          chipAction === 'open'
            ? openHref
              ? openTitle
              : 'No link available'
            : undefined
        }
        activationDisabled={chipAction === 'open' && !openHref && !onEdit}
      />
      {!actionsInMenu && onEdit ? (
        <button
          type="button"
          onClick={onEdit}
          aria-expanded={editOpen}
          aria-label={editLabel}
          title={editOpen ? 'Done editing' : editLabel}
          className={RECEIVING_CHIP_EDIT_BTN_CLASS}
        >
          <Pencil className="h-3 w-3" />
        </button>
      ) : null}
      {hasMenuActions ? (
        <div
          // Local hover menu matching SerialChipWithMenu; it is intentionally
          // outside the app-wide portal/overlay stack.
          // eslint-disable-next-line no-restricted-syntax
          className="invisible pointer-events-none absolute left-1/2 top-full z-[100] -translate-x-1/2 pt-1 opacity-0 transition-opacity duration-100 group-hover:visible group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:visible group-focus-within:pointer-events-auto group-focus-within:opacity-100"
        >
          <div
            role="menu"
            aria-label={`${display} actions`}
            className="min-w-[128px] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg"
          >
            {menuFirstAction === 'open' ? (
              <button
                type="button"
                role="menuitem"
                disabled={!openHref}
                onClick={openExternal}
                aria-label={openTitle}
                title={openHref ? openTitle : 'No link available'}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-caption font-bold uppercase tracking-widest text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:text-slate-400 disabled:opacity-40"
              >
                <ExternalLink className="h-3.5 w-3.5 shrink-0 text-blue-600" />
                Open
              </button>
            ) : (
              <button
                type="button"
                role="menuitem"
                disabled={!canCopy}
                onClick={copyValue}
                aria-label={`Copy ${display}`}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-caption font-bold uppercase tracking-widest text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Copy className="h-3.5 w-3.5 shrink-0 text-gray-500" />
                Copy
              </button>
            )}
            {onEdit ? (
              <button
                type="button"
                role="menuitem"
                onClick={onEdit}
                aria-expanded={editOpen}
                aria-label={editLabel}
                className="flex w-full items-center gap-2 border-t border-gray-100 px-3 py-1.5 text-left text-caption font-bold uppercase tracking-widest text-gray-700 hover:bg-gray-50"
              >
                <Pencil className="h-3.5 w-3.5 shrink-0 text-gray-500" />
                Edit
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default IdentityLinkChip;
