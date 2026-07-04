'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, Monitor } from '@/components/Icons';
import { Button } from '@/design-system/primitives';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { useAblyChannel } from '@/hooks/useAblyChannel';
import { useAblyClient } from '@/contexts/AblyContext';
import { useAuth } from '@/contexts/AuthContext';
import { safeChannelName, getStaffStationBridgeChannelName } from '@/lib/realtime/channels';

interface SharePayload {
  receiving_id?: number;
  po_label?: string | null;
  tracking?: string | null;
  request_id?: string | null;
}

/**
 * Phone-side receiver for the desktop "share to phone" action. The receiving
 * workspace's phone button publishes `receiving_share_to_phone` on
 * `staffstation:{staffId}` (implicit pairing — the channel name is the gate, no
 * claim flow). Here we pop a bottom sheet ("Shared from computer") with a Take
 * photos CTA that jumps to the existing `/m/r/{id}/photos` capture page.
 *
 * Mounted once in the global mobile shell so it fires regardless of which /m
 * page the operator's phone is parked on.
 */
export function ReceivingShareToPhoneSheet() {
  const router = useRouter();
  const { user } = useAuth();
  const { getClient } = useAblyClient();
  const orgId = user?.organizationId;
  const staffId = user?.staffId ?? 0;
  const stationBridgeChannel = safeChannelName(() => getStaffStationBridgeChannelName(orgId!, staffId));
  const [shared, setShared] = useState<{ receivingId: number; label: string; poLabel: string } | null>(null);

  const handleShare = useCallback((msg: { data?: SharePayload }) => {
    const id = Number(msg?.data?.receiving_id);
    if (!Number.isFinite(id) || id <= 0) return;
    // ACK back on the same bridge so the desktop knows a phone actually received
    // this share (a bare publish resolves even with zero subscribers). Echoing
    // the request_id lets the desktop match this reply to its exact request.
    const requestId = String(msg?.data?.request_id || '');
    if (requestId && stationBridgeChannel) {
      getClient()
        .then((client) =>
          client?.channels
            .get(stationBridgeChannel)
            .publish('receiving_share_ack', { request_id: requestId }),
        )
        .catch(() => {});
    }
    // `poLabel` is the real PO title (empty when the desktop didn't send one);
    // `label` adds a friendly fallback purely for the sheet's heading.
    const poLabel = (msg?.data?.po_label || '').trim();
    setShared({ receivingId: id, label: poLabel || `Package #${id}`, poLabel });
  }, [getClient, stationBridgeChannel]);

  useAblyChannel(
    stationBridgeChannel,
    'receiving_share_to_phone',
    handleShare,
    !!stationBridgeChannel && staffId > 0,
  );

  const close = useCallback(() => {
    if (!shared) return;
    setShared(null);
    // X on the handoff sheet should land the operator on the mobile receiving
    // feed so they return to the unbox page instead of staying on the prompt.
    router.replace('/m/receiving');
  }, [router, shared]);
  const takePhotos = useCallback(() => {
    if (!shared) return;
    const id = shared.receivingId;
    const poLabel = shared.poLabel;
    setShared(null);
    // Carry the PO label through so the camera header shows it (not "RCV-[id]")
    // and the saved NAS file is named by PO#. Skipped when no real PO was sent.
    const qs = poLabel
      ? `?title=${encodeURIComponent(poLabel)}&poRef=${encodeURIComponent(poLabel)}`
      : '';
    router.push(`/m/r/${id}/photos${qs}`);
  }, [router, shared]);

  return (
    <BottomSheet open={shared != null} onClose={close} title="Shared from computer">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
          <Monitor className="h-7 w-7" />
        </div>
        <div>
          <p className="text-sm font-semibold text-text-default">{shared?.label}</p>
          <p className="mt-1 text-caption font-medium leading-snug text-text-soft">
            Sent from the receiving workstation. Take photos for this package on your phone.
          </p>
        </div>
        <Button
          variant="primary"
          onClick={takePhotos}
          icon={<Camera className="h-5 w-5" />}
          className="h-12 w-full rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 shadow-md shadow-blue-600/30"
        >
          Take photos
        </Button>
      </div>
    </BottomSheet>
  );
}
