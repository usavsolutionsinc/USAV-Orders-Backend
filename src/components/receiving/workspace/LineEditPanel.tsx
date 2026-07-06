'use client';

/**
 * Right-pane workspace editor for a single receiving line — the UNBOX display,
 * and the MASTER/anchor for the workspace UX. All form state, effects, and
 * handlers live in `useUnboxLineController` (which composes the mode-agnostic
 * `useReceivingLineCore`); this file is pure composition — it lays out the
 * toolbar → scroll body → action bars from shared section components.
 *
 * Triage (the identify-before-unbox pass) is its own lean panel
 * ({@link TriagePanel}); the two no longer share a JSX shell or a capability
 * matrix. The testing display (/tech) composes the SAME core + cards with its
 * own controller, so the carton/identity logic lives in exactly one place.
 */

import { useCallback, useEffect, useState } from 'react';
import { motion, useReducedMotion, type Variants } from 'framer-motion';
import {
  staggerRevealContainer,
  staggerRevealRiseItem,
  STAGGER_REVEAL_STEP,
} from '@/design-system/primitives/StaggerReveal';
import { ReceiveFeedbackRegion } from './ReceiveFeedbackRegion';
import { WorkspaceActionFeedbackSlot } from './WorkspaceActionFeedbackSlot';
import type { InlineActionFeedbackPayload } from './InlineActionFeedbackCard';
import { WorkspaceNotesCard } from './line-edit/WorkspaceNotesCard';
import { LineLabelPreviewCard } from './line-edit/LineLabelPreviewCard';
import { LineReceiveActionBar } from './line-edit/LineReceiveActionBar';
import { LineEditToolbar } from './line-edit/LineEditToolbar';
import { ReceivingPhotoPeek } from './line-edit/ReceivingPhotoPeek';
import { LineCartonContextSection } from './line-edit/LineCartonContextSection';
import { POUnboxingSection } from './line-edit/POUnboxingSection';
import { LineEditModals } from './line-edit/LineEditModals';
import { useUnboxLineController } from './line-edit/hooks/useUnboxLineController';
import { dispatchLineUpdated, type ReceivingLineRow } from '@/components/station/ReceivingLinesTable';
import { LinkedTicketsPanel } from '@/components/linkage/LinkedTicketsPanel';

