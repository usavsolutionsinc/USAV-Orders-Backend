'use client';

import { useRef, type Dispatch, type SetStateAction } from 'react';
import { Barcode, ExternalLink, Pencil, Plus } from '@/components/Icons';
import { ListingUrlChip, TrackingChip, OrderIdChip, TicketChip, getLast4 } from '@/components/ui/CopyChip';
import { SearchBar } from '@/components/ui/SearchBar';
import { WorkspaceCard } from '@/design-system/components';
import { ReceivingCartonStaffDropdown } from '@/components/sidebar/receiving/ReceivingCartonStaffDropdown';
import {
  FLOW_SECTION_LABEL,
  RECEIVING_SCAN_RULE_LINE_CLASS,
  RECEIVING_TRAIL_SLOT_CLASS,
  TRACKING_ADD_BTN_CLASS,
  RECEIVING_CHIP_EDIT_BTN_CLASS,
} from '@/components/sidebar/receiving/receiving-sidebar-shared';
import { SourcePlatformPills } from './SourcePlatformPills';
import { ReceivingTypePills } from './ReceivingTypePills';
import { receivingPriorityRank } from './receiving-priority';

/**
 * Carton-level context card: staff dropdown + photo strip, the listing /
 * Zendesk / PO# / tracking chip row, the matching below-row inline editors,
 * and the source-platform + receiving-type pickers.
 *
 * Layout decisions preserved from the original inline implementation:
 *  - The listing chip is hidden when the URL is empty AND its editor is closed
 *    (unmatched cartons have no listing until a PO# binds them).
 *  - When the PO# editor is open and the listing slot is free, the PO# input
 *    promotes from a compact chip+pencil to a full-width inline SearchBar; the
 *    below-row PO# editor is skipped in that case to avoid a duplicate input.
 *
 * Purely presentational/controlled — all state lives in the parent.
 */
