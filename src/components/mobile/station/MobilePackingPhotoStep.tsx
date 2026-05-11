'use client';

import React, { useCallback } from 'react';
import type { CapturedPhoto } from '@/hooks/station/packingWizardReducer';
import { MobilePackerSpamCamera, type CapturedShot } from './MobilePackerSpamCamera';

// ─── Types ──────────────────────────────────────────────────────────────────

interface MobilePackingPhotoStepProps {
  orderId: string;
  packerId: string;
  packerLogId: number | null;
  photos: CapturedPhoto[];
  /** Product title rendered as the camera header (so the packer can verify what they're packing). */
  productTitle?: string | null;
  /** Called with the full batch of new photos on Done. Replaces existing batch. */
  onPhotosBatched: (photos: CapturedPhoto[]) => void;
  onBack: () => void;
  /** Optional max photos override. */
  maxPhotos?: number;
}

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * MobilePackingPhotoStep — host for the fullscreen spam camera.
 *
 * The actual camera UI (viewfinder, shutter, thumbnails) lives in
 * MobilePackerSpamCamera. This wrapper translates the camera's CapturedShot
 * blobs into the wizard's CapturedPhoto records (uploadStatus: 'pending')
 * and hands them up via onPhotosBatched. No network calls happen here —
 * uploads are deferred to the review step.
 */
export function MobilePackingPhotoStep({
  photos: _photos,
  productTitle,
  onPhotosBatched,
  onBack,
  maxPhotos = 5,
}: MobilePackingPhotoStepProps) {
  const handleDone = useCallback(
    (shots: CapturedShot[]) => {
      if (shots.length === 0) {
        onBack();
        return;
      }
      const batch: CapturedPhoto[] = shots.map((s) => ({
        id: s.id,
        blob: s.blob,
        previewUrl: s.previewUrl,
        uploadStatus: 'pending',
        serverPath: null,
        photoId: null,
        errorMessage: null,
      }));
      onPhotosBatched(batch);
    },
    [onPhotosBatched, onBack],
  );

  const headerNode = productTitle ? (
    <div className="min-w-0">
      <p className="text-[9px] font-black uppercase tracking-[0.2em] text-white/50">
        Ready to pack
      </p>
      <p className="text-[13px] font-black text-white truncate">{productTitle}</p>
    </div>
  ) : undefined;

  return (
    <MobilePackerSpamCamera
      onDone={handleDone}
      onCancel={onBack}
      maxPhotos={maxPhotos}
      header={headerNode}
    />
  );
}
