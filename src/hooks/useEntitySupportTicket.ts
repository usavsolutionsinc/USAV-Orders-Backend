'use client';

import { useQuery } from '@tanstack/react-query';
import { normalizeReceivingTicketEntityRefs } from '@/lib/support/tickets';

export interface EntitySupportTicket {
  id: number;
  label: string;
  provider: string;
  externalTicketId: string | null;
  /** Provider-native id for Zendesk thread/unlink APIs (not the display id). */
  providerTicketId: number | null;
  openUrl: string | null;
  subject: string | null;
  status: string | null;
}

export function entitySupportTicketQueryKey(lineId: number | null, receivingId: number | null) {
  return ['support-ticket', 'by-entity', lineId, receivingId] as const;
}

export function useEntitySupportTicket(args: {
  lineId: number | null;
  receivingId: number | null;
  enabled?: boolean;
}) {
  const { lineId, receivingId } = normalizeReceivingTicketEntityRefs(args);
  const enabled =
    (args.enabled ?? true) && (lineId != null || receivingId != null);

  return useQuery<EntitySupportTicket | null, Error>({
    queryKey: entitySupportTicketQueryKey(lineId, receivingId),
    queryFn: async () => {
      const sp = new URLSearchParams();
      if (lineId != null) sp.set('lineId', String(lineId));
      if (receivingId != null) sp.set('receivingId', String(receivingId));
      const res = await fetch(`/api/support/tickets/by-entity?${sp.toString()}`, {
        cache: 'no-store',
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `Request failed (${res.status})`);
      }
      return (data.ticket as EntitySupportTicket | null) ?? null;
    },
    enabled,
    staleTime: 15_000,
  });
}
