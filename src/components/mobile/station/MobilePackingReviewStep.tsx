'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  framerPresenceMobile,
  framerTransitionMobile,
} from '@/design-system/foundations/motion-framer';
import {
  ChevronLeft,
  AlertCircle,
  Loader2,
  Image as ImageIcon,
  Check,
  X,
  Trash2,
} from '@/components/Icons';
import { MobilePackingConfirmCard } from './MobilePackingConfirmCard';
import type {
  ActivePackingOrder,
  ActiveFbaScan,
  CapturedPhoto,
  PhotoUploadStatus,
} from '@/hooks/station/packingWizardReducer';

// ─── Types ──────────────────────────────────────────────────────────────────

type OrderVariant = 'order' | 'fba' | 'repair' | 'exception';

interface MobilePackingReviewStepProps {
  order: ActivePackingOrder | null;
  fba: ActiveFbaScan | null;
  variant: OrderVariant;
  photos: CapturedPhoto[];
  packerId: string;
  packerLogId: number | null;
  /** True while the wizard is calling /api/packing-logs/update after uploads. */
  isCompleting: boolean;
  errorMessage: string | null;
  /** Update a single photo's upload state in the wizard reducer. */
  onPhotoStatus: (update: {
    id: string;
    status: PhotoUploadStatus;
    serverPath?: string | null;
    photoId?: number | null;
    errorMessage?: string | null;
  }) => void;
  /** Discard a photo from the batch. */
  onPhotoRemoved: (id: string) => void;
  /** Called once every photo has uploadStatus === 'uploaded' and the user
   *  has tapped Complete. The parent then POSTs /api/packing-logs/update. */
  onComplete: () => void;
  onBack: () => void;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
}

// ─── Component ──────────────────────────────────────────────────────────────

