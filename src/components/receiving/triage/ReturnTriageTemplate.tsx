'use client';

/**
 * Return triage template — the `*_RETURN` intake-kind fork inside `TriagePanel`
 * (docs/receiving-triage-redesign-plan.md §3.3). Same cards as the PO template
 * (the pairing hub's Zendesk-ticket + delivered-email corroboration tabs are
 * ALREADY BUILT, just re-scoped here), with return-specific copy: C6 — a return
 * with no label hint carries no minimum identity requirement, so the todo strip
 * reads as informational, not blocking.
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

export function ReturnTriageTemplate({
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
          <UnfoundTodoStrip message="No claim hint on the label — that's fine (C6). Save for unbox any time; it stays on Unfound until paired." />
        </motion.div>
      ) : null}
    </>
  );
}
