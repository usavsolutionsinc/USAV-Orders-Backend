'use client';

import { useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { safeChannelName, getStationChannelName } from '@/lib/realtime/channels';
import { useAblyChannel } from '@/hooks/useAblyChannel';
import {
  hydratePendingZohoSyncToasts,
  resolvePendingZohoSync,
} from '@/lib/receiving/zoho-sync-toast-tracker';

type ReceivingLogChangedEvent = {
  data?: {
    rowId?: unknown;
    zohoReceive?: unknown;
  };
};

export function ReceivingZohoSyncToaster() {
  const { user } = useAuth();
  const orgId = user?.organizationId ?? null;
  const channel = orgId ? safeChannelName(() => getStationChannelName(orgId)) : null;

  useEffect(() => {
    if (!orgId) return;
    hydratePendingZohoSyncToasts(orgId);
  }, [orgId]);

  useAblyChannel(
    channel || '',
    'receiving-log.changed',
    (msg: ReceivingLogChangedEvent) => {
      if (!orgId) return;
      const verdict = msg?.data?.zohoReceive;
      if (verdict !== 'ok' && verdict !== 'failed' && verdict !== 'skipped') return;
      const rowId = Number(msg?.data?.rowId);
      if (!Number.isFinite(rowId) || rowId <= 0) return;
      resolvePendingZohoSync({ orgId, lineId: rowId, verdict });
    },
    Boolean(orgId) && Boolean(channel),
  );

  return null;
}

