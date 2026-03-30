'use client';

import { useQueryClient } from '@tanstack/react-query';
import { getFbaChannelName } from '@/lib/realtime/channels';
import { useAblyChannel } from './useAblyChannel';

const FBA_CHANNEL = getFbaChannelName();

export function useFbaRealtimeInvalidation(enabled = true) {
  const queryClient = useQueryClient();

  useAblyChannel(FBA_CHANNEL, 'fba.item.changed', () => {
    queryClient.invalidateQueries({ queryKey: ['fba-board'] });
    queryClient.invalidateQueries({ queryKey: ['fba-stage-counts'] });
    queryClient.invalidateQueries({ queryKey: ['fba-queue'] });
    queryClient.invalidateQueries({ queryKey: ['fba-logs'] });
  }, enabled);

  useAblyChannel(FBA_CHANNEL, 'fba.shipment.changed', () => {
    queryClient.invalidateQueries({ queryKey: ['fba-board'] });
    queryClient.invalidateQueries({ queryKey: ['fba-stage-counts'] });
    queryClient.invalidateQueries({ queryKey: ['fba-shipments'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard-fba-shipments'] });
  }, enabled);

  useAblyChannel(FBA_CHANNEL, 'fba.catalog.changed', () => {
    queryClient.invalidateQueries({ queryKey: ['fba-fnskus'] });
  }, enabled);
}
