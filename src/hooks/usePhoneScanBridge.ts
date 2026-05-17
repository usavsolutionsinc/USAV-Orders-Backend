'use client';

import { useCallback, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useAblyChannel } from '@/hooks/useAblyChannel';
import { useAblyClient } from '@/contexts/AblyContext';
import { useAuth } from '@/contexts/AuthContext';

type ScanResultMsg = {
  tracking?: string;
  matched?: boolean;
  po_ids?: string[];
  receiving_id?: number | null;
  error?: string | null;
};

/**
 * Desktop-side bridge for phone-originated tracking scans.
 *
 * Keyed by the signed-in staff (`useAuth().user.staffId`) — no pair handshake
 * required. When the user is signed in on both desktop and phone with the
 * same staff ID, the desktop subscribes to `phone:{staffId}` and either lets
 * the receiving sidebar handle the lookup (on /receiving) or performs the PO
 * lookup itself and echoes the result back on `station:{staffId}`.
 */
export function usePhoneScanBridge(): void {
  const { user } = useAuth();
  const { getClient } = useAblyClient();
  const pathname = usePathname();

  const staffId = user?.staffId ?? 0;
  const phoneChannelName = staffId > 0 ? `phone:${staffId}` : 'phone:__idle__';
  const stationChannelName = staffId > 0 ? `station:${staffId}` : 'station:__idle__';

  // Dedup window — desktops can receive the same tracking twice on rapid
  // re-scans; ignore a repeat within 1.5s.
  const lastSeenRef = useRef<Map<string, number>>(new Map());

  // The /receiving sidebar runs its own lookup + station echo. When we're on
  // that page we stay out of the way to avoid double-publish.
  const sidebarOwnsScans = Boolean(pathname && pathname.startsWith('/receiving'));

  const resolveOffPage = useCallback(
    async (tracking: string) => {
      try {
        const res = await fetch('/api/receiving/lookup-po', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trackingNumber: tracking, staffId }),
        });
        const data = await res.json();
        const matched = Boolean(data?.matched);
        const receivingId =
          typeof data?.receiving_id === 'number' ? data.receiving_id : null;
        const poIds: string[] = Array.isArray(data?.po_ids) ? data.po_ids : [];

        try {
          const client = await getClient();
          if (client) {
            const ch = client.channels.get(stationChannelName);
            await ch.publish('phone_scan_result', {
              tracking,
              matched,
              po_ids: poIds,
              receiving_id: receivingId,
              error: data?.success === false ? data?.error ?? null : null,
            });
          }
        } catch (err) {
          console.warn('phone-scan-bridge: echo publish failed', err);
        }
      } catch (err) {
        console.warn('phone-scan-bridge: lookup failed', err);
      }
    },
    [getClient, staffId, stationChannelName],
  );

  useAblyChannel(
    phoneChannelName,
    'phone_scan',
    (msg: { data?: { tracking?: string } }) => {
      const tracking = String(msg?.data?.tracking || '').trim();
      if (!tracking) return;

      const now = Date.now();
      const last = lastSeenRef.current.get(tracking);
      if (last && now - last < 1500) return;
      lastSeenRef.current.set(tracking, now);

      if (!sidebarOwnsScans) {
        void resolveOffPage(tracking);
      }
    },
    staffId > 0,
  );

  // No-op subscription kept so the station channel is attached and ready to
  // receive echoes from /receiving (which publishes phone_scan_result itself).
  useAblyChannel(
    stationChannelName,
    'phone_scan_result',
    (_msg: { data?: ScanResultMsg }) => {
      // Intentional no-op — UI feedback for the scan now lives on the phone
      // (via /m/scan) and the desktop sidebar (when on /receiving).
    },
    staffId > 0,
  );

  // Clear the dedup map when the signed-in user changes.
  useEffect(() => {
    lastSeenRef.current.clear();
  }, [staffId]);
}
