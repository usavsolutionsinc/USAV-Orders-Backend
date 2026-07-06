'use client';

import { useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Barcode, ExternalLink, Plus, X } from '@/components/Icons';
import { getLast4 } from '@/components/ui/CopyChip';
import { SearchBar } from '@/components/ui/SearchBar';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { WorkspaceCard } from '@/design-system/components';
import { Button, IconButton } from '@/design-system/primitives';
import {
  FLOW_SECTION_LABEL,
  RECEIVING_SCAN_RULE_LINE_CLASS,
  TRACKING_ADD_BTN_CLASS,
} from '@/components/sidebar/receiving/receiving-sidebar-shared';
import { ReceivingPhotoButton } from './ReceivingPhotoButton';
import { IdentityLinkChip } from './IdentityLinkChip';
import { ReceivingTicketChip } from './ReceivingTicketChip';
import { SellerMessageChip } from './SellerMessageChip';
import { InlinePillPicker, type InlinePillOption } from './InlinePillPicker';
import { receivingPriorityRank, receivingPriorityTone } from './receiving-priority';
import { PRIORITY_OVERRIDE_TIERS, priorityOverrideTier } from '@/lib/receiving/priority-override';
import { usePlatformCatalog, useReceivingTypeCatalog, usePlatformMeta } from '@/hooks/useCatalog';
import type { CartonListingLink } from '@/lib/receiving/listing-links';


