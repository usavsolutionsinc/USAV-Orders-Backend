import type { ReceivingLabelPayload } from '@/lib/print/printReceivingLabel';
import type { LabelEditDraft } from './LabelEditPopover';

export interface CartonPayloadContext {
  /** Carton receiving id — drives the `R-{id}` DataMatrix + the `RCV-{id}` fallback. */
  receivingId: number | null;
  /** Carton primary tracking (`row.tracking_number` || `core.trackingEdit`). */
  trackingHint: string;
  /** useReceivingTypeLabel() resolver — type code → catalog label. */
  resolveTypeLabel: (code: string | null | undefined) => string;
}

/**
 * Assemble a carton-label payload from a (default or hand-edited) label draft —
 * the single carton payload builder shared by the label editor's live preview
 * and its Save & print. Mirrors the corner-mode branch of
 * `useUnboxLineController.buildLabelPayload`, and feeds the one
 * {@link receivingPayloadToFace} face SoT so every surface prints the identical
 * label (the on-wire DataMatrix is always the `R-{receivingId}` handle).
 */
export function buildCartonLabelPayloadFromDraft(
  draft: LabelEditDraft,
  ctx: CartonPayloadContext,
): ReceivingLabelPayload {
  const rcv = ctx.receivingId != null ? `RCV-${ctx.receivingId}` : '';
  const base = {
    receivingId: ctx.receivingId ?? null,
    platform: draft.platform,
    notes: draft.notes.trim(),
    conditionCode: draft.conditionCode,
    receivingType: draft.receivingType || null,
    // Catalog label so a renamed/custom type prints correctly on the face.
    receivingTypeLabel: ctx.resolveTypeLabel(draft.receivingType) || null,
    date: draft.date,
  };
  // Bottom-right corner is operator-chosen — steer the label-corner helper:
  //   ticket   → set zendeskTicket    (helper shows `#ticket`)
  //   tracking → force scanValue to the internal `RCV-{id}` handle + set tracking
  //   order    → show the order/PO last-4 (or `R-{id}` when there's no PO).
  if (draft.cornerMode === 'ticket') {
    return {
      ...base,
      scanValue: draft.reference.trim() || rcv,
      zendeskTicket: draft.ticket.trim() || undefined,
      trackingNumber: ctx.trackingHint || null,
    };
  }
  if (draft.cornerMode === 'tracking') {
    return {
      ...base,
      scanValue: rcv,
      zendeskTicket: undefined,
      trackingNumber: draft.tracking.trim() || ctx.trackingHint || null,
    };
  }
  return {
    ...base,
    scanValue: draft.reference.trim() || rcv,
    zendeskTicket: undefined,
    trackingNumber: ctx.trackingHint || null,
  };
}
