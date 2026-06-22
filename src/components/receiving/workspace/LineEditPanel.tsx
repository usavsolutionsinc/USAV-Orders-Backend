'use client';

/**
 * Right-pane workspace editor for a single receiving line — the UNBOX + TRIAGE
 * display, and the MASTER/anchor for the workspace UX. All form state, effects,
 * and handlers live in `useUnboxLineController` (which composes the mode-agnostic
 * `useReceivingLineCore`); this file is pure composition — it picks which shared
 * cards/sections to render and gates the mode-specific ones via the `caps` matrix.
 *
 * The big JSX seams are split into section components (carton context, PO items,
 * modals) that each take the controller bag; the panel itself just lays out the
 * toolbar → scroll body → action bars. The testing display (/tech) composes the
 * SAME core + cards with its own controller, so the carton/identity logic lives
 * in exactly one place.
 */

import { toast } from '@/lib/toast';
import { ReceiveResponsePanel } from './ReceiveResponsePanel';
import { workspaceCapabilities, type ReceivingWorkspaceVariant } from './workspace-capabilities';
import { LineNotesCard } from './line-edit/LineNotesCard';
import { LineLabelPreviewCard } from './line-edit/LineLabelPreviewCard';
import { LineReceiveActionBar } from './line-edit/LineReceiveActionBar';
import { LineEditToolbar } from './line-edit/LineEditToolbar';
import { ReceivingPhotoPeek } from './line-edit/ReceivingPhotoPeek';
import { LineCartonContextSection } from './line-edit/LineCartonContextSection';
import { LinePoItemsSection } from './line-edit/LinePoItemsSection';
import { LineEditModals } from './line-edit/LineEditModals';
import { useUnboxLineController } from './line-edit/hooks/useUnboxLineController';
import { PackageCheck } from '@/components/Icons';
import { WorkspaceCard } from '@/design-system/components';
import { FloatingButton } from '@/design-system/primitives';
import type { ReceivingLineRow } from '@/components/station/ReceivingLinesTable';

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

  // All state, effects, and handlers live in the controller — this panel is pure
  // composition. See useUnboxLineController / useReceivingLineCore.
  const c = useUnboxLineController(row, staffId, { itemTotal });

  return (
    <>
      <div className="relative flex h-full min-h-0 flex-col bg-gray-50">
        <LineEditToolbar
          mode={variant}
          receivingId={row.receiving_id ?? null}
          zohoSyncing={c.zohoSyncing}
          busy={c.saving || c.platformSaving}
          copyingAll={c.copyingAll}
          handlers={{
            refresh: () => void c.syncWithZoho(),
            share: () => void c.handleShare(),
            audit: () => c.setAuditOpen(true),
            copy: () => void c.handleCopyAll(),
          }}
        />

        {/* Scroll surface — owns the centered hero column. Padding-bottom clears
            the bottom sticky save bar so the last card never hides under it. */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-5 pb-32 sm:px-6">
            <LineCartonContextSection row={row} staffId={staffId} caps={caps} c={c} />

            <LinePoItemsSection row={row} staffId={staffId} caps={caps} c={c} />

            {/* Notes card — standalone so the operator can leave context next to
                the photos + chips. Saves on blur. Hidden in triage. */}
            {caps.notes ? (
              <LineNotesCard
                value={c.notes}
                onChange={c.setNotes}
                onBlur={() => {
                  if (c.notes !== (row.notes || '')) void c.patch({ notes: c.notes });
                }}
              />
            ) : null}

            {/* Label preview — unbox-only (you print at unbox, not at triage). */}
            {caps.labelPreview ? (
              <LineLabelPreviewCard
                scanValue={c.scanValue}
                labelPayload={c.labelPayload}
                sku={row.sku}
                itemName={row.item_name}
                serialNumber={c.serialInput.trim()}
                labelDraftDefaults={c.labelDraftDefaults}
                buildLabelPayload={c.buildLabelPayload}
                onApplyAndPrint={c.applyAndPrintLabel}
              />
            ) : null}

            {c.lastReceiveResponse ? (
              <WorkspaceCard label="Last receive" bodyClassName="px-0 py-0">
                <ReceiveResponsePanel
                  response={c.lastReceiveResponse}
                  expanded={c.responseExpanded}
                  onToggle={() => c.setResponseExpanded((v) => !v)}
                  onDismiss={() => {
                    c.setLastReceiveResponse(null);
                    c.setResponseExpanded(false);
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
            primaryLabel={c.printReceivePrimaryLabel}
            primaryTitle={c.printThenReceiveTitle}
            primaryDisabled={c.combinedReviewDisabled}
            splitMenuAriaLabel={c.splitMenuAriaLabel}
            splitMenuHoverTitle={c.splitMenuHoverTitle}
            canPrint={c.canPrintReview}
            canReceive={c.canReceiveReview}
            receiveMenuLabel={c.receiveMenuLabel}
            receiveMenuTitle={
              row.receiving_id == null ? 'Line must be linked to a shipment' : undefined
            }
            onPrintAndReceive={() => void c.handlePrintAndReceive()}
            onPrintOnly={() => c.runPrintLabel()}
            onMarkScanned={() => void c.handleReceive('scan_only')}
            onReceive={() => void c.handleReceive('zoho_receive')}
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

        {/* Live photo peek — right-edge fanned preview of the carton's captures
            that updates in real time over Ably. Unbox-only; needs a linked
            shipment for the photo query. */}
        {caps.photos && row.receiving_id != null ? (
          <ReceivingPhotoPeek receivingId={row.receiving_id} staffId={Number(staffId) || 0} />
        ) : null}
      </div>

      <LineEditModals row={row} c={c} />
    </>
  );
}
