'use client';

import { useQueryClient } from '@tanstack/react-query';
import { getFbaChannelName, safeChannelName } from '@/lib/realtime/channels';
import { useAblyChannel } from './useAblyChannel';
import { useAuth } from '@/contexts/AuthContext';
import { qk } from '@/queries/keys';

export function useFbaRealtimeInvalidation(enabled = true) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const fbaChannel = safeChannelName(() => getFbaChannelName(orgId!));

  useAblyChannel(fbaChannel, 'fba.item.changed', () => {
    queryClient.invalidateQueries({ queryKey: qk.fba.board });
    queryClient.invalidateQueries({ queryKey: qk.fba.stageCounts });
    queryClient.invalidateQueries({ queryKey: qk.fba.queue });
    queryClient.invalidateQueries({ queryKey: qk.fba.logs });
  }, !!fbaChannel && enabled);

  useAblyChannel(fbaChannel, 'fba.shipment.changed', () => {
    queryClient.invalidateQueries({ queryKey: qk.fba.board });
    queryClient.invalidateQueries({ queryKey: qk.fba.stageCounts });
    queryClient.invalidateQueries({ queryKey: qk.fba.shipments });
    queryClient.invalidateQueries({ queryKey: qk.dashboardFbaShipments });
  }, !!fbaChannel && enabled);

  useAblyChannel(fbaChannel, 'fba.catalog.changed', () => {
    queryClient.invalidateQueries({ queryKey: qk.fba.fnskus });
  }, !!fbaChannel && enabled);
}
