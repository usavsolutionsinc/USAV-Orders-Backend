'use client';

import React, { useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  framerPresenceMobile,
  framerTransitionMobile,
} from '@/design-system/foundations/motion-framer';
import { Camera, ChevronLeft, Loader2, X, Trash2 } from '@/components/Icons';
import { PhotoCapture } from '@/components/station/PhotoCapture';
import type { CapturedPhoto } from './MobileStationPacking';

// ─── Types ──────────────────────────────────────────────────────────────────

interface MobilePackingPhotoStepProps {
  orderId: string;
  packerId: string;
  packerLogId: number | null;
  photos: CapturedPhoto[];
  onPhotoAdded: (photo: CapturedPhoto) => void;
  onPhotoRemoved: (index: number) => void;
  onDone: () => void;
  onSkip: () => void;
  onBack: () => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function MobilePackingPhotoStep({
  orderId,
  packerId,
  packerLogId,
  photos,
  onPhotoAdded,
  onPhotoRemoved,
  onDone,
  onSkip,
  onBack,
}: MobilePackingPhotoStepProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const handleCapture = useCallback(async (blob: Blob, previewUrl: string) => {
    setIsUploading(true);
    setUploadError(null);

    try {
      // Convert blob to base64 data URL for the API
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      const photoIndex = photos.length;

      const res = await fetch('/api/packing-logs/save-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          photo: base64,
          orderId,
          packerId,
          photoIndex,
          packerLogId,
          photoType: 'packer_photo',
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Photo upload failed');

      onPhotoAdded({
        previewUrl,
        blobUrl: data.path,
        photoId: data.photoId ?? null,
        index: photoIndex,
      });
    } catch (err: any) {
      setUploadError(err?.message || 'Failed to upload photo');
    } finally {
      setIsUploading(false);
    }
  }, [orderId, packerId, packerLogId, photos.length, onPhotoAdded]);

  const hasPhotos = photos.length > 0;

  return (
    <div className="space-y-4">
      {/* Back button */}
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 text-[11px] font-bold text-gray-500 active:text-gray-700 transition-colors"
      >
        <ChevronLeft className="w-4 h-4" />
        Back to Confirmation
      </button>

      {/* Camera capture area */}
      <div className="relative">
        {isUploading && (
          <div className="absolute inset-0 z-10 bg-white/80 rounded-2xl flex items-center justify-center">
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="w-6 h-6 text-gray-500 animate-spin" />
              <p className="text-[11px] font-bold text-gray-500">Uploading...</p>
            </div>
          </div>
        )}
        <PhotoCapture
          onCapture={handleCapture}
          disabled={isUploading}
          className="w-full"
        />
      </div>

      {/* Upload error */}
      {uploadError && (
        <div className="p-3 bg-red-50 text-red-700 rounded-xl border border-red-200 text-xs font-bold">
          {uploadError}
        </div>
      )}

      {/* Photo thumbnails strip */}
      <AnimatePresence initial={false}>
        {hasPhotos && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={framerTransitionMobile.mobileCardMount}
          >
            <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider mb-2">
              Photos ({photos.length})
            </p>
            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
              {photos.map((photo, i) => (
                <motion.div
                  key={`${photo.blobUrl}-${i}`}
                  initial={framerPresenceMobile.photoThumb.initial}
                  animate={framerPresenceMobile.photoThumb.animate}
                  exit={framerPresenceMobile.photoThumb.exit}
                  transition={framerTransitionMobile.photoThumb}
                  className="relative flex-shrink-0 w-20 h-20 rounded-xl overflow-hidden border-2 border-gray-200 group"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photo.previewUrl}
                    alt={`Photo ${i + 1}`}
                    className="w-full h-full object-cover cursor-pointer"
                    onClick={() => setPreviewIndex(i)}
                  />
                  <button
                    type="button"
                    onClick={() => onPhotoRemoved(i)}
                    className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center active:bg-red-600 transition-colors"
                    aria-label={`Remove photo ${i + 1}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </motion.div>
              ))}

              {/* Add more placeholder */}
              {photos.length < 5 && (
                <div className="flex-shrink-0 w-20 h-20 rounded-xl border-2 border-dashed border-gray-200 flex items-center justify-center text-gray-400">
                  <Camera className="w-5 h-5" />
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Fullscreen preview overlay */}
      <AnimatePresence>
        {previewIndex !== null && photos[previewIndex] && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
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
                  onPhotoRemoved(previewIndex);
                  setPreviewIndex(null);
                }}
                className="w-10 h-10 rounded-full bg-red-600 text-white flex items-center justify-center"
                aria-label="Delete photo"
              >
                <Trash2 className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => setPreviewIndex(null)}
                className="w-10 h-10 rounded-full bg-white/20 text-white flex items-center justify-center"
                aria-label="Close preview"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Action buttons */}
      <div className="space-y-2 pt-2">
        <button
          type="button"
          onClick={onDone}
          disabled={!hasPhotos || isUploading}
          className="w-full h-[52px] rounded-2xl bg-gray-900 text-white text-[12px] font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed active:bg-gray-800"
        >
          Done — Review Photos
        </button>
        <button
          type="button"
          onClick={onSkip}
          className="w-full h-[44px] rounded-2xl text-gray-500 text-[11px] font-bold active:text-gray-700 transition-colors"
        >
          Skip photos
        </button>
      </div>
    </div>
  );
}
