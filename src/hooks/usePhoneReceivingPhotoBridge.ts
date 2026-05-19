'use client';

import { useCallback, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useAblyChannel } from '@/hooks/useAblyChannel';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Phone-side bridge that listens for `receiving_photo_request` on
 * `station:{staffId}` and announces the new carton to the rest of the app
 * via a window-level CustomEvent. The arrival hero (mounted globally in
 * ResponsiveLayout's mobile branch) listens, presents the carton intel, and
 * is the surface that actually navigates to `/m/r/{id}/photos`.
 *
 * Keyed by the signed-in staff (`useAuth().user.staffId`). Desktop publishes
 * on `station:{currentStaffId}`; any phone signed in as the same staff picks
 * it up — no separate pair handshake.
 */

export const RECEIVING_ARRIVAL_EVENT = 'receiving-photo-arrival';

export interface ReceivingArrivalDetail {
  receivingId: number;
  tracking: string | null;
  requestId: string | null;
  /** ms epoch when the bridge observed the event — used to ignore stale fires. */
  receivedAt: number;
}

export function usePhoneReceivingPhotoBridge(): void {
  const { user } = useAuth();
  const staffId = user?.staffId ?? 0;
  const pathname = usePathname();

  // Dedup window — desktops can fire the same request twice on rapid scans.
  const lastRequestRef = useRef<{ id: string; at: number } | null>(null);

  const stationChannel = staffId > 0 ? `station:${staffId}` : 'station:__idle__';

  const handlePhotoRequest = useCallback(
    (msg: {
      data?: {
        receiving_id?: number;
        request_id?: string;
        tracking?: string;
      };
    }) => {
      const receivingId = Number(msg?.data?.receiving_id);
      if (!Number.isFinite(receivingId) || receivingId <= 0) return;

      // Dedup within 2s on the same request_id.
      const reqId = String(msg?.data?.request_id || '');
      const now = Date.now();
      const last = lastRequestRef.current;
      if (reqId && last && last.id === reqId && now - last.at < 2000) return;
      if (reqId) lastRequestRef.current = { id: reqId, at: now };

      // Already capturing for this exact carton — don't interrupt.
      const target = `/m/r/${receivingId}/photos`;
      if (pathname && pathname.startsWith(target)) return;

      const detail: ReceivingArrivalDetail = {
        receivingId,
        tracking: msg?.data?.tracking ? String(msg.data.tracking) : null,
        requestId: reqId || null,
        receivedAt: now,
      };
      window.dispatchEvent(new CustomEvent(RECEIVING_ARRIVAL_EVENT, { detail }));
    },
    [pathname],
  );

  useAblyChannel(
    stationChannel,
    'receiving_photo_request',
    handlePhotoRequest,
    staffId > 0,
  );
}