/**
 * Carton-level context card: staff dropdown + photo strip, the listing /
 * Zendesk / PO# / tracking chip row, the matching below-row inline editors,
 * and the source-platform + receiving-type pickers.
 *
 * DENSITY CONTRACT: this is an operations-heavy surface — everything stays on
 * ONE condensed row (pills + chips + actions), with editors sliding in below
 * on demand. Do not regroup it into stacked form sections; the one-row
 * anatomy is the display method. The card renders on the frosted glass
 * workspace surface (`WorkspaceCard variant="glass"`) shared by the whole
 * unbox column.
 *
 * Layout decisions preserved from the original inline implementation:
 *  - The listing chip reads "----" (gray, no platform tone) until a URL or a
 *    derived storefront href exists (unmatched cartons have no listing until a
 *    PO# binds them).
 *  - All three identity editors (PO# / tracking / listing URL) live in the
 *    below-row drawer; the condensed top row stays chips + hover menus only.
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
  listingLinks = [],
  poOpenHref,
  trackingOpenHref,
  poDisplay,
  poEditorOpen,
  setPoEditorOpen,
  poNumberEdit,
  setPoNumberEdit,
  onCommitPoNumber,
  lineId,
  zendeskTrimmed,
  zendeskHref,
  zendeskChipDisplay,
  providerTicketId = null,
  onTicketUnlinked,
  primaryTrackingTrimmed,
  filledExtraTrackingsCount,
  trackingEditorsOpen,
  onToggleTrackingEditors,
  trackingEdit,
  setTrackingEdit,
  onCommitTracking,
  extraTrackings,
  setExtraTrackings,
  onCommitExtraTracking,
  platformValue,
  onPlatformSelect,
  receivingType,
  onTypeSelect,
  priorityTier = null,
  onPrioritySelect,
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
  /** All resolvable listing URLs (inventory catalog + manual + derived). */
  listingLinks?: CartonListingLink[];
  /** External link target for the PO# chip (Zoho purchase order). */
  poOpenHref: string | null | undefined;
  /** External link target for the tracking# chip (carrier tracking page). */
  trackingOpenHref: string | null | undefined;
  /** Already-trimmed PO# (number ?? id) for the chip + editor seed. */
  poDisplay: string;
  poEditorOpen: boolean;
  setPoEditorOpen: Dispatch<SetStateAction<boolean>>;
  poNumberEdit: string;
  setPoNumberEdit: (v: string) => void;
  /** Commit a typed/scanned PO# (parent decides whether it changed). */
  onCommitPoNumber: (raw: string) => void;
  /** Active line id — the entity a filed ticket is linked to (RECEIVING_LINE). */
  lineId: number | null;
  zendeskTrimmed: string;
  zendeskHref: string | null | undefined;
  zendeskChipDisplay: string;
  providerTicketId?: number | null;
  /** Called after the ticket chip's popover unlinks the ticket — clears it. */
  onTicketUnlinked?: () => void;
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
  /**
   * Commit a typed/scanned EXTRA tracking# — attaches it to the carton's PO as
   * an additional box (POST /api/receiving/[id]/attach-box). Unlike the primary
   * tracking (which is the Zoho reference# anchor), extras link via the
   * receiving_shipments junction. docs/multi-tracking-po-plan.md Phase 1.
   */
  onCommitExtraTracking?: (raw: string, index: number) => void;
  platformValue: string;
  onPlatformSelect: (v: string) => void;
  receivingType: string;
  onTypeSelect: (v: string) => void;
  /** Manual priority-tier override (receiving.priority_tier): null = Auto, 0..3. */
  priorityTier?: number | null;
  /** Set/clear the priority tier (null = Auto). Omit to render urgency display-only. */
  onPrioritySelect?: (tier: number | null) => void;
}) {
  const listingRef = useRef<HTMLInputElement>(null);
  const poInputRef = useRef<HTMLInputElement>(null);

  // One picker open at a time. Opening any pill unrenders the trailing chip
  // cluster (the options fill the freed row); selecting / dismissing collapses
  // back to null and rerenders the chips. See the AnimatePresence swap below.
  const [openPicker, setOpenPicker] = useState<'urgency' | 'platform' | 'type' | null>(null);

  // Canonical platform tone/label for the listing chip — same SoT the platform
  // pill and printed label read, so a platform never presents two ways.
  // Org-editable platform/type catalogs drive the pickers below (fall back to
  // the built-in lists until seeded). The platform tone/label resolver reads
  // the catalog too, so a renamed or custom platform reads correctly here.
  const platformCatalog = usePlatformCatalog();
  const typeCatalog = useReceivingTypeCatalog();
  const resolvePlatformMeta = usePlatformMeta();
  const platformMeta = resolvePlatformMeta(platformValue);

  // An imported return shows its PLATFORM on the listing chip; its originating
  // ORDER# stays a SEPARATE copy chip (the PO#/order# slot below), so the listing
  // link and the order id each copy/open on their own — never glued into one
  // "Amazon · <order#>" chip. poDisplay carries the order# (the import sets
  // receiving.zoho_purchaseorder_number as the display representative).
  const isReturn = receivingType.trim().toUpperCase() === 'RETURN';
  const listingHasTarget = !!(listingLink || listingOpenHref);
  const listingLinkOptions =
    listingLinks.length > 1
      ? listingLinks.map((l) => ({ href: l.href, label: l.label }))
      : undefined;
  const listingChipDisplay = isReturn
    ? platformValue
      ? platformMeta.label
      : 'Return'
    : listingHasTarget
      ? platformValue
        ? platformMeta.label
        : isUnmatched
          ? 'Unfound'
          : 'Listing'
      : '----';

  // Urgency is a tier picker: Auto + Priority/High/Medium/Low. Collapsed it
  // shows the *effective* tier — the manual override when set, else the
  // platform-derived rank (so a no-override carton still reads its auto urgency
  // at rest). Open it offers Auto (clear → derived) + the four manual tiers.
  const derivedRank = receivingPriorityRank(isUnmatched, platformValue, false);
  const derivedTone = receivingPriorityTone(derivedRank);
  const overrideMeta = priorityOverrideTier(priorityTier);
  const urgencyValue = priorityTier != null ? String(priorityTier) : 'auto';
  const effectiveUrgencyLabel = overrideMeta ? overrideMeta.label : derivedTone.label;
  const effectiveUrgencyClass = overrideMeta
    ? overrideMeta.activeClass
    : `${derivedTone.className} border-transparent`;
  // In Auto mode the option matching the platform-derived urgency renders in
  // its active tone — the collapsed pill shows that derived label, so an open
  // picker highlighting only "Auto" read as if the current urgency were
  // unselected. Rank→tier mapping: Priority 0→0, unfound/untagged 1→High 1,
  // Amazon 2→High 1, eBay 3→Medium 2, Goodwill 4→Low 3; Other (9) highlights
  // nothing. Manual override set → normal value-match highlighting only.
  const RANK_TO_TIER: Record<number, number> = { 0: 0, 1: 1, 2: 1, 3: 2, 4: 3 };
  const derivedTierEquivalent = priorityTier == null ? RANK_TO_TIER[derivedRank] ?? null : null;
  const urgencyOptions: InlinePillOption[] = [
    {
      value: 'auto',
      label: 'Auto',
      title: `Auto — follows platform (${derivedTone.label})`,
      activeClass: 'border-border-default bg-surface-card text-text-muted',
      inactiveClass:
        'border-border-soft bg-surface-card/70 text-text-soft hover:border-border-default hover:bg-surface-hover',
    },
    ...PRIORITY_OVERRIDE_TIERS.map((t) => ({
      value: String(t.value),
      label: t.label,
      title:
        derivedTierEquivalent === t.value
          ? `${t.title} — current (auto from platform); click to pin`
          : t.title,
      activeClass: t.activeClass,
      inactiveClass: derivedTierEquivalent === t.value ? t.activeClass : t.inactiveClass,
    })),
  ];
  const handleUrgencySelect = (v: string) =>
    onPrioritySelect?.(v === 'auto' ? null : Number(v));

  // All three identity editors now live in the below-row drawer — the condensed
  // top row is chips + pencils only.
  // The PO# editor is suppressed once the carton is an imported return — a
  // return is keyed by its order number (shown on the listing chip), not a PO.
  const anyBelow = trackingEditorsOpen || listingEditorOpen || (poEditorOpen && !isReturn);

  // Platform/Type pill options come straight from the org catalog (active rows,
  // org sort order) — so renames, hides, reorders, and custom entries the org
  // makes in the catalog manager all propagate here. Falls back to the built-in
  // lists until the catalog is seeded. The synthesized amber "Unfound" pill
  // leads the platform set for unmatched cartons (front-end only — never written
  // to source_platform).
  const platformOptions: InlinePillOption[] = [
    ...(isUnmatched
      ? [
          {
            value: '',
            label: 'Unfound',
            title: 'No Zoho PO matched this carton',
            activeClass: 'border-amber-600 bg-amber-500 text-white',
            inactiveClass:
              'border-amber-200 bg-amber-50 text-amber-700 hover:border-amber-300 hover:bg-amber-100',
          } as InlinePillOption,
        ]
      : []),
    ...platformCatalog.options.map((o) => ({ value: o.value, label: o.label })),
  ];
  const typeOptions: InlinePillOption[] = typeCatalog.options
    .filter((o) => o.value !== 'PICKUP')
    .map((o) => ({ value: o.value, label: o.label }));

  return (
    <WorkspaceCard variant="glass" bodyClassName="px-0 py-0" overflow="visible">
      <div className="space-y-2 px-4 pt-2 pb-3">
        <div className="flex min-w-0 flex-col gap-y-1">
          {/* Condensed identity row — Priority · Platform · Type · listing ·
              PO# · tracking# · Claim · Photos. Platform/Type collapse to the
              active pill and expand inline on click; listing/PO#/tracking are
              compact chips with hover Open/Edit menus. Priority/Claim/Photos
              are unbox-only (hidden in triage). */}
          <div className="flex min-w-0 items-center">
            <AnimatePresence mode="wait" initial={false}>
              {openPicker === null ? (
                <motion.div
                  key="bar"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.12 }}
                  className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
                >
            {/* Urgency · Platform · Type — one shared pill primitive, all
                collapse-to-active. Clicking any opens it full-width and
                unrenders the trailing chip cluster (the options take the freed
                row); selecting collapses back and rerenders them. */}
            {showStaffPhotoRow ? (
              <InlinePillPicker
                ariaLabel="Urgency"
                options={urgencyOptions}
                value={urgencyValue}
                onSelect={handleUrgencySelect}
                collapsedLabel={effectiveUrgencyLabel}
                collapsedClass={effectiveUrgencyClass}
                open={false}
                onOpenChange={(o) => { if (o) setOpenPicker('urgency'); }}
                disabled={!onPrioritySelect}
              />
            ) : null}
            <InlinePillPicker
              ariaLabel="Platform"
              options={platformOptions}
              value={platformValue}
              onSelect={onPlatformSelect}
              open={false}
              onOpenChange={(o) => { if (o) setOpenPicker('platform'); }}
              disabled={receivingId == null}
              placeholder={isUnmatched ? 'Unfound' : 'Platform'}
            />
            <InlinePillPicker
              ariaLabel="Type"
              options={typeOptions}
              value={receivingType}
              onSelect={onTypeSelect}
              open={false}
              onOpenChange={(o) => { if (o) setOpenPicker('type'); }}
              placeholder="Type"
            />

            {/* Listing — the complete platform-colored chip opens the listing.
                Its hover menu offers Copy, then Edit. It is labeled by the
                canonical platform (SoT) with the matching tone so it reads
                consistently with the Platform pill. The only wide chip. */}
            <IdentityLinkChip
              grow
              openHref={listingOpenHref}
              openTitle="Open listing in new tab"
              linkOptions={listingLinkOptions}
              // An explicit pasted URL wins; otherwise fall back to the derived
              // storefront href (listingOpenHref) so the chip reads as a real,
              // copyable/openable Listing instead of "----".
              value={listingLink || listingOpenHref || ''}
              // Imported return → the platform label; otherwise the platform /
              // Unfound / Listing label (or "----" when nothing's bound yet).
              display={listingChipDisplay}
              // Platform tone ONLY when there's an actual listing to open. With
              // no link the chip isn't a live link, so it reads gray rather than
              // painting a platform color it can't act on.
              underlineClass={listingHasTarget && platformValue ? platformMeta.border : 'border-border-default'}
              iconClass={listingHasTarget && platformValue ? platformMeta.text : 'text-text-faint'}
              disableCopy={!(listingLink.trim() || listingOpenHref)}
              onEdit={() => {
                setListingEditorOpen((v) => {
                  const next = !v;
                  if (next) queueMicrotask(() => listingRef.current?.focus());
                  return next;
                });
              }}
              editOpen={listingEditorOpen}
              editLabel="Edit listing URL"
              actionsInMenu
              chipAction="open"
              showExternalIcon
              menuFirstAction="copy"
            />

            {/* PO# — or, for an imported RETURN, the originating ORDER# kept as
                its OWN copy chip, SEPARATE from the listing link (which stays
                just the platform). The order# isn't a Zoho PO, so it's copy-only:
                no Zoho open, no inline editor. Normal POs keep open + edit. */}
            <IdentityLinkChip
              openHref={isReturn ? undefined : poOpenHref}
              openTitle={isReturn ? 'Order number' : 'Open PO in Zoho'}
              value={poDisplay}
              display={poDisplay ? getLast4(poDisplay) : '----'}
              tone="id"
              underlineClass="border-border-emphasis"
              disableCopy={!poDisplay}
              onEdit={
                isReturn
                  ? undefined
                  : () => {
                      setPoEditorOpen((v) => {
                        const next = !v;
                        if (next) queueMicrotask(() => poInputRef.current?.focus());
                        return next;
                      });
                    }
              }
              editOpen={isReturn ? false : poEditorOpen}
              editLabel={isReturn ? undefined : 'Edit PO#'}
              actionsInMenu
            />

            {/* Tracking# — chip click copies; hover menu opens carrier tracking
                or edits the primary/extra tracking values. */}
            <div className="flex shrink-0 items-center gap-1">
              <IdentityLinkChip
                openHref={trackingOpenHref}
                openTitle="Open carrier tracking"
                value={primaryTrackingTrimmed}
                display={primaryTrackingTrimmed ? getLast4(primaryTrackingTrimmed) : '----'}
                tone="tracking"
                underlineClass="border-blue-500"
                disableCopy={!primaryTrackingTrimmed}
                onEdit={onToggleTrackingEditors}
                editOpen={trackingEditorsOpen}
                editLabel="Edit tracking"
                actionsInMenu
              />
              {filledExtraTrackingsCount > 0 ? (
                <HoverTooltip
                  label={`${filledExtraTrackingsCount} extra box${filledExtraTrackingsCount === 1 ? '' : 'es'} on this PO`}
                  asChild
                >
                  <span className="shrink-0 rounded bg-surface-strong/90 px-1 py-px text-eyebrow font-black tabular-nums text-text-muted">
                    +{filledExtraTrackingsCount}
                  </span>
                </HoverTooltip>
              ) : null}
            </div>

            {/* Claim renders with the rest of the identity row; when a filed
                ticket resolves from support_tickets it swaps to the ticket chip.
                Same IdentityLinkChip primitive as PO#/tracking (flush spacing,
                tone-driven `#` icon): chip copies, hover menu opens Zendesk or
                shows ticket history (with Unlink) via Edit. */}
            {showStaffPhotoRow ? (
              zendeskTrimmed ? (
                <div className="flex shrink-0 items-center gap-1">
                  <ReceivingTicketChip
                    value={zendeskTrimmed}
                    display={zendeskChipDisplay}
                    openHref={zendeskHref}
                    providerTicketId={providerTicketId}
                    receivingId={receivingId}
                    lineId={lineId}
                    onUnlinked={() => onTicketUnlinked?.()}
                  />
                  <SellerMessageChip
                    receivingId={receivingId}
                    lineId={lineId}
                    linkedTicketId={providerTicketId}
                  />
                </div>
              ) : onMakeClaim ? (
                <HoverTooltip label="File a damage / wrong-item / missing claim for this package" asChild>
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={onMakeClaim}
                    ariaLabel="File claim"
                    // Quiet, secondary chip — Claim is an exception path, so it must
                    // not compete with the green Receive for "the action" (analysis #4).
                    className="h-8 w-[50.32px] shrink-0 self-center rounded-full bg-orange-50 px-0 text-micro font-black uppercase leading-none tracking-wide text-orange-700 shadow-none ring-1 ring-inset ring-orange-200 hover:bg-orange-100 active:bg-orange-100"
                  >
                    Claim
                  </Button>
                </HoverTooltip>
              ) : null
            ) : null}

            {/* Photos — camera + ×N + send-to-phone (+); hover opens gallery. Unbox-only. */}
            {showStaffPhotoRow && receivingId != null ? (
              <ReceivingPhotoButton receivingId={receivingId} staffId={Number(staffId) || 0} />
            ) : null}
                </motion.div>
              ) : (
                <motion.div
                  key="picker"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.12 }}
                  className="flex min-w-0 flex-1 items-center"
                >
                  {/* Right side unrendered — the chosen picker owns the row.
                      Selecting (or click-away / Escape) returns openPicker to
                      null, swapping the chip cluster back in. */}
                  {openPicker === 'urgency' ? (
                    <InlinePillPicker
                      ariaLabel="Urgency"
                      options={urgencyOptions}
                      value={urgencyValue}
                      onSelect={handleUrgencySelect}
                      open
                      onOpenChange={(o) => { if (!o) setOpenPicker(null); }}
                    />
                  ) : openPicker === 'platform' ? (
                    <InlinePillPicker
                      ariaLabel="Platform"
                      options={platformOptions}
                      value={platformValue}
                      onSelect={onPlatformSelect}
                      open
                      onOpenChange={(o) => { if (!o) setOpenPicker(null); }}
                      placeholder={isUnmatched ? 'Unfound' : 'Platform'}
                    />
                  ) : (
                    <InlinePillPicker
                      ariaLabel="Type"
                      options={typeOptions}
                      value={receivingType}
                      onSelect={onTypeSelect}
                      open
                      onOpenChange={(o) => { if (!o) setOpenPicker(null); }}
                      placeholder="Type"
                    />
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Below-row inline editors for PO# / tracking / listing URL. */}
          {anyBelow ? (
            <div className="mt-2 space-y-2.5 border-t border-border-hairline pt-2">
              {poEditorOpen && !isReturn ? (
                <div className="relative">
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <span className={`${FLOW_SECTION_LABEL} mb-0 leading-none`}>PO number</span>
                    <HoverTooltip label="Close editor" asChild>
                      <IconButton
                        type="button"
                        onClick={() => setPoEditorOpen(false)}
                        ariaLabel="Close PO# editor"
                        className="rounded p-0.5 text-red-500 hover:bg-red-50 hover:text-red-600"
                        icon={<X className="h-3.5 w-3.5" />}
                      />
                    </HoverTooltip>
                  </div>
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
                <div className="relative">
                  <div className="flex items-start justify-between gap-2">
                    <span className={`${FLOW_SECTION_LABEL} mb-0 leading-none`}>Tracking number</span>
                    <span className="flex items-center gap-1">
                      <HoverTooltip
                        label={extraTrackings.length >= 1 ? 'Only one extra tracking row' : 'Add tracking number'}
                        asChild
                      >
                        <IconButton
                          type="button"
                          onClick={() => setExtraTrackings((xs) => (xs.length >= 1 ? xs : [...xs, '']))}
                          disabled={extraTrackings.length >= 1}
                          ariaLabel="Add second tracking number row"
                          className={TRACKING_ADD_BTN_CLASS}
                          icon={<Plus className="h-3 w-3" />}
                        />
                      </HoverTooltip>
                      <HoverTooltip label="Close editor" asChild>
                        <IconButton
                          type="button"
                          onClick={onToggleTrackingEditors}
                          ariaLabel="Close tracking editor"
                          className="rounded p-0.5 text-red-500 hover:bg-red-50 hover:text-red-600"
                          icon={<X className="h-3.5 w-3.5" />}
                        />
                      </HoverTooltip>
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
                        onSearch={(v) => onCommitExtraTracking?.(v, i)}
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
                </div>
              ) : null}
              {listingEditorOpen ? (
                <div className="relative">
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <span className={`${FLOW_SECTION_LABEL} mb-0 leading-none`}>Listing URL</span>
                    <HoverTooltip label="Close editor" asChild>
                      <IconButton
                        type="button"
                        onClick={() => setListingEditorOpen(false)}
                        ariaLabel="Close listing editor"
                        className="rounded p-0.5 text-red-500 hover:bg-red-50 hover:text-red-600"
                        icon={<X className="h-3.5 w-3.5" />}
                      />
                    </HoverTooltip>
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
                        <HoverTooltip label={listingOpenHref ? 'Open link' : 'Enter a valid URL'} asChild>
                          <IconButton
                            type="button"
                            tone="accent"
                            onClick={(e) => {
                              e.preventDefault();
                              if (listingOpenHref) {
                                window.open(listingOpenHref, '_blank', 'noopener,noreferrer');
                              }
                            }}
                            disabled={listingOpenHref == null}
                            ariaLabel="Open listing URL in new tab"
                            className="-m-0.5 rounded p-0.5 text-blue-600 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:text-text-faint disabled:opacity-60"
                            icon={<ExternalLink className="h-[14px] w-[14px]" />}
                          />
                        </HoverTooltip>
                      }
                      className="w-full"
                    />
                    <div className={RECEIVING_SCAN_RULE_LINE_CLASS} aria-hidden />
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </WorkspaceCard>
  );
}
