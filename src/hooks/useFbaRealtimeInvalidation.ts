'use client';

import { useQueryClient } from '@tanstack/react-query';
import { getFbaChannelName } from '@/lib/realtime/channels';
import { useAblyChannel } from './useAblyChannel';
import { qk } from '@/queries/keys';

const FBA_CHANNEL = getFbaChannelName();

export function useFbaRealtimeInvalidation(enabled = true) {
  const queryClient = useQueryClient();

  useAblyChannel(FBA_CHANNEL, 'fba.item.changed', () => {
    queryClient.invalidateQueries({ queryKey: qk.fba.board });
    queryClient.invalidateQueries({ queryKey: qk.fba.stageCounts });
    queryClient.invalidateQueries({ queryKey: qk.fba.queue });
    queryClient.invalidateQueries({ queryKey: qk.fba.logs });
  }, enabled);

  useAblyChannel(FBA_CHANNEL, 'fba.shipment.changed', () => {
    queryClient.invalidateQueries({ queryKey: qk.fba.board });
    queryClient.invalidateQueries({ queryKey: qk.fba.stageCounts });
    queryClient.invalidateQueries({ queryKey: qk.fba.shipments });
    queryClient.invalidateQueries({ queryKey: qk.dashboardFbaShipments });
  }, enabled);

  useAblyChannel(FBA_CHANNEL, 'fba.catalog.changed', () => {
    queryClient.invalidateQueries({ queryKey: qk.fba.fnskus });
  }, enabled);
}