export function MobilePackingReviewStep({
  order,
  fba,
  variant,
  photos,
  packerId,
  packerLogId,
  isCompleting,
  errorMessage,
  onPhotoStatus,
  onPhotoRemoved,
  onComplete,
  onBack,
}: MobilePackingReviewStepProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const orderId = order?.orderId || fba?.fnsku || '';

  const counts = useMemo(() => {
    let pending = 0, uploading = 0, uploaded = 0, failed = 0;
    for (const p of photos) {
      if (p.uploadStatus === 'pending') pending++;
      else if (p.uploadStatus === 'uploading') uploading++;
      else if (p.uploadStatus === 'uploaded') uploaded++;
      else if (p.uploadStatus === 'failed') failed++;
    }
    return { pending, uploading, uploaded, failed };
  }, [photos]);

  const allUploaded = photos.length > 0 && counts.uploaded === photos.length;
  const hasFailed = counts.failed > 0;
  const hasUnsent = counts.pending > 0 || counts.failed > 0;

  // ── Batch upload ────────────────────────────────────────────────────────
  const uploadPhotos = useCallback(
    async (target: CapturedPhoto[]) => {
      if (!orderId) return;
      setIsUploading(true);
      try {
        await Promise.allSettled(
          target.map(async (p, idxInBatch) => {
            // photoIndex must be stable across retries, so use position in the FULL array
            const globalIndex = photos.findIndex((x) => x.id === p.id);
            const photoIndex = globalIndex >= 0 ? globalIndex : idxInBatch;
            onPhotoStatus({ id: p.id, status: 'uploading', errorMessage: null });
            try {
              const dataUrl = await blobToDataUrl(p.blob);
              const res = await fetch('/api/packing-logs/save-photo', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  photo: dataUrl,
                  orderId,
                  packerId,
                  photoIndex,
                  packerLogId,
                  photoType: 'packer_photo',
                }),
              });
              const data = await res.json();
              if (!res.ok) throw new Error(data?.error || 'Upload failed');
              onPhotoStatus({
                id: p.id,
                status: 'uploaded',
                serverPath: data.path,
                photoId: data.photoId ?? null,
              });
            } catch (err: any) {
              onPhotoStatus({
                id: p.id,
                status: 'failed',
                errorMessage: err?.message || 'Upload failed',
              });
            }
          }),
        );
      } finally {
        setIsUploading(false);
      }
    },
    [orderId, packerId, packerLogId, photos, onPhotoStatus],
  );

  const handleUploadAll = useCallback(() => {
    const targets = photos.filter(
      (p) => p.uploadStatus === 'pending' || p.uploadStatus === 'failed',
    );
    if (targets.length > 0) void uploadPhotos(targets);
  }, [photos, uploadPhotos]);

  const handleRetryFailed = useCallback(() => {
    const targets = photos.filter((p) => p.uploadStatus === 'failed');
    if (targets.length > 0) void uploadPhotos(targets);
  }, [photos, uploadPhotos]);

  // ── Per-photo status badge ──────────────────────────────────────────────
  const renderStatusBadge = (status: PhotoUploadStatus) => {
    if (status === 'uploaded') {
      return (
        <div className="absolute top-1 right-1 w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow">
          <Check className="w-3 h-3" />
        </div>
      );
    }
    if (status === 'uploading') {
      return (
        <div className="absolute top-1 right-1 w-5 h-5 rounded-full bg-blue-500 text-white flex items-center justify-center shadow">
          <Loader2 className="w-3 h-3 animate-spin" />
        </div>
      );
    }
    if (status === 'failed') {
      return (
        <div className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center shadow">
          <X className="w-3 h-3" />
        </div>
      );
    }
    return null;
  };

  // ── Primary action label/handler ────────────────────────────────────────
  const primaryLabel = (() => {
    if (isCompleting) return 'Completing…';
    if (isUploading) return `Uploading ${counts.uploading}/${photos.length}…`;
    if (allUploaded) return 'Complete Packing';
    if (hasFailed && !hasUnsent) return 'Retry Failed';
    return 'Upload All & Complete';
  })();

  const primaryDisabled =
    isUploading || isCompleting || photos.length === 0;

  const handlePrimary = useCallback(() => {
    if (allUploaded) {
      onComplete();
      return;
    }
    if (hasFailed && !counts.pending) {
      handleRetryFailed();
      return;
    }
    handleUploadAll();
  }, [allUploaded, hasFailed, counts.pending, onComplete, handleRetryFailed, handleUploadAll]);

  return (
    <div className="space-y-4">
      {/* Back button */}
      <button
        type="button"
        onClick={onBack}
        disabled={isUploading || isCompleting}
        className="flex items-center gap-1 text-[11px] font-bold text-gray-500 active:text-gray-700 transition-colors disabled:opacity-50"
      >
        <ChevronLeft className="w-4 h-4" />
        Back to Photos
      </button>

      {/* Compact order summary */}
      <MobilePackingConfirmCard
        order={order}
        fba={fba}
        variant={variant}
        scannedValue=""
        onConfirm={() => {}}
        onReject={() => {}}
        compact
      />

      {/* Photos grid */}
      <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ImageIcon className="w-4 h-4 text-gray-400" />
            <p className="text-[10px] font-black text-gray-500 uppercase tracking-wider">
              Photos ({photos.length})
            </p>
          </div>
          {photos.length > 0 && (
            <span className="text-[10px] font-bold text-gray-500 tabular-nums">
              {counts.uploaded}/{photos.length} uploaded
            </span>
          )}
          {photos.length === 0 && (
            <span className="text-[10px] font-bold text-amber-600">No photos attached</span>
          )}
        </div>

        {photos.length > 0 && (
          <div className="p-3">
            <div className="grid grid-cols-3 gap-2">
              <AnimatePresence initial={false}>
                {photos.map((photo, i) => (
                  <motion.div
                    key={photo.id}
                    initial={framerPresenceMobile.photoThumb.initial}
                    animate={framerPresenceMobile.photoThumb.animate}
                    exit={framerPresenceMobile.photoThumb.exit}
                    transition={framerTransitionMobile.photoThumb}
                    className="relative aspect-square rounded-xl overflow-hidden border border-gray-200"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photo.previewUrl}
                      alt={`Photo ${i + 1}`}
                      className="w-full h-full object-cover cursor-pointer"
                      onClick={() => setPreviewIndex(i)}
                    />
                    <div className="absolute bottom-1 left-1 bg-black/60 text-white text-[9px] font-black px-1.5 py-0.5 rounded-md">
                      {i + 1}
                    </div>
                    {renderStatusBadge(photo.uploadStatus)}
                    {photo.uploadStatus === 'failed' && photo.errorMessage && (
                      <div className="absolute inset-x-0 bottom-0 bg-red-600/90 text-white text-[8px] font-bold px-1.5 py-0.5 leading-tight truncate">
                        {photo.errorMessage}
                      </div>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        )}
      </div>

      {/* Error message */}
      {errorMessage && (
        <div className="p-3 bg-red-50 text-red-700 rounded-2xl border border-red-200 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p className="text-xs font-bold">{errorMessage}</p>
        </div>
      )}

      {/* Primary action */}
      <button
        type="button"
        onClick={handlePrimary}
        disabled={primaryDisabled}
        className="w-full h-[56px] rounded-2xl bg-emerald-600 text-white text-[13px] font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-colors active:bg-emerald-700 disabled:opacity-50"
      >
        {(isUploading || isCompleting) ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : allUploaded ? (
          <Check className="h-5 w-5" />
        ) : null}
        {primaryLabel}
      </button>

      {/* Fullscreen preview overlay */}
      <AnimatePresence>
        {previewIndex !== null && photos[previewIndex] && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[200] bg-black/90 flex items-center justify-center p-4"
            onClick={() => setPreviewIndex(null)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photos[previewIndex].previewUrl}
              alt={`Photo ${previewIndex + 1}`}
              className="max-w-full max-h-[80vh] rounded-xl object-contain"
            />
            <div className="absolute top-[max(1rem,env(safe-area-inset-top))] right-4 flex gap-3">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onPhotoRemoved(photos[previewIndex].id);
                  setPreviewIndex(null);
                }}
                disabled={isUploading || isCompleting}
                className="w-11 h-11 rounded-full bg-red-600 text-white flex items-center justify-center disabled:opacity-40"
                aria-label="Delete photo"
              >
                <Trash2 className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => setPreviewIndex(null)}
                className="w-11 h-11 rounded-full bg-white/20 text-white flex items-center justify-center"
                aria-label="Close preview"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
