'use client';

/**
 * Fixed-width identity chip used across the condensed carton row: a consistent
 * `[external-link] · [copy value] · [edit]` unit. Every instance — listing,
 * PO# (→ Zoho), tracking# (→ carrier) — gets the same external-link button, the
 * same copy affordance ({@link CopyChip}), and the same width so the row reads
 * as one aligned set instead of three bespoke chips.
 *
 * The external-link button (left) opens `openHref`; the middle copies `value`;
 * the optional pencil (right) toggles that field's below-row editor.
 */

import { ExternalLink, Pencil } from '@/components/Icons';
import { CopyChip, type ChipTone } from '@/components/ui/CopyChip';
import { RECEIVING_CHIP_EDIT_BTN_CLASS } from '@/components/sidebar/receiving/receiving-sidebar-shared';

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
}) {
  return (
    <div className={`flex items-center gap-0.5 ${grow ? 'min-w-0 flex-1' : 'shrink-0'}`}>
      <button
        type="button"
        disabled={!openHref}
        onClick={(e) => {
          e.stopPropagation();
          if (openHref) window.open(openHref, '_blank', 'noopener,noreferrer');
        }}
        aria-label={openTitle}
        title={openHref ? openTitle : 'No link available'}
        className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-100 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-35"
      >
        <ExternalLink className="h-3.5 w-3.5 shrink-0" />
      </button>
      <CopyChip
        value={value}
        display={display}
        tone={tone}
        underlineClass={underlineClass}
        iconClass={iconClass}
        width={grow ? 'min-w-0 flex-1 max-w-full' : 'w-auto'}
        outerPad="flush"
        disableCopy={disableCopy}
        fitDisplayWidth={!grow}
        truncateDisplay={grow}
      />
      {onEdit ? (
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
    </div>
  );
}

export default IdentityLinkChip;
