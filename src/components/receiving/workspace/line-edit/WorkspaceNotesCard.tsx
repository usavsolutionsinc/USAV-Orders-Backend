'use client';

/**
 * WorkspaceNotesCard — the tabbed operator Notes · read-only Zoho Notes ·
 * Checklist card, plus the carton-level "save overall Zoho note" handler.
 *
 * Extracted from {@link LineEditPanel} so the Unbox panel and the standalone
 * {@link TriagePanel} share ONE notes implementation (and one Zoho-save path)
 * instead of duplicating the ~50-line handler. Pure composition over the
 * controller bag; the panel owns the stagger wrapper, this owns the card.
 */

import type { ReceivingStepKey } from '../ReceivingProgressStepper';
import { LineNotesTabbedCard } from './LineNotesTabbedCard';
import { dispatchLineUpdated, type ReceivingLineRow } from '@/components/station/ReceivingLinesTable';
import type { InlineActionFeedbackPayload } from '../InlineActionFeedbackCard';
import type { UnboxLineController } from './unbox-line-controller';

function zohoPoNotesSkipNote(zoho?: { patched?: boolean; skipped?: string }): string | undefined {
  switch (zoho?.skipped) {
    case 'no_zoho_link':
      return 'Saved locally — no Zoho PO link on this carton.';
    case 'po_not_editable':
      return 'Saved locally — Zoho PO is not editable.';
    default:
      return undefined;
  }
}

interface WorkspaceNotesCardProps {
  row: ReceivingLineRow;
  c: UnboxLineController;
  onActionFeedback: (feedback: InlineActionFeedbackPayload | null) => void;
  activeStep?: ReceivingStepKey | null;
}

export function WorkspaceNotesCard({ row, c, onActionFeedback, activeStep }: WorkspaceNotesCardProps) {
  return (
    <div id="zoho-notes-card">
      <LineNotesTabbedCard
        internalNotes={c.notes}
        labelNotes={c.labelNotes}
        overallZohoNotes={row.receiving_zoho_notes ?? null}
        lineId={row.id}
        sku={row.sku}
        skuTitle={row.zoho_item_title || row.item_name || null}
        unitPrice={row.unit_price ?? null}
        zendeskTicket={c.zendeskTrimmed || row.zendesk_ticket || null}
        zendeskProviderTicketId={c.providerTicketId}
        zendeskTicketSubject={c.supportTicket?.subject ?? null}
        previousLineNotes={c.prevLineNotes}
        onInternalNotesChange={c.setNotes}
        onInternalNotesBlur={() => {
          if (c.notes !== (row.notes || '')) void c.patch({ notes: c.notes });
        }}
        onLabelNotesChange={c.setLabelNotes}
        onSaveLabelToInternal={() => {
          c.setNotes(c.labelNotes);
          if (c.labelNotes !== (row.notes || '')) void c.patch({ notes: c.labelNotes });
        }}
        onSaveOverallNote={async (text) => {
          if (row.receiving_id == null) return;
          onActionFeedback(null);
          try {
            const res = await fetch(`/api/receiving/${row.receiving_id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ zoho_notes: text, push_to_zoho: true }),
            });
            const data = (await res.json().catch(() => null)) as {
              error?: string;
              zoho?: { patched?: boolean; skipped?: string };
            } | null;
            if (res.ok) {
              dispatchLineUpdated({ id: row.id, receiving_zoho_notes: text || null });
              onActionFeedback({
                tone: 'emerald',
                headline: text ? 'Zoho notes updated' : 'Zoho notes cleared',
                // Show the FULL PO notes (multi-line, pre-wrapped) so the operator
                // sees exactly what landed in Zoho — not a truncated first-line preview.
                items: text ? [text] : [],
                note: data?.zoho?.patched ? undefined : zohoPoNotesSkipNote(data?.zoho),
                at: Date.now(),
              });
            } else {
              onActionFeedback({
                tone: 'amber',
                headline: 'Could not save Zoho notes',
                items: [],
                note: data?.error?.trim() || 'Save failed',
                at: Date.now(),
              });
            }
          } catch {
            onActionFeedback({
              tone: 'amber',
              headline: 'Could not save Zoho notes',
              items: [],
              note: 'Save failed',
              at: Date.now(),
            });
          }
        }}
        onOverallDraftChange={() => onActionFeedback(null)}
        showZohoTab={!c.isUnfound}
        onLoadZohoNotes={
          row.receiving_id != null && !c.isUnfound ? () => c.syncCartonFromZoho() : undefined
        }
        activeStep={activeStep}
      />
    </div>
  );
}
