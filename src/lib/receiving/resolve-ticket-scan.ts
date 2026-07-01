/**
 * Re-export scan helpers from the platform-agnostic support ticket registry.
 */
import { resolveSupportTicketToReceiving } from '@/lib/support/tickets';

export {
  looksLikeTicketScan,
  parseTicketScanValue,
  resolveSupportTicketToReceiving,
  type TicketReceivingRef,
} from '@/lib/support/tickets';

/** @deprecated use resolveSupportTicketToReceiving */
export async function resolveTicketToReceiving(
  orgId: string,
  ticketId: number,
): Promise<{ receivingId: number; lineId?: number } | null> {
  const hit = await resolveSupportTicketToReceiving(orgId, String(ticketId));
  if (!hit) return null;
  return { receivingId: hit.receivingId, lineId: hit.lineId };
}
