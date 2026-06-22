import { CartonContextCard } from '@/components/receiving/workspace/line-edit/CartonContextCard';
import { dispatchLineUpdated, type ReceivingLineRow } from '@/components/station/ReceivingLinesTable';
import type { TestingController } from './testing-panel-types';

/**
 * The shared CartonContextCard header, wired to the testing-line controller —
 * PO / tracking / listing / platform / type / priority editors + claim CTA.
 */
export function TestingCartonHeader({
  c,
  row,
  staffId,
}: {
  c: TestingController;
  row: ReceivingLineRow;
  staffId: string;
}) {
  return (
    <CartonContextCard
      receivingId={row.receiving_id ?? null}
      staffId={staffId}
      isUnmatched={row.receiving_source === 'unmatched'}
      showStaffPhotoRow
      onMakeClaim={() => c.setClaimOpen(true)}
      listingLink={c.listingLink}
      setListingLink={c.setListingLink}
      listingEditorOpen={c.listingEditorOpen}
      setListingEditorOpen={c.setListingEditorOpen}
      listingOpenHref={c.listingOpenHref}
      poOpenHref={c.poOpenHref}
      trackingOpenHref={c.trackingOpenHref}
      poDisplay={c.poNumber}
      poEditorOpen={c.poEditorOpen}
      setPoEditorOpen={c.setPoEditorOpen}
      poNumberEdit={c.poNumberEdit}
      setPoNumberEdit={c.setPoNumberEdit}
      onCommitPoNumber={(v) => {
        const trimmed = v.trim();
        const current = (row.zoho_purchaseorder_number || row.zoho_purchaseorder_id || '').trim();
        if (trimmed !== current) void c.persistPoNumber(trimmed);
      }}
      lineId={row.id ?? null}
      zendeskTrimmed={c.zendeskTrimmed}
      zendeskHref={c.zendeskHref}
      zendeskChipDisplay={c.zendeskChipDisplay}
      onTicketUnlinked={() => {
        c.setZendesk('');
        dispatchLineUpdated({ id: row.id, zendesk_ticket: null, notes: row.notes });
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
        c.setReceivingType(next);
        void c.saveType(next);
      }}
      priorityTier={c.priorityTier}
      onPrioritySelect={(tier) => void c.handlePrioritySelect(tier)}
    />
  );
}
