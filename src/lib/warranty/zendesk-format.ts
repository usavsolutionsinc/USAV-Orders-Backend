/**
 * Warranty ↔ Zendesk — PURE helpers (no DB / API imports) so both the server
 * routes and the client popover can share them. Mirrors the unit-id-format
 * split: server-side linking lives in zendesk-link.ts; this file stays
 * client-safe.
 */

import type { WarrantyClaimDetail, WarrantyClaimEventRow } from './types';

/** Slim, client-facing shape for a Zendesk comment (mapped from the raw API object). */
export interface WarrantyZendeskComment {
  id: number;
  body: string;
  htmlBody: string | null;
  public: boolean;
  authorId: number | null;
  createdAt: string;
}

export interface WarrantyTicketTemplate {
  subject: string;
  description: string;
}

function line(label: string, value: string | number | null | undefined): string | null {
  if (value == null || value === '') return null;
  return `${label}: ${value}`;
}

/**
 * Deterministic subject/body for the Zendesk ticket created from a claim. The
 * operator can edit both before sending; this is the no-LLM baseline (same
 * philosophy as buildReceivingClaimTemplate).
 */
export function buildWarrantyTicketTemplate(claim: WarrantyClaimDetail): WarrantyTicketTemplate {
  const item = claim.productTitle || claim.sku || claim.serialNumber || 'item';
  const subject = `Warranty claim ${claim.claimNumber}: ${item}`;

  const windowLine =
    claim.warrantyStartsAt && claim.warrantyExpiresAt
      ? `${claim.warrantyStartsAt.slice(0, 10)} → ${claim.warrantyExpiresAt.slice(0, 10)}` +
        (claim.daysRemaining != null
          ? claim.daysRemaining >= 0
            ? ` (${claim.daysRemaining}d remaining)`
            : ` (expired ${Math.abs(claim.daysRemaining)}d ago)`
          : '')
      : null;

  const lines = [
    `Warranty Claim ${claim.claimNumber} (status: ${claim.status})`,
    '',
    line('Product', claim.productTitle),
    line('SKU', claim.sku),
    line('Serial Number', claim.serialNumber),
    line('Order', claim.sourceOrderId ?? claim.orderId),
    line('Source', claim.sourceSystem),
    line('Customer', claim.customerName),
    line('Tracking', claim.sourceTrackingNumber),
    line('Warranty window', windowLine),
    line('RMA', claim.rmaNumber),
    line('Repair ticket', claim.repairTicket),
  ].filter((l): l is string => l !== null);

  if (claim.denialReasonCode || claim.denialNotes) {
    lines.push('', 'Denial:', ...[
      line('  Reason code', claim.denialReasonCode),
      line('  Notes', claim.denialNotes),
    ].filter((l): l is string => l !== null));
  }
  if (claim.notes) lines.push('', 'Notes:', claim.notes);

  return { subject, description: lines.join('\n') };
}

/** One row in the merged claim-history view (internal events + Zendesk comments). */
export type WarrantyTimelineEntry =
  | { kind: 'event'; key: string; createdAt: string; event: WarrantyClaimEventRow }
  | { kind: 'comment'; key: string; createdAt: string; comment: WarrantyZendeskComment };

/**
 * Merge the claim's internal event timeline with the linked ticket's Zendesk
 * comment thread into one chronological (ascending) list for the popover.
 */
export function mergeWarrantyTimeline(
  events: WarrantyClaimEventRow[],
  comments: WarrantyZendeskComment[],
): WarrantyTimelineEntry[] {
  const entries: WarrantyTimelineEntry[] = [
    ...events.map((event): WarrantyTimelineEntry => ({
      kind: 'event',
      key: `event-${event.id}`,
      createdAt: event.createdAt,
      event,
    })),
    ...comments.map((comment): WarrantyTimelineEntry => ({
      kind: 'comment',
      key: `comment-${comment.id}`,
      createdAt: comment.createdAt,
      comment,
    })),
  ];
  return entries.sort((a, b) => {
    const at = Date.parse(a.createdAt) || 0;
    const bt = Date.parse(b.createdAt) || 0;
    return at === bt ? a.key.localeCompare(b.key) : at - bt;
  });
}

/** Human label for claim event types shown in the merged timeline. */
export function warrantyEventLabel(event: WarrantyClaimEventRow): string {
  switch (event.eventType) {
    case 'STATUS_CHANGE':
      return event.toStatus ? `Status → ${event.toStatus}` : 'Status change';
    case 'REPAIR_LOGGED':
      return 'Repair attempt logged';
    case 'NOTE':
      return 'Details updated';
    case 'DELETED':
      return 'Claim deleted';
    case 'RESTORED':
      return 'Claim restored';
    case 'RMA_LINKED':
      return 'RMA linked';
    case 'RMA_UNLINKED':
      return 'RMA unlinked';
    case 'REPAIR_HANDOFF':
      return 'Handed off to repair';
    case 'REPAIR_DETACH':
      return 'Repair detached';
    case 'ZENDESK_TICKET_CREATED':
      return 'Zendesk ticket created';
    case 'ZENDESK_LINKED':
      return 'Zendesk ticket linked';
    case 'ZENDESK_UNLINKED':
      return 'Zendesk ticket unlinked';
    case 'ZENDESK_REPLY':
      return 'Reply sent to Zendesk';
    case 'ZENDESK_STATUS':
      return 'Zendesk ticket updated';
    default:
      return event.eventType.replace(/_/g, ' ').toLowerCase();
  }
}
