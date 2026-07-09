'use client';

/**
 * PO (+ UNKNOWN, until classified as a return) triage template — the intake-kind
 * fork inside `TriagePanel` (docs/receiving-triage-redesign-plan.md §3.3). The
 * unbox/triage split already happened (TriagePanel is de-blended from
 * LineEditPanel); this is the remaining split — PO vs Return layouts inside
 * triage itself.
 *
 * Composes the SAME cards as before the fork (no pairing-hub behavior change —
 * `POUnboxingSection`'s Zendesk/Ecwid/Zoho-PO tabs stay exactly as shipped, incl.
 * `PoLinkTab` — kept per D1), plus a new `UnfoundTodoStrip` for an unmatched
 * carton pointing at the persistent Unfound todo.
 */

import { motion, type Variants } from 'framer-motion';
import { WorkspaceCard } from '@/design-system/components';
import { shouldUseUnmatchedItemsSurface } from '@/lib/receiving/intake-items-routing';
import { LineCartonContextSection } from '../workspace/line-edit/LineCartonContextSection';
import { LinePoItemsSection } from '../workspace/line-edit/LinePoItemsSection';
import { POUnboxingSection } from '../workspace/line-edit/POUnboxingSection';
import { UnfoundTodoStrip } from './UnfoundTodoStrip';
import { StagingSection } from './StagingSection';
import type { TriageStagingController } from './useTriageStaging';
import type { InlineActionFeedbackPayload } from '../workspace/InlineActionFeedbackCard';
import type { UnboxLineController } from '../workspace/line-edit/unbox-line-controller';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';
import { TRIAGE_SECTION_ID } from '@/lib/receiving/triage-focus';

export function PoTriageTemplate({
  row,
  staffId,
  c,
  staging,
  revealItem,
  onItemDescFeedback,
  onItemDescSaved,
}: {
  row: ReceivingLineRow;
  staffId: string;
  c: UnboxLineController;
  staging: TriageStagingController;
  revealItem: Variants;
  onItemDescFeedback: (feedback: InlineActionFeedbackPayload | null) => void;
  onItemDescSaved: (lineId: number, zohoNotes: string | null) => void;
}) {
  const linkedPo = !c.isUnfound && !shouldUseUnmatchedItemsSurface(row);

  return (
    <>
      <motion.div id={TRIAGE_SECTION_ID.classify} variants={revealItem}>
        <LineCartonContextSection row={row} staffId={staffId} c={c} />
      </motion.div>

      {linkedPo ? (
        <motion.div variants={revealItem}>
          <WorkspaceCard variant="glass" overflow="visible">
            <LinePoItemsSection
              row={row}
              staffId={staffId}
              serialScan={false}
              openInUnbox
              editLines={false}
              c={c}
              embedded
              onItemDescFeedback={onItemDescFeedback}
              onItemDescSaved={onItemDescSaved}
            />
          </WorkspaceCard>
        </motion.div>
      ) : null}

      <motion.div id={TRIAGE_SECTION_ID.stage} variants={revealItem}>
        <StagingSection staging={staging} />
      </motion.div>

      <motion.div id={TRIAGE_SECTION_ID.pair} variants={revealItem}>
        <POUnboxingSection
          row={row}
          staffId={staffId}
          poItems={false}
          matching
          includeLinkedPoItems={false}
          openInUnbox
          editLines={false}
          serialScan={false}
          c={c}
          onItemDescFeedback={onItemDescFeedback}
          onItemDescSaved={onItemDescSaved}
        />
      </motion.div>

      {row.receiving_source === 'unmatched' ? (
        <motion.div variants={revealItem}>
          <UnfoundTodoStrip message="Still unfound — pairing will retry. Save for unbox is allowed while it works." />
        </motion.div>
      ) : null}
    </>
  );
}
