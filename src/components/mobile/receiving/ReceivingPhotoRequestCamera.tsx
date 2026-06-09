'use client';

import { useCallback, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAblyChannel } from '@/hooks/useAblyChannel';
import { useAuth } from '@/contexts/AuthContext';

interface PhotoRequestPayload {
  receiving_id?: number;
  tracking?: string | null;
  request_id?: string;
  requested_by_staff_id?: number;
}

/**
 * Phone-side receiver for the desktop scan → camera flow. When the receiving
 * workstation matches a PO# or tracking scan it publishes
 * `receiving_photo_request` on `station:{staffId}` (implicit pairing — the
 * channel name is the gate, no claim flow). Here the SAME staff's phone
 * auto-opens the MobilePackerSpamCamera by routing to the existing
 * `/m/r/{id}/photos?requestId=` capture page, so the operator can immediately
 * shoot unboxing photos for whatever they just scanned in — no taps on the
 * phone required.
 *
 * Unlike `ReceivingShareToPhoneSheet` (an explicit desktop button → a confirm
 * sheet), a scan is the operator's intent to start unboxing, so we skip the
 * prompt and open the camera directly.
 *
 * Mounted once in the global mobile shell so it fires regardless of which /m
 * page the phone is parked on.
 */
export function ReceivingPhotoRequestCamera() {
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const staffId = user?.staffId ?? 0;

  // Dedupe: Ably can redeliver and the desktop fires one request per scan —
  // ignore a request_id we already routed on.
  const lastRequestRef = useRef<string | null>(null);
  // Read pathname via a ref so the handler closure always sees the live route
  // without re-subscribing the channel on every navigation.
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  const handleRequest = useCallback(
    (msg: { data?: PhotoRequestPayload }) => {
      const id = Number(msg?.data?.receiving_id);
      if (!Number.isFinite(id) || id <= 0) return;

      const requestId = String(msg?.data?.request_id || '').trim();
      if (requestId && lastRequestRef.current === requestId) return;
      lastRequestRef.current = requestId || null;

      // Already on a capture surface — don't yank the operator out of an
      // in-progress camera/upload session for the previous carton.
      if (pathnameRef.current?.endsWith('/photos')) return;

      // The capture page resolves the PO title + poRef from the receiving id,
      // so we only need the id + requestId (the latter drives the per-photo
      // `receiving_photo_uploaded` echo back to the desktop).
      const qs = requestId ? `?requestId=${encodeURIComponent(requestId)}` : '';
      router.push(`/m/r/${id}/photos${qs}`);
    },
    [router],
  );

  useAblyChannel(
    staffId > 0 ? `station:${staffId}` : 'station:__idle__',
    'receiving_photo_request',
    handleRequest,
    staffId > 0,
  );

  return null;
}
