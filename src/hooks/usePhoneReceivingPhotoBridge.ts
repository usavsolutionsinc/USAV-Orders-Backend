'use client';

import { useCallback, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAblyChannel } from '@/hooks/useAblyChannel';
import { usePersistedStaffId } from '@/hooks/usePersistedStaffId';

/**
 * Phone-side bridge that listens for `receiving_photo_request` on
 * `station:{staffId}` and auto-navigates the phone to the photo capture page.
 *
 * Pairing model: implicit via shared staffId. Desktop publishes on
 * `station:{currentStaffId}`; any phone loaded with the same staffId picks it
 * up. No QR pair flow required.
 */
export function usePhoneReceivingPhotoBridge(): void {
  const [staffId] = usePersistedStaffId();
  const router = useRouter();
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

      // Don't redirect if the user is already on a photos page for this carton.
      const target = `/m/r/${receivingId}/photos`;
      if (pathname && pathname.startsWith(target)) return;

      const query = new URLSearchParams();
      query.set('staffId', String(staffId));
      if (reqId) query.set('requestId', reqId);
      router.push(`${target}?${query.toString()}`);
    },
    [pathname, router, staffId],
  );

  useAblyChannel(
    stationChannel,
    'receiving_photo_request',
    handlePhotoRequest,
    staffId > 0,
  );
}
