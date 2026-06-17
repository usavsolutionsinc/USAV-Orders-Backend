'use client';

/**
 * Right-pane workspace editor for a single receiving line — the UNBOX + TRIAGE
 * display, and the MASTER/anchor for the workspace UX. All form state, effects,
 * and handlers live in `useUnboxLineController` (which composes the mode-agnostic
 * `useReceivingLineCore`); this file is pure composition — it picks which shared
 * cards to render and gates the mode-specific ones via the `caps` matrix.
 *
 * The testing display (/tech) composes the SAME core + cards with its own
 * controller, so the carton/identity logic lives in exactly one place.
 */

import { useRouter } from 'next/navigation';
import { toast } from '@/lib/toast';
import { ReceiveResponsePanel } from './ReceiveResponsePanel';
import { ReceivingAuditModal } from './ReceivingAuditModal';
import { markConditionSet } from './ReceivingProgressStepper';
import { PoLinesAccordion } from './PoLinesAccordion';
import { UnmatchedItemsSection } from './UnmatchedItemsSection';
import { ReceivingClaimModal } from './ReceivingClaimModal';
import { workspaceCapabilities, type ReceivingWorkspaceVariant } from './workspace-capabilities';
import { LineNotesCard } from './line-edit/LineNotesCard';
import { LineLabelPreviewCard } from './line-edit/LineLabelPreviewCard';
import { LineReceiveActionBar } from './line-edit/LineReceiveActionBar';
import { ActiveLineConditionSerial } from './line-edit/ActiveLineConditionSerial';
import { LineEditToolbar } from './line-edit/LineEditToolbar';
import { CartonContextCard } from './line-edit/CartonContextCard';
import { useUnboxLineController } from './line-edit/hooks/useUnboxLineController';
import { PackageCheck } from '@/components/Icons';
import { WorkspaceCard } from '@/design-system/components';
import { FloatingButton } from '@/design-system/primitives';
import {
  dispatchLineUpdated,
  type ReceivingLineRow,
} from '@/components/station/ReceivingLinesTable';

