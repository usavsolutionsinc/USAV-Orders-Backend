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
import { useQueryClient } from '@tanstack/react-query';
import {
  staggerRevealContainer,
  staggerRevealRiseItem,
  STAGGER_REVEAL_STEP,
} from '@/design-system/primitives/StaggerReveal';
import { toast } from '@/lib/toast';
import { PackageCheck, Check } from '@/components/Icons';
import { FloatingButton } from '@/design-system/primitives';
import { safeRandomUUID } from '@/lib/safe-uuid';
import { invalidateReceivingFeeds } from '@/lib/queries/receiving-queries';
import { WorkspaceActionFeedbackSlot } from '../workspace/WorkspaceActionFeedbackSlot';
import type { InlineActionFeedbackPayload } from '../workspace/InlineActionFeedbackCard';
import { LineEditToolbar } from '../workspace/line-edit/LineEditToolbar';
import { WorkspaceNotesCard } from '../workspace/line-edit/WorkspaceNotesCard';
import { ReceivingPhotoPeek } from '../workspace/line-edit/ReceivingPhotoPeek';
import { LineEditModals } from '../workspace/line-edit/LineEditModals';
import { useUnboxLineController } from '../workspace/line-edit/hooks/useUnboxLineController';
import { dispatchLineUpdated, type ReceivingLineRow } from '@/components/station/ReceivingLinesTable';
import { markTriageCompleted, hasTriageBeenCompleted } from '../workspace/TriageProgressStepper';
import { PoTriageTemplate } from './PoTriageTemplate';
import { ReturnTriageTemplate } from './ReturnTriageTemplate';
import { isReturnIntake } from '@/lib/receiving/triage-intake-kind';
import { useTriageStaging } from './useTriageStaging';
import { deriveTriageFocusFacts, resolveTriageFocus, TRIAGE_SECTION_ID } from '@/lib/receiving/triage-focus';

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
  const staging = useTriageStaging(row);
  const [actionFeedback, setActionFeedback] = useState<InlineActionFeedbackPayload | null>(null);
  const queryClient = useQueryClient();
  const [savingTriage, setSavingTriage] = useState(false);
  const [triageSaved, setTriageSaved] = useState(false);

  useEffect(() => {
    setActionFeedback(null);
    setTriageSaved(false);
  }, [row.id]);

  // TriageFocusResolver (§3.7) — on open (a fresh scan resolving into this
  // panel, or a rail click), send attention to the first unmet step. Runs once
  // per carton (keyed on row.id only) so it doesn't re-fire on every background
  // refetch of the SAME carton. A short rAF delay lets the stagger-reveal
  // mount before we scroll to it.
  useEffect(() => {
    const facts = deriveTriageFocusFacts(
      row,
      row.triage_complete === true || hasTriageBeenCompleted(row.receiving_id),
    );
    const target = resolveTriageFocus(facts);
    if (target === 'none') return;
    if (target === 'already-staged') {
      toast.success('Already staged for unbox', {
        description: 'Nothing left to do here — open it in Unbox when ready.',
      });
      return;
    }
    const id = TRIAGE_SECTION_ID[target];
    const raf = requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return () => cancelAnimationFrame(raf);
  }, [row.id]);

  const handleSaveForUnbox = useCallback(async () => {
    if (row.receiving_id == null) {
      toast.error('This carton has no receiving id yet — try again after it resolves.');
      return;
    }
    setSavingTriage(true);
    try {
      const res = await fetch('/api/receiving/triage/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receiving_id: row.receiving_id,
          client_event_id: safeRandomUUID(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        toast.error(data?.error || 'Could not save for unbox');
        return;
      }
      markTriageCompleted(row.receiving_id);
      dispatchLineUpdated({ id: row.id, triage_complete: true });
      invalidateReceivingFeeds(queryClient);
      setTriageSaved(true);
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch {
      toast.error('Could not save for unbox');
    } finally {
      setSavingTriage(false);
    }
  }, [row.receiving_id, row.id, queryClient, onClose]);

  // Keyboard shortcut (Phase 4) — ⌘/Ctrl+Enter saves for unbox from anywhere in
  // the panel, incl. while a text field has focus (the conventional "submit"
  // chord). Deliberately the ONLY triage shortcut added: this is a scan-driven
  // surface (station.md) where the wedge types raw digits/letters into the scan
  // bar — a bare-key shortcut (e.g. a digit to switch tabs) would corrupt a scan
  // in flight, so anything that isn't modifier-gated is out of scope here.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== 'Enter') return;
      if (savingTriage || triageSaved) return;
      e.preventDefault();
      void handleSaveForUnbox();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSaveForUnbox, savingTriage, triageSaved]);

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

  // Intake-kind fork (§3.3) — the unbox/triage split already happened (this
  // whole panel is de-blended from LineEditPanel); this is the remaining
  // split, PO vs Return layouts inside triage itself.
  const Template = isReturnIntake(row) ? ReturnTriageTemplate : PoTriageTemplate;

  return (
    <>
      <div className="relative flex h-full min-h-0 flex-col bg-surface-canvas">
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
            {/* Intake-kind fork — PO (+ UNKNOWN) vs Return template. Both compose
                the same underlying cards (pairing hub UNCHANGED); only layout,
                copy, and the unfound-todo framing differ. No serial scan and no
                editable lines here — that's the unbox pass. */}
            <Template
              row={row}
              staffId={staffId}
              c={c}
              staging={staging}
              revealItem={revealItem}
              onItemDescFeedback={handleItemDescFeedback}
              onItemDescSaved={handleItemDescSaved}
            />

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
          label={triageSaved ? 'Saved ✓' : 'Save for unbox'}
          title={triageSaved ? undefined : 'Shortcut: ⌘/Ctrl + Enter'}
          onClick={() => void handleSaveForUnbox()}
          icon={
            triageSaved ? (
              <Check className="h-4 w-4 shrink-0" />
            ) : (
              <PackageCheck className="h-4 w-4 shrink-0" />
            )
          }
          loading={savingTriage}
          disabled={triageSaved}
          tone={triageSaved ? 'emerald' : 'blue'}
          maxWidth="max-w-[45rem]"
          fullWidth
        />

        {/* Live photo peek — right-edge fanned preview of the carton's captures,
            updating in real time over Ably. Needs a linked carton for the query. */}
        {row.receiving_id != null ? (
          <ReceivingPhotoPeek
            receivingId={row.receiving_id}
            staffId={Number(staffId) || 0}
            poRef={row.zoho_purchaseorder_number || row.zoho_purchaseorder_id || null}
          />
        ) : null}
      </div>

      <LineEditModals row={row} c={c} />
    </>
  );
}