export function CartonContextCard({
  receivingId,
  staffId,
  isUnmatched,
  onMakeClaim,
  showStaffPhotoRow = true,
  listingLink,
  setListingLink,
  listingEditorOpen,
  setListingEditorOpen,
  listingOpenHref,
  listingPreviewLabel,
  poDisplay,
  poEditorOpen,
  setPoEditorOpen,
  poNumberEdit,
  setPoNumberEdit,
  onCommitPoNumber,
  zendeskTrimmed,
  zendeskHref,
  zendeskChipDisplay,
  primaryTrackingTrimmed,
  filledExtraTrackingsCount,
  trackingEditorsOpen,
  onToggleTrackingEditors,
  trackingEdit,
  setTrackingEdit,
  onCommitTracking,
  extraTrackings,
  setExtraTrackings,
  platformValue,
  onPlatformSelect,
  receivingType,
  onTypeSelect,
}: {
  receivingId: number | null;
  staffId: string;
  isUnmatched: boolean;
  /** Opens the claim modal. Omit (undefined) to hide the Claim button. */
  onMakeClaim?: () => void;
  /** Photos + Claim row. Hidden in triage (unbox-only). */
  showStaffPhotoRow?: boolean;
  listingLink: string;
  setListingLink: (v: string) => void;
  listingEditorOpen: boolean;
  setListingEditorOpen: Dispatch<SetStateAction<boolean>>;
  listingOpenHref: string | null | undefined;
  listingPreviewLabel: string;
  /** Already-trimmed PO# (number ?? id) for the chip + editor seed. */
  poDisplay: string;
  poEditorOpen: boolean;
  setPoEditorOpen: Dispatch<SetStateAction<boolean>>;
  poNumberEdit: string;
  setPoNumberEdit: (v: string) => void;
  /** Commit a typed/scanned PO# (parent decides whether it changed). */
  onCommitPoNumber: (raw: string) => void;
  zendeskTrimmed: string;
  zendeskHref: string | null | undefined;
  zendeskChipDisplay: string;
  primaryTrackingTrimmed: string;
  filledExtraTrackingsCount: number;
  trackingEditorsOpen: boolean;
  onToggleTrackingEditors: () => void;
  trackingEdit: string;
  setTrackingEdit: (v: string) => void;
  /** Commit a typed/scanned primary tracking# (parent decides if it changed). */
  onCommitTracking: (raw: string) => void;
  extraTrackings: string[];
  setExtraTrackings: Dispatch<SetStateAction<string[]>>;
  platformValue: string;
  onPlatformSelect: (v: string) => void;
  receivingType: string;
  onTypeSelect: (v: string) => void;
}) {
  const listingRef = useRef<HTMLInputElement>(null);
  const poInputRef = useRef<HTMLInputElement>(null);

  const showListing = listingLink.trim().length > 0 || listingEditorOpen;
  const inlinePoInput = poEditorOpen && !showListing;
  const poBelow = poEditorOpen && (listingLink.trim().length > 0 || listingEditorOpen);
  const anyBelow = trackingEditorsOpen || listingEditorOpen || poBelow;

  return (
    <WorkspaceCard bodyClassName="px-0 py-0">
      {showStaffPhotoRow ? (
        <ReceivingCartonStaffDropdown
          receivingId={receivingId}
          staffId={staffId}
          priorityRank={receivingPriorityRank(isUnmatched, platformValue)}
          onMakeClaim={onMakeClaim}
        />
      ) : null}
      {/* Padding + top rule separate the photo strip from chips; keeps pill
          focus rings from clipping vs a tight body. */}
      <div className="space-y-2 border-t border-gray-100 px-4 pt-2 pb-3">
        <div className="flex min-w-0 flex-col gap-y-1">
          {/* Chip row uses items-center so listing URL chip, PO chip, and
              tracking chip share the same vertical baseline regardless of
              their internal height differences. */}
          <div className="flex min-w-0 items-center gap-2">
            {showListing ? (
              <div className="flex min-w-0 flex-1 basis-0 items-center gap-1">
                <ListingUrlChip
                  rawUrl={listingLink}
                  openHref={listingOpenHref ?? null}
                  previewDisplay={listingPreviewLabel}
                />
                <button
                  type="button"
                  onClick={() => {
                    setListingEditorOpen((v) => {
                      const next = !v;
                      if (next) queueMicrotask(() => listingRef.current?.focus());
                      return next;
                    });
                  }}
                  aria-expanded={listingEditorOpen}
                  aria-label={listingEditorOpen ? 'Collapse listing URL editor' : 'Edit listing URL'}
                  title={listingEditorOpen ? 'Done editing listing' : 'Edit listing URL'}
                  className={RECEIVING_CHIP_EDIT_BTN_CLASS}
                >
                  <Pencil className="h-3 w-3" />
                </button>
              </div>
            ) : null}
            {zendeskTrimmed ? (
              <div className="flex shrink-0 items-center justify-end gap-1">
                {zendeskHref ? (
                  <a
                    href={zendeskHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Open Zendesk ticket"
                    title="Open in Zendesk"
                    className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-100 hover:text-blue-600"
                  >
                    <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                  </a>
                ) : null}
                <TicketChip value={zendeskTrimmed} display={zendeskChipDisplay} />
              </div>
            ) : null}
            {inlinePoInput ? (
              <div className="flex min-w-0 flex-1 basis-0 items-center gap-1">
                <div className="group min-w-0 flex-1">
                  <SearchBar
                    value={poNumberEdit}
                    onChange={setPoNumberEdit}
                    onSearch={onCommitPoNumber}
                    inputRef={poInputRef}
                    placeholder="Enter PO# to bind this carton (e.g. PO-1234)"
                    variant="blue"
                    size="compact"
                    hideUnderline
                    pasteOnlyTrailing
                    className="w-full"
                  />
                  <div className={RECEIVING_SCAN_RULE_LINE_CLASS} aria-hidden />
                </div>
              </div>
            ) : (
              <div className="flex shrink-0 items-center gap-1">
                <OrderIdChip value={poDisplay} display={poDisplay ? getLast4(poDisplay) : '----'} />
                <button
                  type="button"
                  onClick={() => {
                    setPoEditorOpen((v) => {
                      const next = !v;
                      if (next) queueMicrotask(() => poInputRef.current?.focus());
                      return next;
                    });
                  }}
                  aria-expanded={poEditorOpen}
                  aria-label={poEditorOpen ? 'Collapse PO# editor' : 'Edit PO#'}
                  title={poEditorOpen ? 'Done editing PO#' : 'Edit PO#'}
                  className={RECEIVING_CHIP_EDIT_BTN_CLASS}
                >
                  <Pencil className="h-3 w-3" />
                </button>
              </div>
            )}
            <div className="flex shrink-0 items-center gap-1">
              <div className="flex items-center gap-1">
                <div className="min-w-0 max-w-full [&_.relative]:max-w-full">
                  <TrackingChip
                    value={primaryTrackingTrimmed}
                    display={getLast4(primaryTrackingTrimmed)}
                    disableCopy={!primaryTrackingTrimmed}
                    width="min-w-0 max-w-full"
                  />
                </div>
                {filledExtraTrackingsCount > 0 ? (
                  <span className="shrink-0 rounded bg-slate-200/90 px-1 py-px text-eyebrow font-black tabular-nums text-slate-700">
                    +{filledExtraTrackingsCount}
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={onToggleTrackingEditors}
                  aria-expanded={trackingEditorsOpen}
                  aria-label={trackingEditorsOpen ? 'Collapse tracking editors' : 'Edit tracking numbers'}
                  title={trackingEditorsOpen ? 'Done editing tracking' : 'Edit tracking'}
                  className={RECEIVING_CHIP_EDIT_BTN_CLASS}
                >
                  <Pencil className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>

          {/* Below-row inline editors. The PO# editor is rendered inline in the
              chip row above when the listing slot is free — so we skip the PO#
              block (and the whole wrapper, if nothing else is open) here. */}
          {anyBelow ? (
            <div className="mt-2 space-y-2.5 border-t border-slate-100 pt-2">
              {poBelow ? (
                <div>
                  <span className={`${FLOW_SECTION_LABEL} mb-1 leading-none`}>PO number</span>
                  <div className="group">
                    <SearchBar
                      value={poNumberEdit}
                      onChange={setPoNumberEdit}
                      onSearch={onCommitPoNumber}
                      inputRef={poInputRef}
                      placeholder="PO-1234"
                      variant="blue"
                      size="compact"
                      hideUnderline
                      pasteOnlyTrailing
                      className="w-full"
                    />
                    <div className={RECEIVING_SCAN_RULE_LINE_CLASS} aria-hidden />
                  </div>
                </div>
              ) : null}
              {trackingEditorsOpen ? (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <span className={`${FLOW_SECTION_LABEL} mb-0 leading-none`}>Tracking number</span>
                    <span className={RECEIVING_TRAIL_SLOT_CLASS}>
                      <button
                        type="button"
                        onClick={() => setExtraTrackings((xs) => (xs.length >= 1 ? xs : [...xs, '']))}
                        disabled={extraTrackings.length >= 1}
                        aria-label="Add second tracking number row"
                        title={extraTrackings.length >= 1 ? 'Only one extra tracking row' : 'Add tracking number'}
                        className={TRACKING_ADD_BTN_CLASS}
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </span>
                  </div>
                  <div className="group min-w-0">
                    <SearchBar
                      value={trackingEdit}
                      onChange={setTrackingEdit}
                      onSearch={onCommitTracking}
                      placeholder="Tracking"
                      variant="blue"
                      size="compact"
                      hideUnderline
                      pasteOnlyTrailing
                      leadingIcon={<Barcode className="h-[14px] w-[14px]" />}
                      className="w-full min-w-0"
                    />
                    <div className={RECEIVING_SCAN_RULE_LINE_CLASS} aria-hidden />
                  </div>
                  {extraTrackings.map((t, i) => (
                    <div key={i} className="group min-w-0">
                      <SearchBar
                        value={t}
                        onChange={(v) => setExtraTrackings((xs) => xs.map((x, j) => (j === i ? v : x)))}
                        placeholder="Tracking"
                        variant="blue"
                        size="compact"
                        hideUnderline
                        debounceMs={0}
                        pasteOnlyTrailing
                        leadingIcon={<Barcode className="h-[14px] w-[14px]" />}
                        className="w-full min-w-0"
                      />
                      <div className={RECEIVING_SCAN_RULE_LINE_CLASS} aria-hidden />
                    </div>
                  ))}
                </>
              ) : null}
              {listingEditorOpen ? (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <span className={`${FLOW_SECTION_LABEL} mb-0 leading-none`}>Listing URL</span>
                    <span className={RECEIVING_TRAIL_SLOT_CLASS} aria-hidden />
                  </div>
                  <div className="group">
                    <SearchBar
                      value={listingLink}
                      onChange={setListingLink}
                      onClear={() => setListingLink('')}
                      inputRef={listingRef}
                      placeholder="Listing URL"
                      variant="blue"
                      size="compact"
                      hideUnderline
                      leadingIcon={
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            if (listingOpenHref) {
                              window.open(listingOpenHref, '_blank', 'noopener,noreferrer');
                            }
                          }}
                          disabled={listingOpenHref == null}
                          aria-label="Open listing URL in new tab"
                          title={listingOpenHref ? 'Open link' : 'Enter a valid URL'}
                          className="-m-0.5 rounded p-0.5 text-inherit transition-colors hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-35"
                        >
                          <ExternalLink className="h-[14px] w-[14px]" />
                        </button>
                      }
                      className="w-full"
                    />
                    <div className={RECEIVING_SCAN_RULE_LINE_CLASS} aria-hidden />
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Platform (left, scrolls) + Type (right). */}
        <div className="flex min-w-0 flex-nowrap items-center gap-3">
          <SourcePlatformPills
            disabled={receivingId == null}
            isUnmatched={isUnmatched}
            value={platformValue}
            onSelect={onPlatformSelect}
          />
          <span className="h-6 w-px shrink-0 self-center bg-slate-200" aria-hidden />
          <ReceivingTypePills value={receivingType} onSelect={onTypeSelect} />
        </div>
      </div>
    </WorkspaceCard>
  );
}