export function LineEditPanel({
  row,
  staffId,
  onClose,
  itemTotal,
  variant = 'unbox',
}: {
  row: ReceivingLineRow;
  staffId: string;
  /** Total number of items in the PO — drives the "Receive" vs "Receive all" labels. */
  itemTotal?: number;
  /** `triage` hides unbox-only sections (label, receive, serial) + notes. */
  variant?: ReceivingWorkspaceVariant;
  onClose: () => void;
}) {
  // Mode capabilities — gate unbox-only sections without sprinkling
  // `variant === 'triage'` through the JSX. See workspace-capabilities.ts.
  const caps = workspaceCapabilities(variant);
  const router = useRouter();

  // All state, effects, and handlers live in the controller — this panel is
  // pure composition. See useUnboxLineController / useReceivingLineCore.
  const c = useUnboxLineController(row, staffId, { itemTotal });
  const {
    // toolbar / sync
    zohoSyncing, saving, platformSaving, copyingAll, phoneSharing,
    syncWithZoho, handleShare, handleSharePhone, setAuditOpen, handleCopyAll,
    // carton identity
    listingLink, setListingLink, listingEditorOpen, setListingEditorOpen, listingOpenHref,
    poOpenHref, trackingOpenHref, poNumber,
    poEditorOpen, setPoEditorOpen, poNumberEdit, setPoNumberEdit, persistPoNumber,
    zendesk, zendeskTrimmed, zendeskHref, zendeskChipDisplay, setZendesk,
    primaryTrackingTrimmed, filledExtraTrackingsCount, trackingEditorsOpen, toggleTrackingEditors,
    trackingEdit, setTrackingEdit, extraTrackings, setExtraTrackings, attachExtraBox,
    sourcePlatform, setSourcePlatform, savePlatform,
    receivingType, setReceivingType, saveType,
    priorityTier, handlePrioritySelect, patch,
    // condition + serial
    cond, setCond, unitLabelCondition, setUnitLabelCondition, isMultiQtyLine,
    headerSerialEdit, setHeaderSerialEdit, serialLookup, serialSubmitting, serialInput,
    enqueueSerial, deleteSerialUnit, replaceSerialUnit, setUnitGrade, handleFileReturnClaim,
    // notes
    notes, setNotes,
    // receive / print
    scanValue, labelPayload, lastReceiveResponse, responseExpanded, setResponseExpanded,
    setLastReceiveResponse, runPrintLabel, handlePrintAndReceive, handleReceive,
    labelDraftDefaults, buildLabelPayload, applyAndPrintLabel,
    printReceivePrimaryLabel, printThenReceiveTitle, combinedReviewDisabled,
    splitMenuAriaLabel, splitMenuHoverTitle, canPrintReview, canReceiveReview, receiveMenuLabel,
    // modals
    auditOpen, claimModalOpen, returnClaimPrefill, setClaimModalOpen, setReturnClaimPrefill,
  } = c;

  return (
    <>
    <div className="relative flex h-full min-h-0 flex-col bg-gray-50">
      <LineEditToolbar
        mode={variant}
        receivingId={row.receiving_id ?? null}
        zohoSyncing={zohoSyncing}
        busy={saving || platformSaving}
        copyingAll={copyingAll}
        phoneSharing={phoneSharing}
        handlers={{
          refresh: () => void syncWithZoho(),
          share: () => void handleShare(),
          phone: () => void handleSharePhone(),
          audit: () => setAuditOpen(true),
          copy: () => void handleCopyAll(),
        }}
      />

      {/* Scroll surface — owns the centered hero column. Padding-bottom
          clears the bottom sticky save bar so the last card never hides under it. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-5 pb-32 sm:px-6">
          {/* Photos + Claim + shipment context (listing, PO#, tracking,
              platform + type pills) share one WorkspaceCard so the operator
              sees a single bordered surface. */}
          <CartonContextCard
            receivingId={row.receiving_id ?? null}
            staffId={staffId}
            isUnmatched={row.receiving_source === 'unmatched'}
            showStaffPhotoRow={caps.photos}
            onMakeClaim={caps.claim ? () => setClaimModalOpen(true) : undefined}
            listingLink={listingLink}
            setListingLink={setListingLink}
            listingEditorOpen={listingEditorOpen}
            setListingEditorOpen={setListingEditorOpen}
            listingOpenHref={listingOpenHref}
            poOpenHref={poOpenHref}
            trackingOpenHref={trackingOpenHref}
            poDisplay={poNumber}
            poEditorOpen={poEditorOpen}
            setPoEditorOpen={setPoEditorOpen}
            poNumberEdit={poNumberEdit}
            setPoNumberEdit={setPoNumberEdit}
            onCommitPoNumber={(v) => {
              const trimmed = v.trim();
              const current = (row.zoho_purchaseorder_number || row.zoho_purchaseorder_id || '').trim();
              if (trimmed !== current) void persistPoNumber(trimmed);
            }}
            lineId={row.id ?? null}
            zendeskTrimmed={zendeskTrimmed}
            zendeskHref={zendeskHref}
            zendeskChipDisplay={zendeskChipDisplay}
            onTicketUnlinked={() => {
              // Clear the in-memory ticket so the chip flips back to "Claim →"
              // (the DELETE already nulled receiving_lines.zendesk_ticket), and
              // mirror to other surfaces holding this row.
              setZendesk('');
              dispatchLineUpdated({ id: row.id, zendesk_ticket: null, notes: row.notes });
            }}
            primaryTrackingTrimmed={primaryTrackingTrimmed}
            filledExtraTrackingsCount={filledExtraTrackingsCount}
            trackingEditorsOpen={trackingEditorsOpen}
            onToggleTrackingEditors={toggleTrackingEditors}
            trackingEdit={trackingEdit}
            setTrackingEdit={setTrackingEdit}
            onCommitTracking={(v) => {
              const trimmed = v.trim();
              if (trimmed !== (row.tracking_number || '').trim()) {
                patch({ zoho_reference_number: trimmed || null });
              }
            }}
            extraTrackings={extraTrackings}
            setExtraTrackings={setExtraTrackings}
            onCommitExtraTracking={(v, i) => void attachExtraBox(v, i)}
            platformValue={sourcePlatform}
            onPlatformSelect={(next) => {
              setSourcePlatform(next);
              void savePlatform(next);
            }}
            receivingType={receivingType}
            onTypeSelect={(next) => {
              // Carton default now — persists to receiving.intake_type. Per-line
              // overrides (receiving_lines.receiving_type) are set in the PO-items row.
              setReceivingType(next);
              void saveType(next);
            }}
            priorityTier={priorityTier}
            onPrioritySelect={(tier) => void handlePrioritySelect(tier)}
          />

          {/* PO Items card — title + qty + sku + serial chips per row, with
              the active row's bubble carrying an integrated condition-pill
              row. Unmatched cartons swap in UnmatchedItemsSection here (Ecwid
              add-item + Link Repair Service); matched cartons keep the
              canonical PoLinesAccordion driven by Zoho data. Same slot, so
              the rest of the workspace is identical across the two flows. */}
          {row.receiving_id != null ? (
            row.receiving_source === 'unmatched' ? (
              <UnmatchedItemsSection
                receivingId={row.receiving_id}
                staffId={staffId}
                showSerialScan={caps.serialScan}
                // Triage identifies; unboxing (serials, photos, receive)
                // happens in unbox mode — this jumps there with the carton
                // pre-opened via the recvId deep link.
                onOpenInUnbox={
                  caps.openInUnbox
                    ? () => {
                        const params = new URLSearchParams({
                          recvId: String(row.receiving_id),
                        });
                        if (row.id > 0) params.set('lineId', String(row.id));
                        router.push(`/receiving?${params.toString()}`);
                      }
                    : undefined
                }
                sourcePlatformHint={sourcePlatform || undefined}
                receivingTypeHint={receivingType}
                listingUrlHint={listingLink || undefined}
                onFileReturnClaim={handleFileReturnClaim}
                // Mirror the picked grade into `cond` so the label preview/print
                // tracks it. The matched-carton flow does this through
                // ActiveLineConditionSerial.onConditionChange.
                onActiveConditionChange={(next) => {
                  setCond(next);
                  setUnitLabelCondition(next);
                }}
              />
            ) : (
              <PoLinesAccordion
                receivingId={row.receiving_id}
                activeLineId={row.id}
                readOnly={!caps.editLines}
                activeConditionOverride={isMultiQtyLine ? (unitLabelCondition ?? cond) : cond}
                activeSerialActions={{
                  editingSerialId: headerSerialEdit?.id ?? null,
                  // Only called for the active row — the accordion routes a
                  // non-active row's Edit through the handoff store + line
                  // switch, which this panel consumes on (re)mount.
                  onEdit: (s) => setHeaderSerialEdit(s),
                  onDelete: (s, lineId) => {
                    if (s.id == null) return;
                    if (!window.confirm(`Remove serial ${s.serial_number}?`)) return;
                    if (headerSerialEdit?.id === s.id) setHeaderSerialEdit(null);
                    void deleteSerialUnit(s.id, lineId);
                  },
                }}
                activeRowSlot={({ serials }) => !caps.serialScan ? null : (
                  <ActiveLineConditionSerial
                    serials={serials}
                    lineId={row.id}
                    receivingId={row.receiving_id ?? null}
                    quantityExpected={row.quantity_expected ?? null}
                    cond={cond}
                    receivingType={receivingType}
                    serialSubmitting={serialSubmitting}
                    editingSerial={headerSerialEdit}
                    serialLookup={serialLookup}
                    onFileReturnClaim={handleFileReturnClaim}
                    onSubmitSerial={(sn, grade) => enqueueSerial(sn, grade)}
                    onDeleteSerialUnit={(id, lineId) => void deleteSerialUnit(id, lineId)}
                    onReplaceSerialUnit={(original, next) => void replaceSerialUnit(original, next)}
                    onSetUnitGrade={(id, grade) => void setUnitGrade(id, grade)}
                    onActiveConditionChange={setUnitLabelCondition}
                    onConditionChange={(next) => {
                      setCond(next);
                      markConditionSet(row.id);
                      void patch({ condition_grade: next });
                    }}
                    onEditingSerialChange={setHeaderSerialEdit}
                  />
                )}
              />
            )
          ) : null}

          {/* Notes card — standalone so the operator can leave context next
              to the photos + chips. Saves on blur. Hidden in triage. */}
          {caps.notes ? (
            <LineNotesCard
              value={notes}
              onChange={setNotes}
              onBlur={() => {
                if (notes !== (row.notes || '')) void patch({ notes });
              }}
            />
          ) : null}

          {/* Label preview — unbox-only (you print at unbox, not at triage). */}
          {caps.labelPreview ? (
            <LineLabelPreviewCard
              scanValue={scanValue}
              labelPayload={labelPayload}
              sku={row.sku}
              itemName={row.item_name}
              serialNumber={serialInput.trim()}
              labelDraftDefaults={labelDraftDefaults}
              buildLabelPayload={buildLabelPayload}
              onApplyAndPrint={applyAndPrintLabel}
            />
          ) : null}

          {lastReceiveResponse ? (
            <WorkspaceCard label="Last receive" bodyClassName="px-0 py-0">
              <ReceiveResponsePanel
                response={lastReceiveResponse}
                expanded={responseExpanded}
                onToggle={() => setResponseExpanded((v) => !v)}
                onDismiss={() => {
                  setLastReceiveResponse(null);
                  setResponseExpanded(false);
                }}
              />
            </WorkspaceCard>
          ) : null}
        </div>
      </div>

      {/* Print·receive — unbox-only; triage just identifies. A direct child of
          the (relative, full-height) panel so the FloatingButton docks to the
          bottom of the right pane regardless of how short the content is. */}
      {caps.receiveBar ? (
        <LineReceiveActionBar
          assignedTechId={row.assigned_tech_id}
          primaryLabel={printReceivePrimaryLabel}
          primaryTitle={printThenReceiveTitle}
          primaryDisabled={combinedReviewDisabled}
          splitMenuAriaLabel={splitMenuAriaLabel}
          splitMenuHoverTitle={splitMenuHoverTitle}
          canPrint={canPrintReview}
          canReceive={canReceiveReview}
          receiveMenuLabel={receiveMenuLabel}
          receiveMenuTitle={
            row.receiving_id == null ? 'Line must be linked to a shipment' : undefined
          }
          onPrintAndReceive={() => void handlePrintAndReceive()}
          onPrintOnly={() => runPrintLabel()}
          onMarkScanned={() => void handleReceive('scan_only')}
          onReceive={() => void handleReceive('zoho_receive')}
        />
      ) : null}

      {/* Triage's terminal action. Classification / PO# / items already persist
          on change, so this confirms the carton is identified and hands it to
          the unbox queue (clears selection → the rail auto-selects the next). */}
      {caps.saveBar ? (
        <FloatingButton
          label="Save for unbox"
          onClick={() => {
            toast.success('Saved for unbox');
            onClose();
          }}
          icon={<PackageCheck className="h-4 w-4 shrink-0" />}
          tone="blue"
          maxWidth="max-w-[45rem]"
          fullWidth
        />
      ) : null}
    </div>
    {row.receiving_id != null ? (
      <ReceivingAuditModal
        open={auditOpen}
        onClose={() => setAuditOpen(false)}
        receivingId={row.receiving_id}
      />
    ) : null}
    <ReceivingClaimModal
      open={claimModalOpen}
      row={row}
      prefillReason={returnClaimPrefill ?? undefined}
      onClose={() => {
        setClaimModalOpen(false);
        setReturnClaimPrefill(null);
      }}
      onTicketCreated={(tk) => {
        // Keep the in-memory zendesk value in sync (persisted to the line by
        // the claim route + the Receive/patch save flow).
        if (!zendesk.trim()) setZendesk(tk);
        dispatchLineUpdated({ id: row.id, notes: row.notes });
      }}
      onTicketUnlinked={() => {
        setZendesk('');
        dispatchLineUpdated({ id: row.id, zendesk_ticket: null, notes: row.notes });
      }}
    />
    </>
  );
}