export function LineEditPanel({
  row,
  staffId,
  itemTotal,
}: {
  row: ReceivingLineRow;
  staffId: string;
  /** Total number of items in the PO — drives the "Receive" vs "Receive all" labels. */
  itemTotal?: number;
}) {
  // All state, effects, and handlers live in the controller — this panel is pure
  // composition. See useUnboxLineController / useReceivingLineCore.
  const c = useUnboxLineController(row, staffId, { itemTotal });
  const [actionFeedback, setActionFeedback] = useState<InlineActionFeedbackPayload | null>(null);

  useEffect(() => {
    setActionFeedback(null);
  }, [row.id]);

  const handleItemDescFeedback = useCallback((feedback: InlineActionFeedbackPayload | null) => {
    setActionFeedback(feedback);
  }, []);

  const handleItemDescSaved = useCallback(
    (lineId: number, zohoNotes: string | null) => {
      if (lineId === row.id) {
        dispatchLineUpdated({ id: row.id, zoho_notes: zohoNotes });
      }
    },
    [row.id],
  );

  const showReceiveFeedback = Boolean(c.receiving || c.receiveResult);

  // Staggered card "settle" — the panel remounts per carton (keyed in
  // ReceivingRightPane), so this cascade plays once per carton open: the cards
  // rise + fade in sequence over the pane's opacity cross-dissolve. Sibling-line
  // switches keep the same carton key (no remount), so they update in place
  // without re-cascading. Reduced-motion collapses it to a plain instant fade.
  const reduceMotion = useReducedMotion();
  const revealContainer = staggerRevealContainer(reduceMotion ? 0 : STAGGER_REVEAL_STEP);
  const revealItem: Variants = reduceMotion
    ? { hidden: { opacity: 0 }, show: { opacity: 1, transition: { duration: 0.001 } } }
    : staggerRevealRiseItem;

  return (
    <>
      <div className="relative isolate flex h-full min-h-0 flex-col bg-surface-canvas">
        {/* Ambient wash — ultra-soft tonal blobs behind the glass cards so their
            backdrop-blur has something to frost. Sits at -z-10 inside the
            panel's isolated stacking context (`isolate` above), so it can never
            paint over content. Pure decoration: token-family hues at ≤8% alpha,
            calm enough to read as light, not color. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
          <div className="absolute -top-24 left-1/2 h-72 w-[44rem] -translate-x-1/2 rounded-full bg-blue-400/[0.08] blur-3xl" />
          <div className="absolute right-[-7rem] top-1/3 h-80 w-80 rounded-full bg-violet-400/[0.06] blur-3xl" />
          <div className="absolute bottom-[-5rem] left-[-5rem] h-80 w-80 rounded-full bg-emerald-400/[0.06] blur-3xl" />
        </div>
        <LineEditToolbar
          mode="unbox"
          receivingId={row.receiving_id ?? null}
          zohoSyncing={c.zohoSyncing}
          busy={c.saving || c.platformSaving}
          copyingAll={c.copyingAll}
          handlers={{
            refresh: () => void c.syncWithZoho(),
            share: () => void c.handleShare(),
            audit: () => c.setAuditOpen(true),
            copy: () => void c.handleCopyAll(),
            photoNote: () => c.setPhotoNoteOpen(true),
          }}
        />

        {/* Scroll surface — owns the centered hero column. Padding-bottom clears
            the bottom sticky save bar so the last card never hides under it. */}
        <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
          <motion.div
            initial="hidden"
            animate="show"
            variants={revealContainer}
            className="mx-auto w-full min-w-0 max-w-3xl space-y-4 px-4 py-5 pb-32 sm:px-6"
          >
            <motion.div variants={revealItem}>
              <LineCartonContextSection row={row} staffId={staffId} c={c} />
            </motion.div>

            {/* Unified Unboxing / Package-Pairing wrapper — PO Items on top,
                Package Pairing below, pencil on the PO items eyebrow row (same
                IconButton as the label card). Unbox shows BOTH (editable items +
                pairing for unfound cartons). See POUnboxingSection. */}
            <motion.div variants={revealItem}>
              <POUnboxingSection
                row={row}
                staffId={staffId}
                poItems
                matching
                openInUnbox={false}
                editLines
                serialScan
                c={c}
                onItemDescFeedback={handleItemDescFeedback}
                onItemDescSaved={handleItemDescSaved}
              />
            </motion.div>

            {/* Notes — tabbed: operator Notes · read-only Zoho Notes · Checklist
                (future). The Zoho-import and operator notes are separate columns
                now, so they no longer collide. Saves on blur. */}
            <motion.div variants={revealItem}>
              <WorkspaceNotesCard row={row} c={c} onActionFeedback={setActionFeedback} />
            </motion.div>

            {/* Returned-serial closed loop: when the scanned serial was
                previously shipped, surface its outbound order ↔ tracking ↔ any
                linked Zendesk tickets. hideWhenEmpty keeps it silent for normal
                (non-return) lines. */}
            {c.serialInput.trim() ? (
              <motion.div variants={revealItem}>
                <LinkedTicketsPanel serial={c.serialInput.trim()} hideWhenEmpty dense />
              </motion.div>
            ) : null}

            {/* Label preview — you print at unbox. */}
            <motion.div variants={revealItem}>
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
            </motion.div>

            {/* Below label — receive feedback OR item-desc / Zoho-notes saves.
                Left OUTSIDE the stagger: these regions own their own
                AnimatePresence (workbenchPane preset), so wrapping them would
                compound two entrances. */}
            {showReceiveFeedback ? (
              <ReceiveFeedbackRegion
                receiving={c.receiving}
                receiveResult={c.receiveResult}
                responseExpanded={c.responseExpanded}
                setResponseExpanded={c.setResponseExpanded}
                onDismiss={() => {
                  c.setReceiveResult(null);
                  c.setResponseExpanded(false);
                }}
              />
            ) : (
              <WorkspaceActionFeedbackSlot
                feedback={actionFeedback}
                onDismiss={() => setActionFeedback(null)}
              />
            )}
          </motion.div>
        </div>

        {/* Receive action bar. A direct child of the (relative, full-height)
            panel so the FloatingButton docks to the bottom of the right pane
            regardless of how short the content is. */}
        <LineReceiveActionBar
          assignedTechId={row.assigned_tech_id}
          primaryLabel={c.printReceivePrimaryLabel}
          primaryTitle={c.printThenReceiveTitle}
          primaryDisabled={c.combinedReviewDisabled}
          splitMenuAriaLabel={c.splitMenuAriaLabel}
          splitMenuHoverTitle={c.splitMenuHoverTitle}
          canPrint={c.canPrintReview}
          canReceive={c.canReceiveReview}
          canZohoReceive={c.canZohoReceive}
          isLocalReceive={c.isUnfound}
          receiveMenuLabel={c.receiveMenuLabel}
          receiveMenuTitle={c.receiveMenuTitle}
          onPrintAndReceive={() => void c.handlePrintAndReceive()}
          onPrintOnly={() => c.runPrintLabel()}
          onMarkScanned={() => void c.handleReceive('scan_only')}
          onReceive={() => void c.handleReceive('zoho_receive')}
          onLocalReceive={() => void c.handleReceive('local_receive')}
        />

        {/* Live photo peek — right-edge fanned preview of the carton's captures
            that updates in real time over Ably; needs a linked shipment for the
            photo query. */}
        {row.receiving_id != null ? (
          <ReceivingPhotoPeek
            receivingId={row.receiving_id}
            staffId={Number(staffId) || 0}
            poRef={c.poNumber || null}
            photoIntent="item"
          />
        ) : null}
      </div>

      <LineEditModals row={row} c={c} />
    </>
  );
}
