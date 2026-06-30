'use client';

/**
 * TriagePanel — the standalone right-pane editor for the **Receiving (triage)**
 * mode: the fast "identify the carton before unbox" pass.
 *
 * Triage used to ride on {@link LineEditPanel} via a `variant='triage'` prop and
 * the `workspace-capabilities` matrix, which masked every unbox-only section.
 * That blended two display archetypes in one region (see
 * `.claude/rules/contextual-display.md`). This panel is the de-blended triage
 * surface: it composes ONLY the cards triage actually uses —
 *
 *   1. Carton context  — classify pills, PO#/tracking/listing chips, photos, claim
 *   2. Package Pairing — pair the inbound/return package to a Zendesk claim,
 *                        repair service, or Ecwid order (read-only PO items once linked)
 *   3. Notes           — operator + Zoho notes (shared {@link WorkspaceNotesCard})
 *   4. Save for unbox  — the terminal action (hands the identified carton to unbox)
 *
 * No label preview, no print·receive, no serial scan — those are unbox-only and
 * simply aren't here, rather than being capability-gated off. All state lives in
 * the shared `useUnboxLineController` (the mode-agnostic carton/identity core), so
 * triage and unbox stay in lock-step on carton data without sharing a JSX shell.
 */

import { useCallback, useEffect, useState } from 'react';
import { motion, useReducedMotion, type Variants } from 'framer-motion';
import {
  staggerRevealContainer,
  staggerRevealRiseItem,
  STAGGER_REVEAL_STEP,
} from '@/design-system/primitives/StaggerReveal';
import { toast } from '@/lib/toast';
import { PackageCheck } from '@/components/Icons';
import { FloatingButton } from '@/design-system/primitives';
import { WorkspaceActionFeedbackSlot } from '../workspace/WorkspaceActionFeedbackSlot';
import type { InlineActionFeedbackPayload } from '../workspace/InlineActionFeedbackCard';
import { LineEditToolbar } from '../workspace/line-edit/LineEditToolbar';
import { LineCartonContextSection } from '../workspace/line-edit/LineCartonContextSection';
import { POUnboxingSection } from '../workspace/line-edit/POUnboxingSection';
import { WorkspaceNotesCard } from '../workspace/line-edit/WorkspaceNotesCard';
import { ReceivingPhotoPeek } from '../workspace/line-edit/ReceivingPhotoPeek';
import { LineEditModals } from '../workspace/line-edit/LineEditModals';
import { useUnboxLineController } from '../workspace/line-edit/hooks/useUnboxLineController';
import { dispatchLineUpdated, type ReceivingLineRow } from '@/components/station/ReceivingLinesTable';

export function TriagePanel({
  row,
  staffId,
  onClose,
}: {
  row: ReceivingLineRow;
  staffId: string;
  onClose: () => void;
}) {
  // Shared, mode-agnostic carton/identity controller — identical to unbox, so
  // PO#, tracking, classification, photos and pairing stay in sync across modes.
  const c = useUnboxLineController(row, staffId, {});
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

  // Staggered card "settle" — plays once per carton open (the panel is keyed on
  // the carton in ReceivingRightPane). Reduced-motion collapses to a plain fade.
  const reduceMotion = useReducedMotion();
  const revealContainer = staggerRevealContainer(reduceMotion ? 0 : STAGGER_REVEAL_STEP);
  const revealItem: Variants = reduceMotion
    ? { hidden: { opacity: 0 }, show: { opacity: 1, transition: { duration: 0.001 } } }
    : staggerRevealRiseItem;

  return (
    <>
      <div className="relative flex h-full min-h-0 flex-col bg-gray-50">
        <LineEditToolbar
          mode="triage"
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
            the bottom sticky "Save for unbox" bar so the last card never hides. */}
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

            {/* Package Pairing (+ read-only PO items once the carton is linked).
                In triage the PO-items accordion is a flat read-only display; the
                pairing hub is the operator's primary surface. No serial scan and
                no editable lines here — that's the unbox pass. */}
            <motion.div variants={revealItem}>
              <POUnboxingSection
                row={row}
                staffId={staffId}
                poItems={false}
                matching
                openInUnbox
                editLines={false}
                serialScan={false}
                c={c}
                onItemDescFeedback={handleItemDescFeedback}
                onItemDescSaved={handleItemDescSaved}
              />
            </motion.div>

            <motion.div variants={revealItem}>
              <WorkspaceNotesCard row={row} c={c} onActionFeedback={setActionFeedback} />
            </motion.div>

            {/* Owns its own AnimatePresence (workbenchPane preset) — kept OUTSIDE
                the stagger so two entrances don't compound. */}
            <WorkspaceActionFeedbackSlot
              feedback={actionFeedback}
              onDismiss={() => setActionFeedback(null)}
            />
          </motion.div>
        </div>

        {/* Terminal action — classification / PO# / pairing already persist on
            change, so this just confirms the carton is identified and hands it to
            the unbox queue (clears selection → the rail auto-selects the next). */}
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

        {/* Live photo peek — right-edge fanned preview of the carton's captures,
            updating in real time over Ably. Needs a linked carton for the query. */}
        {row.receiving_id != null ? (
          <ReceivingPhotoPeek receivingId={row.receiving_id} staffId={Number(staffId) || 0} />
        ) : null}
      </div>

      <LineEditModals row={row} c={c} />
    </>
  );
}
