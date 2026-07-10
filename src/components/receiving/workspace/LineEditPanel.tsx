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

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, useReducedMotion, type Variants } from 'framer-motion';
import {
  staggerRevealContainer,
  STAGGER_REVEAL_STEP,
} from '@/design-system/primitives/StaggerReveal';
import { ReceiveFeedbackRegion } from './ReceiveFeedbackRegion';
import { WorkspaceActionFeedbackSlot } from './WorkspaceActionFeedbackSlot';
import type { InlineActionFeedbackPayload } from './InlineActionFeedbackCard';
import { WorkspaceNotesCard } from './line-edit/WorkspaceNotesCard';
import { LineLabelPreviewCard } from './line-edit/LineLabelPreviewCard';
import { LineReceiveActionBar } from './line-edit/LineReceiveActionBar';
import { LineEditToolbar } from './line-edit/LineEditToolbar';
import { LineSkuHeaderChip } from './line-edit/LineSkuHeaderChip';
import { ReceivingPhotoPeek } from './line-edit/ReceivingPhotoPeek';
import { LineCartonContextSection } from './line-edit/LineCartonContextSection';
import { POUnboxingSection } from './line-edit/POUnboxingSection';
import { LineEditModals } from './line-edit/LineEditModals';
import { useUnboxLineController } from './line-edit/hooks/useUnboxLineController';
import { dispatchLineUpdated, type ReceivingLineRow } from '@/components/station/ReceivingLinesTable';
import { useReturnOrderLinkage } from './line-edit/hooks/useReturnOrderLinkage';
import {
  activeReceivingStepKey,
  hasConditionBeenSet,
} from './ReceivingProgressStepper';

const LABEL_PRINTED_KEY = (lineId: number) => `receiving-label-printed:${lineId}`;

import { RECEIVING_WORKSPACE_COLUMN } from './receiving-workspace-layout';

function readLabelPrinted(lineId: number): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return !!window.localStorage.getItem(LABEL_PRINTED_KEY(lineId));
  } catch {
    return false;
  }
}

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
  const [labelPrinted, setLabelPrinted] = useState(() => readLabelPrinted(row.id));
  const [conditionSet, setConditionSet] = useState(
    () => !!row.condition_set_at || hasConditionBeenSet(row.id),
  );

  useEffect(() => {
    setLabelPrinted(readLabelPrinted(row.id));
    setConditionSet(!!row.condition_set_at || hasConditionBeenSet(row.id));
  }, [row.id, row.condition_set_at]);

  useEffect(() => {
    const onLabel = (e: Event) => {
      const detail = (e as CustomEvent<{ line_id?: number }>).detail;
      if (detail?.line_id === row.id) setLabelPrinted(true);
    };
    const onCond = (e: Event) => {
      const detail = (e as CustomEvent<{ line_id: number }>).detail;
      if (detail?.line_id === row.id) setConditionSet(true);
    };
    window.addEventListener('receiving-label-printed', onLabel);
    window.addEventListener('receiving-condition-set', onCond);
    return () => {
      window.removeEventListener('receiving-label-printed', onLabel);
      window.removeEventListener('receiving-condition-set', onCond);
    };
  }, [row.id]);

  const photoCount = Math.max(0, Number(row.photo_count ?? 0));
  const rowSerials = Array.isArray(row.serials) ? row.serials : [];
  const serialCount = rowSerials.length;
  // Resolve the returned unit's OUTBOUND order (closed-loop linkage) from the
  // live scan input, falling back to the newest serial already on the line so
  // the identity persists after the scan bar clears. The resolved order# lands
  // in the top-row PO#/order chip (last-4) instead of a separate LINKAGE panel.
  const latestRowSerial = String(rowSerials[rowSerials.length - 1]?.serial_number ?? '').trim();
  const linkedOrder = useReturnOrderLinkage(c.serialInput.trim() || latestRowSerial);
  const activeStep = useMemo(
    () =>
      activeReceivingStepKey({
        scanDriven: true,
        photoCount,
        serialCount,
        quantityExpected: row.quantity_expected ?? 0,
        conditionSet,
        labelPrinted,
      }),
    [photoCount, serialCount, row.quantity_expected, conditionSet, labelPrinted],
  );

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
    : { hidden: { opacity: 0 }, show: { opacity: 1, transition: { duration: 0.2 } } };

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

        {/* SKU identity band — the line's SKU as a copyable header chip with an
            in-place pencil override (PATCH /api/receiving-lines, optimistic). */}
        <div className="flex shrink-0 items-center border-b border-border-hairline px-4 py-1 sm:px-6">
          <LineSkuHeaderChip lineId={row.id} sku={row.sku ?? null} />
        </div>

        {/* Scroll surface — owns the centered hero column. The receive-feedback,
            label-preview, and action bars now DOCK in flow below this region
            (shrink-0 bands), so the scroll body no longer reserves clearance for
            a floating pill — just a little breathing room above the first band. */}
        <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
          <motion.div
            initial="hidden"
            animate="show"
            variants={revealContainer}
            className={`${RECEIVING_WORKSPACE_COLUMN} space-y-4 px-4 py-5 pb-6 sm:px-6`}
          >
            <motion.div variants={revealItem}>
              <LineCartonContextSection
                row={row}
                staffId={staffId}
                c={c}
                linkedOrderNumber={linkedOrder?.orderId ?? null}
              />
            </motion.div>

            {/* Unified Unboxing / Package-Pairing wrapper — PO Items, auto-match
                strip (unfound only), and Package Pairing share one card. */}
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
                activeStep={activeStep}
              />
            </motion.div>

            {/* Notes — tabbed: operator Notes · read-only Zoho Notes · Checklist
                (future). The Zoho-import and operator notes are separate columns
                now, so they no longer collide. Saves on blur. */}
            <motion.div variants={revealItem}>
              <WorkspaceNotesCard
                row={row}
                c={c}
                onActionFeedback={setActionFeedback}
                activeStep={activeStep}
              />
            </motion.div>

            {/* Returned-serial closed loop: the resolved outbound order now
                populates the top identity row's PO#/order chip (see
                useReturnOrderLinkage + linkedOrderNumber) instead of a separate
                LINKAGE section — one identity display for SKU- and serial-linked
                returns alike. */}

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

            {/* Below label — item-desc / Zoho-notes saves (receive feedback docks above the bar). */}
            {!showReceiveFeedback ? (
              <WorkspaceActionFeedbackSlot
                feedback={actionFeedback}
                onDismiss={() => setActionFeedback(null)}
              />
            ) : null}
          </motion.div>
        </div>

        {showReceiveFeedback ? (
          // Transparent dock — no white backing strip. The feedback card is
          // self-contained (its own rounded green surface); it floats on the
          // canvas like the action bar below, not inside a full-bleed band.
          <div className="shrink-0 px-4 py-2 sm:px-6">
            <div className={RECEIVING_WORKSPACE_COLUMN}>
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
            </div>
          </div>
        ) : null}

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
          maxWidthClass="max-w-[720px]"
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
            // Show every capture on the carton (matches the header photo-count
            // button). Scoping to `item` hid the peek for cartons whose only
            // shots are package/door photos (no unbox interior shots yet).
            photoIntent="all"
          />
        ) : null}
      </div>

      <LineEditModals row={row} c={c} />
    </>
  );
}
