'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, Monitor } from '@/components/Icons';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { useAblyChannel } from '@/hooks/useAblyChannel';
import { useAuth } from '@/contexts/AuthContext';

interface SharePayload {
  receiving_id?: number;
  po_label?: string | null;
  tracking?: string | null;
}

/**
 * Phone-side receiver for the desktop "share to phone" action. The receiving
 * workspace's phone button publishes `receiving_share_to_phone` on
 * `station:{staffId}` (implicit pairing — the channel name is the gate, no
 * claim flow). Here we pop a bottom sheet ("Shared from computer") with a Take
 * photos CTA that jumps to the existing `/m/r/{id}/photos` capture page.
 *
 * Mounted once in the global mobile shell so it fires regardless of which /m
 * page the operator's phone is parked on.
 */
export function ReceivingShareToPhoneSheet() {
  const router = useRouter();
  const { user } = useAuth();
  const staffId = user?.staffId ?? 0;
  const [shared, setShared] = useState<{ receivingId: number; label: string; poLabel: string } | null>(null);

  const handleShare = useCallback((msg: { data?: SharePayload }) => {
    const id = Number(msg?.data?.receiving_id);
    if (!Number.isFinite(id) || id <= 0) return;
    // `poLabel` is the real PO title (empty when the desktop didn't send one);
    // `label` adds a friendly fallback purely for the sheet's heading.
    const poLabel = (msg?.data?.po_label || '').trim();
    setShared({ receivingId: id, label: poLabel || `Package #${id}`, poLabel });
  }, []);

  useAblyChannel(
    staffId > 0 ? `station:${staffId}` : 'station:__idle__',
    'receiving_share_to_phone',
    handleShare,
    staffId > 0,
  );

  const close = useCallback(() => setShared(null), []);
  const takePhotos = useCallback(() => {
    if (!shared) return;
    const id = shared.receivingId;
    const poLabel = shared.poLabel;
    setShared(null);
    // Carry the PO label through so the camera header shows it (not "RCV-<id>")
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
          <p className="text-sm font-semibold text-gray-900">{shared?.label}</p>
          <p className="mt-1 text-caption font-medium leading-snug text-gray-500">
            Sent from the receiving workstation. Take photos for this package on your phone.
          </p>
        </div>
        <button
          type="button"
          onClick={takePhotos}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 text-sm font-semibold tracking-wide text-white shadow-md shadow-blue-600/30 transition-transform active:scale-[0.98]"
        >
          <Camera className="h-5 w-5" />
          Take photos
        </button>
      </div>
    </BottomSheet>
  );
}
