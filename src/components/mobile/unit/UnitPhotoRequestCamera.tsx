'use client';

import { useCallback, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAblyChannel } from '@/hooks/useAblyChannel';
import { useAuth } from '@/contexts/AuthContext';
import { safeChannelName, getStaffStationBridgeChannelName } from '@/lib/realtime/channels';
import { UNIT_SCAN_PHOTOS } from '@/lib/station/flags';

interface UnitPhotoRequestPayload {
  serial_unit_id?: number;
  unit_key?: string | null;
  request_id?: string;
  requested_by_staff_id?: number;
}

/**
 * Phone-side receiver for the packer testing-label scan → camera flow. When the
 * station scan resolves a printed unit label it publishes `unit_photo_request`
 * on `staffstation:{staffId}` (implicit pairing — the channel name is the gate).
 * The SAME staff's phone auto-opens MobilePackerSpamCamera by routing to
 * `/m/u/{serialUnitId}/photos?requestId=`, so the operator shoots testing photos
 * for the scanned unit with no taps on the phone.
 *
 * The exact mirror of `ReceivingPhotoRequestCamera`, in a separate namespace
 * (event `unit_photo_request`, route `/m/u/...`). Mounted once in the global
 * mobile shell; a no-op unless `UNIT_SCAN_PHOTOS` is on.
 * See docs/todo/packer-testing-photo-scan-timeline-plan.md.
 */
export function UnitPhotoRequestCamera() {
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const staffId = user?.staffId ?? 0;
  const stationBridgeChannel = safeChannelName(() => getStaffStationBridgeChannelName(orgId!, staffId));

  // Dedupe redelivered / repeat requests by id.
  const lastRequestRef = useRef<string | null>(null);
  // Read pathname via a ref so the handler always sees the live route without
  // re-subscribing on every navigation.
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  const handleRequest = useCallback(
    (msg: { data?: UnitPhotoRequestPayload }) => {
      const id = Number(msg?.data?.serial_unit_id);
      if (!Number.isFinite(id) || id <= 0) return;

      const requestId = String(msg?.data?.request_id || '').trim();
      if (requestId && lastRequestRef.current === requestId) return;
      lastRequestRef.current = requestId || null;

      // Don't yank the operator out of an in-progress capture session.
      if (pathnameRef.current?.endsWith('/photos')) return;

      const unitKey = String(msg?.data?.unit_key || '').trim();
      const qs = new URLSearchParams();
      if (requestId) qs.set('requestId', requestId);
      if (unitKey) qs.set('unit', unitKey);
      const suffix = qs.toString();
      // `/m/unit-photos/{id}` (immersive) — NOT `/m/u/{id}/photos`, which
      // collides with the (shell) unit-detail route. See the page-file header.
      router.push(`/m/unit-photos/${id}${suffix ? `?${suffix}` : ''}`);
    },
    [router],
  );

  useAblyChannel(
    stationBridgeChannel,
    'unit_photo_request',
    handleRequest,
    UNIT_SCAN_PHOTOS && !!stationBridgeChannel && staffId > 0,
  );

  return null;
}
