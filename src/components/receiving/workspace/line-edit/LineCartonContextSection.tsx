'use client';

/**
 * Carton-context section of the LineEditPanel — photos + claim + shipment
 * context (listing, PO#, tracking, platform + type + priority pills) in one
 * WorkspaceCard. Pure wiring from the controller bag to {@link CartonContextCard};
 * extracted from LineEditPanel so the panel stays a short composition surface.
 */

import { CartonContextCard } from './CartonContextCard';
import { dispatchLineUpdated, type ReceivingLineRow } from '@/components/station/ReceivingLinesTable';
import type { UnboxLineController } from './unbox-line-controller';

interface LineCartonContextSectionProps {
  row: ReceivingLineRow;
  staffId: string;
  c: UnboxLineController;
}

// The carton-context card (photos + claim) is identical in unbox and triage —
// both always show the staff photo row and the Claim action — so this section
// needs no mode/variant input.
export function LineCartonContextSection({ row, staffId, c }: LineCartonContextSectionProps) {
  return (
    <CartonContextCard
      receivingId={row.receiving_id ?? null}
      staffId={staffId}
      isUnmatched={row.receiving_source === 'unmatched'}
      showStaffPhotoRow
      onMakeClaim={() => c.setClaimModalOpen(true)}
      listingLink={c.listingLink}
      setListingLink={c.setListingLink}
      listingEditorOpen={c.listingEditorOpen}
      setListingEditorOpen={c.setListingEditorOpen}
      listingOpenHref={c.listingOpenHref}
      listingLinks={c.listingLinks}
      poOpenHref={c.poOpenHref}
      trackingOpenHref={c.trackingOpenHref}
      poDisplay={c.poNumber}
      poEditorOpen={c.poEditorOpen}
      setPoEditorOpen={c.setPoEditorOpen}
      poNumberEdit={c.poNumberEdit}
      setPoNumberEdit={c.setPoNumberEdit}
      // Try a sales-order import first (an order# → classify the carton as a
      // return), falling back to a plain PO# persist. The changed-check + both
      // paths live in the controller method.
      onCommitPoNumber={(v) => void c.commitPoNumberOrImportOrder(v)}
      lineId={row.id ?? null}
      zendeskTrimmed={c.zendeskTrimmed}
      zendeskHref={c.zendeskHref}
      zendeskChipDisplay={c.zendeskChipDisplay}
      providerTicketId={c.providerTicketId}
      onTicketUnlinked={() => {
        void c.invalidateSupportTicket();
      }}
      primaryTrackingTrimmed={c.primaryTrackingTrimmed}
      filledExtraTrackingsCount={c.filledExtraTrackingsCount}
      trackingEditorsOpen={c.trackingEditorsOpen}
      onToggleTrackingEditors={c.toggleTrackingEditors}
      trackingEdit={c.trackingEdit}
      setTrackingEdit={c.setTrackingEdit}
      onCommitTracking={(v) => {
        const trimmed = v.trim();
        if (trimmed !== (row.tracking_number || '').trim()) {
          c.patch({ zoho_reference_number: trimmed || null });
        }
      }}
      extraTrackings={c.extraTrackings}
      setExtraTrackings={c.setExtraTrackings}
      onCommitExtraTracking={(v, i) => void c.attachExtraBox(v, i)}
      platformValue={c.sourcePlatform}
      onPlatformSelect={(next) => {
        c.setSourcePlatform(next);
        void c.savePlatform(next);
      }}
      receivingType={c.receivingType}
      onTypeSelect={(next) => {
        // Carton default now — persists to receiving.intake_type. Per-line
        // overrides (receiving_lines.receiving_type) are set in the PO-items row.
        c.setReceivingType(next);
        void c.saveType(next);
      }}
      priorityTier={c.priorityTier}
      onPrioritySelect={(tier) => void c.handlePrioritySelect(tier)}
    />
  );
}
